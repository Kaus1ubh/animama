from __future__ import annotations

from datetime import datetime
from uuid import uuid4

import pytest

from animama.local.installation_principal import (
    InstallationPrincipalInvalidError,
    InstallationPrincipalService,
)


class InMemoryInstallationSettingsRepository:
    def __init__(self, principal_id: object) -> None:
        self.principal_id = principal_id

    async def get_installation_principal_id(self) -> str:
        if isinstance(self.principal_id, BaseException):
            raise self.principal_id
        return self.principal_id  # type: ignore[return-value]

    async def get_first_run_completed_at(self) -> datetime | None:
        return None

    async def complete_first_run(self, *, completed_at: datetime) -> bool:
        return False


@pytest.mark.asyncio
async def test_seeded_canonical_uuid4_is_returned_unchanged() -> None:
    principal_id = str(uuid4())

    assert (
        await InstallationPrincipalService(InMemoryInstallationSettingsRepository(principal_id)).require_principal()
        == principal_id
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "value",
    [None, "", "not-a-uuid", "9d48e72b-b2b5-51eb-8e93-0242ac130002", RuntimeError("missing singleton")],
)
async def test_missing_or_malformed_principals_fail_closed(value: object) -> None:
    with pytest.raises(InstallationPrincipalInvalidError):
        await InstallationPrincipalService(InMemoryInstallationSettingsRepository(value)).require_principal()
