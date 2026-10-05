"""Canonical inspection adapters; private scratch paths stay out of commands."""

import hashlib
import os
import shutil
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import cast

from animama.adapters.content_store.filesystem_store import FilesystemContentStore
from animama.app.contracts.content_package import MAX_PACKAGE_BYTES
from animama.app.contracts.content_package_staging import StageLimits
from animama.app.ports.content_package_staging import PackageStageLease
from animama.app.ports.content_store import ContentStore, LocalContentStore
from animama.app.services.content_package_archive import ContentPackageArchive, InspectedPackage
from animama.app.services.content_package_staging import StageLease
from animama.domain.content_catalog import ContentConflictError


class LocalPackageInspector:
    def __init__(self, *, store: ContentStore) -> None:
        self._archive = ContentPackageArchive(store=cast(LocalContentStore, store))

    @contextmanager
    def inspect(self, lease: PackageStageLease) -> Iterator[InspectedPackage]:
        if not isinstance(lease, StageLease):
            raise TypeError("opaque stages require an explicit package inspector")
        with lease.expansion() as destination:
            yield self._archive.inspect(lease.archive_path, destination=destination)


class TemporaryPackageInspector:
    """Reuse canonical validation for opaque stages in a bounded disposable tree.

    Only generated scratch paths reach the scanner. Persistent byte locators and
    object keys never do. The caller keeps the lease until the context closes,
    including on failed publication or a cancelled request.
    """

    def __init__(self, *, limits: StageLimits, temporary_root: Path | None = None) -> None:
        self._limits = limits
        self._temporary_root = temporary_root

    @contextmanager
    def inspect(self, lease: PackageStageLease) -> Iterator[InspectedPackage]:
        record = lease.record
        with TemporaryDirectory(prefix="animama-package-", dir=self._temporary_root) as temporary:
            root = Path(temporary)
            archive = root / "package.zip"
            size, digest = 0, hashlib.sha256()
            with lease.open_archive() as source, archive.open("xb") as destination:
                os.chmod(archive, 0o600)
                while chunk := source.read(1024 * 1024):
                    size += len(chunk)
                    if size > min(self._limits.max_archive_bytes, MAX_PACKAGE_BYTES):
                        raise ContentConflictError("package_archive_size_invalid")
                    digest.update(chunk)
                    destination.write(chunk)
            # Import reviews are already sealed. Fresh exports are inspected
            # before sealing, while the lease excludes writers and cleanup.
            if record.archive_sha256 is not None and (size, digest.hexdigest()) != (
                record.actual_bytes,
                record.archive_sha256,
            ):
                raise ContentConflictError("package_archive_changed")
            expanded = ContentPackageArchive.expanded_size(archive)
            if expanded > self._limits.max_expanded_bytes:
                raise ContentConflictError("package_expanded_size_invalid")
            if expanded > shutil.disk_usage(root).free:
                raise ContentConflictError("package_stage_disk_full")
            scanner = FilesystemContentStore(
                included_root=root / "included", local_root=root / "local", operations_root=root / "unused"
            )
            yield ContentPackageArchive(store=scanner).inspect(archive, destination=root / "inspection")
