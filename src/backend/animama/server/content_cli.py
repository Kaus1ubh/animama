"""Reconcile readable content after Alembic during local stack startup."""

from __future__ import annotations

import asyncio

from animama.local.database import LocalDatabase
from animama.local.installation_principal import InstallationPrincipalService
from animama.local.installation_repository import (
    SQLAlchemyInstallationSettingsRepository,
)
from animama.server.config import settings
from animama.server.content_startup import rescan_content_once
from animama.server.local_runtime import initialize_local_runtime


async def _main() -> None:
    paths = initialize_local_runtime(settings)
    database = LocalDatabase(settings)
    try:
        factory = database.session_factory()
        async with factory() as session:
            owner_id = await InstallationPrincipalService(
                SQLAlchemyInstallationSettingsRepository(session)
            ).require_principal()
        await rescan_content_once(paths, owner_id=owner_id, session_factory=factory)
    finally:
        await database.close()


if __name__ == "__main__":
    asyncio.run(_main())
