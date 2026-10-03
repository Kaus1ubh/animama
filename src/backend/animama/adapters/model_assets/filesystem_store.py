"""Model assets beneath an installation's writable data root.

Layout:

- ``<data_root>/internal/model-assets/<asset_id>/<sha256>``: an installed
  single-file asset;
- ``<data_root>/internal/model-assets/<asset_id>/<manifest_sha256>/<path>``:
  an installed set, activated by one directory rename;
- ``<data_root>/staging/model-assets/<asset_id>/<version>/<path>``: files being
  downloaded. They persist across retries and restarts so transfers resume;
  staging for unknown IDs, other versions and the legacy flat ``*.part`` files
  is removed by ``prune``.

Both trees are beneath one data root, so activation is a same-filesystem rename.
"""

from __future__ import annotations

import hashlib
import os
import shutil
import stat
from pathlib import Path

from animama.domain.model_assets import AssetCatalog, AssetDescriptor, AssetFile
from animama.utils.files import is_directory, open_no_follow, path_is_link, replace, sync_directory

_DIRECTORY_MODE = 0o700
_FILE_MODE = 0o600
_REHASH_CHUNK = 1024 * 1024


def _remove(path: Path) -> None:
    """Delete a file, link or directory tree without following links."""

    if path.is_dir() and not path_is_link(path):
        shutil.rmtree(path)
    else:
        path.unlink(missing_ok=True)


def _remove_siblings(path: Path) -> None:
    """Keep only ``path`` among its siblings: one pinned version per asset."""

    for sibling in path.parent.iterdir():
        if sibling.name != path.name:
            _remove(sibling)


class _StagedFile:
    """A resumable staging file whose running digest covers every staged byte."""

    def __init__(self, path: Path, expected_size: int) -> None:
        self._path = path
        descriptor = open_no_follow(path, os.O_RDWR | os.O_CREAT, _FILE_MODE)
        try:
            if not stat.S_ISREG(os.fstat(descriptor).st_mode):
                raise OSError(f"Staged asset file {path.name} is not a regular file")
        except BaseException:
            os.close(descriptor)
            raise
        self._handle = os.fdopen(descriptor, "r+b")
        self._digest = hashlib.sha256()
        self._size = 0
        # Rehash the verified prefix; a prefix longer than the file cannot be resumed.
        if os.fstat(descriptor).st_size > expected_size:
            self._handle.truncate(0)
        while chunk := self._handle.read(_REHASH_CHUNK):
            self._digest.update(chunk)
            self._size += len(chunk)

    @property
    def size(self) -> int:
        return self._size

    def restart(self) -> None:
        self._handle.seek(0)
        self._handle.truncate(0)
        self._digest = hashlib.sha256()
        self._size = 0

    def write(self, chunk: bytes) -> None:
        self._handle.write(chunk)
        self._digest.update(chunk)
        self._size += len(chunk)

    def hexdigest(self) -> str:
        return self._digest.hexdigest()

    def close(self) -> None:
        if not self._handle.closed:
            self._handle.flush()
            os.fsync(self._handle.fileno())
            self._handle.close()

    def discard(self) -> None:
        if not self._handle.closed:
            self._handle.close()
        self._path.unlink(missing_ok=True)


class FilesystemModelAssetStore:
    """Implement ``ModelAssetStore`` on the local filesystem."""

    def __init__(self, data_root: Path) -> None:
        # Resolve once so served paths never traverse a symlinked prefix later.
        root = data_root.resolve()
        self.installed_root = root / "internal" / "model-assets"
        self.staging_root = root / "staging" / "model-assets"

    def prune(self, catalog: AssetCatalog) -> None:
        if self.installed_root.is_dir() and not path_is_link(self.installed_root):
            for entry in self.installed_root.iterdir():
                if catalog.get(entry.name) is None:
                    _remove(entry)
        if path_is_link(self.staging_root):
            self.staging_root.unlink()
        if not self.staging_root.is_dir():
            return
        for entry in self.staging_root.iterdir():
            asset = catalog.get(entry.name)
            if asset is None or not entry.is_dir() or path_is_link(entry):
                _remove(entry)
                continue
            names = {file.path for file in asset.files}
            for version in entry.iterdir():
                if version.name != asset.version or not version.is_dir() or path_is_link(version):
                    _remove(version)
                    continue
                for staged in version.iterdir():
                    if staged.name not in names or path_is_link(staged) or not staged.is_file():
                        _remove(staged)

    def free_bytes(self) -> int:
        # Staging and installed files share the data root's filesystem; measure
        # its nearest existing directory, since the store may not be created yet.
        directory = self.installed_root
        while not directory.exists() and directory != directory.parent:
            directory = directory.parent
        return shutil.disk_usage(directory).free

    def _installed_path(self, asset: AssetDescriptor) -> Path:
        # Descriptor validation guarantees both parts are single safe names.
        return self.installed_root / asset.id / asset.version

    def _staging_directory(self, asset: AssetDescriptor) -> Path:
        return self.staging_root / asset.id / asset.version

    def staged_bytes(self, asset: AssetDescriptor) -> int:
        directory = self._staging_directory(asset)
        total = 0
        for file in asset.files:
            try:
                metadata = (directory / file.path).lstat()
            except FileNotFoundError:
                continue
            if stat.S_ISREG(metadata.st_mode):
                total += min(metadata.st_size, file.size)
        return total

    def is_installed(self, asset: AssetDescriptor) -> bool:
        path = self._installed_path(asset)
        if asset.is_set:
            try:
                if not is_directory(path.lstat()):
                    return False
            except OSError:
                return False
            return all(self._is_pinned_file(path / file.path, file) for file in asset.files)
        return self._is_pinned_file(path, asset.files[0])

    @staticmethod
    def _is_pinned_file(path: Path, file: AssetFile) -> bool:
        try:
            metadata = path.lstat()
        except OSError:
            return False
        # A regular, singly linked file of the pinned size; digests were checked at install.
        return stat.S_ISREG(metadata.st_mode) and metadata.st_nlink == 1 and metadata.st_size == file.size

    def open_staged(self, asset: AssetDescriptor, file: AssetFile) -> _StagedFile:
        directory = self._staging_directory(asset)
        directory.mkdir(mode=_DIRECTORY_MODE, parents=True, exist_ok=True)
        return _StagedFile(directory / file.path, file.size)

    def commit(self, asset: AssetDescriptor) -> None:
        staging = self._staging_directory(asset)
        target = self._installed_path(asset)
        target.parent.mkdir(mode=_DIRECTORY_MODE, parents=True, exist_ok=True)
        if asset.is_set:
            # The version directory becomes the installed set in one rename, so
            # a crash leaves either the previous state or the complete set.
            sync_directory(staging)
            _remove(target)  # An incomplete leftover can never be installed state.
            replace(staging, target)
        else:
            replace(staging / asset.files[0].path, target)
        sync_directory(target.parent)
        _remove_siblings(target)
        self.discard_staged(asset)

    def discard_staged(self, asset: AssetDescriptor) -> None:
        directory = self.staging_root / asset.id
        if directory.exists() or path_is_link(directory):
            _remove(directory)

    def remove(self, asset: AssetDescriptor) -> None:
        directory = self.installed_root / asset.id
        if directory.is_dir() and not path_is_link(directory):
            shutil.rmtree(directory)

    def content_location(self, asset: AssetDescriptor) -> tuple[Path, str]:
        return self.installed_root, f"{asset.id}/{asset.version}"

    def set_directory(self, asset: AssetDescriptor) -> Path:
        return self._installed_path(asset)
