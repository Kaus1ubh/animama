"""Model assets beneath an installation's writable data root.

Layout:

- ``<data_root>/internal/model-assets/<asset_id>/<sha256>``: installed files;
- ``<data_root>/staging/model-assets/``: in-progress downloads, discarded at
  service start.

Both are beneath one data root, so publishing is a same-filesystem rename.
"""

from __future__ import annotations

import os
import shutil
import stat
import tempfile
from pathlib import Path

from animama.domain.model_assets import AssetDescriptor

_DIRECTORY_MODE = 0o700


def _fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


class _StagedFile:
    def __init__(self, descriptor: int, staging_path: Path, target: Path) -> None:
        self._handle = os.fdopen(descriptor, "wb")
        self._staging_path = staging_path
        self._target = target

    def write(self, chunk: bytes) -> None:
        self._handle.write(chunk)

    def commit(self) -> None:
        self._handle.flush()
        os.fsync(self._handle.fileno())
        self._handle.close()
        self._target.parent.mkdir(mode=_DIRECTORY_MODE, parents=True, exist_ok=True)
        os.replace(self._staging_path, self._target)
        _fsync_directory(self._target.parent)
        # Only one pinned digest per asset is kept; drop superseded versions.
        for sibling in self._target.parent.iterdir():
            if sibling.name != self._target.name:
                if sibling.is_dir() and not sibling.is_symlink():
                    shutil.rmtree(sibling, ignore_errors=True)
                else:
                    sibling.unlink(missing_ok=True)

    def discard(self) -> None:
        if not self._handle.closed:
            self._handle.close()
        self._staging_path.unlink(missing_ok=True)


class FilesystemModelAssetStore:
    """Implement ``ModelAssetStore`` on the local filesystem."""

    def __init__(self, data_root: Path) -> None:
        # Resolve once so served paths never traverse a symlinked prefix later.
        root = data_root.resolve()
        self.installed_root = root / "internal" / "model-assets"
        self.staging_root = root / "staging" / "model-assets"

    def discard_staging(self) -> None:
        if self.staging_root.is_dir() and not self.staging_root.is_symlink():
            shutil.rmtree(self.staging_root)

    def free_bytes(self) -> int:
        # Staging and installed files share the data root's filesystem; measure
        # its nearest existing directory, since the store may not be created yet.
        directory = self.installed_root
        while not directory.exists() and directory != directory.parent:
            directory = directory.parent
        return shutil.disk_usage(directory).free

    def _path(self, asset: AssetDescriptor) -> Path:
        # Descriptor validation guarantees both parts are single safe names.
        return self.installed_root / asset.id / asset.sha256

    def is_installed(self, asset: AssetDescriptor) -> bool:
        try:
            metadata = self._path(asset).lstat()
        except OSError:
            return False
        # A regular, singly linked file of the pinned size; digests were checked at install.
        return stat.S_ISREG(metadata.st_mode) and metadata.st_nlink == 1 and metadata.st_size == asset.size

    def stage(self, asset: AssetDescriptor) -> _StagedFile:
        self.staging_root.mkdir(mode=_DIRECTORY_MODE, parents=True, exist_ok=True)
        descriptor, name = tempfile.mkstemp(prefix=f"{asset.id}.", suffix=".part", dir=self.staging_root)
        return _StagedFile(descriptor, Path(name), self._path(asset))

    def remove(self, asset: AssetDescriptor) -> None:
        directory = self.installed_root / asset.id
        if directory.is_dir() and not directory.is_symlink():
            shutil.rmtree(directory)

    def content_location(self, asset: AssetDescriptor) -> tuple[Path, str]:
        return self.installed_root, f"{asset.id}/{asset.sha256}"
