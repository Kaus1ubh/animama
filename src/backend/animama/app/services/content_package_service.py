"""Composition facade for reviewed portable exports and transactional imports."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from animama.app.ports.anima_aggregate_port import AnimaAggregateUnitOfWork
from animama.app.ports.user_profile_port import UserProfileRepository
from animama.app.services.anima_package_source_service import AnimaPackageSourceService
from animama.app.services.content_catalog_service import ContentCatalogService
from animama.app.services.content_package_export import ContentPackageExportService, ExportReview, ExportSummary
from animama.app.services.content_package_import import ContentPackageImportService
from animama.app.services.content_package_staging import PackageStageService
from animama.domain.anima_definition import ANIMA_IDENTITY_MAX_BYTES
from animama.domain.content_catalog import CatalogContentEntry


@dataclass(frozen=True, slots=True)
class ExportedContentPackage:
    """A reviewed archive used by application callers without HTTP streaming."""

    path: Path
    filename: str
    package_sha256: str
    size_bytes: int
    item_count: int


@dataclass(frozen=True, slots=True)
class ImportedContentPackage:
    """Historical receipt shape retained for private decoding, never new admission."""

    items: tuple[CatalogContentEntry, ...]
    skipped_existing_item_ids: tuple[str, ...]


class ContentPackageService:
    """Compose reviewed services around the same catalog mutation boundary."""

    def __init__(
        self,
        *,
        content: ContentCatalogService,
        exports_root: Path,
        imports_root: Path | None = None,
        anima_sources: AnimaPackageSourceService | None = None,
        profiles: UserProfileRepository | None = None,
        uow: AnimaAggregateUnitOfWork | None = None,
        default_model_provider_id: str | None = None,
        max_identity_bytes: int = ANIMA_IDENTITY_MAX_BYTES,
    ) -> None:
        self.stages = PackageStageService(
            imports_root=imports_root or exports_root.parent / "imports",
            exports_root=exports_root,
        )
        self.exports = ContentPackageExportService(
            content=content,
            exports_root=exports_root,
            anima_sources=anima_sources,
            stages=self.stages,
            profiles=profiles,
        )
        self.imports = ContentPackageImportService(
            content=content,
            mutations=content.mutations,
            stages=self.stages,
            uow=uow,
            default_model_provider_id=default_model_provider_id,
            max_identity_bytes=max_identity_bytes,
        )

    async def summarize(
        self, *, user_id: str, item_ids: tuple[str, ...] = (), anima_id: str | None = None
    ) -> ExportSummary:
        """Resolve portable selected/required content without producing an archive."""
        return await self.exports.summarize(user_id=user_id, item_ids=item_ids, anima_id=anima_id)

    async def prepare_export(
        self, *, user_id: str, expected_digest: str, item_ids: tuple[str, ...] = (), anima_id: str | None = None
    ) -> ExportReview:
        """Seal exact version-three bytes before returning their review."""
        return await self.exports.prepare(
            user_id=user_id, expected_digest=expected_digest, item_ids=item_ids, anima_id=anima_id
        )

    async def get_export(self, *, user_id: str, export_id: str) -> ExportedContentPackage:
        """Retrieve the already reviewed cache independently of current content."""
        cached = await self.exports.cached(user_id=user_id, export_id=export_id)
        return ExportedContentPackage(
            path=cached.path,
            filename=cached.review.filename,
            package_sha256=cached.review.package_sha256,
            size_bytes=cached.review.size_bytes,
            item_count=len(cached.review.manifest.entries),
        )
