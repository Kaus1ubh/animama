"""Local installation-principal validation."""

from __future__ import annotations

from uuid import UUID

from animama.local.installation_port import InstallationSettingsRepository


class InstallationPrincipalInvalidError(RuntimeError):
    """The migration-seeded singleton or opaque UUID is missing or malformed."""


class InstallationPrincipalService:
    """Require the immutable UUIDv4 generated during local schema creation."""

    def __init__(self, repository: InstallationSettingsRepository) -> None:
        self._repository = repository

    async def require_principal(self) -> str:
        try:
            value = (await self._repository.get_installation_principal_id()).strip()
            parsed = UUID(value)
        except (AttributeError, RuntimeError, TypeError, ValueError) as exc:
            raise InstallationPrincipalInvalidError("installation principal is unavailable or malformed") from exc
        if parsed.version != 4 or str(parsed) != value.lower():
            raise InstallationPrincipalInvalidError("installation principal must be a canonical UUIDv4")
        return value


__all__ = ["InstallationPrincipalInvalidError", "InstallationPrincipalService"]
