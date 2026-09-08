"""Single-session assembly for the caller-owned Anima aggregate transaction."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from animama.app.services.anima_loadout_service import AnimaLoadoutService

from .anima_chat_profile_repo import SQLAlchemyAnimaChatProfileRepository
from .anima_repo import SQLAlchemyAnimaRepository
from .avatar_repo import SQLAlchemyAvatarRepository
from .memory_entry_repo import SQLAlchemyMemoryEntryRepository
from .model_provider_repo import SQLAlchemyModelProviderRepository
from .settings_repo import SQLAlchemyAnimaSettingsRepository
from .uow import SQLAlchemyUnitOfWork


class SQLAlchemyAnimaAggregateUnitOfWork(SQLAlchemyUnitOfWork):
    """No nested sessions, hidden commits, filesystem writes, or runtime leases."""

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session)
        self.animas = SQLAlchemyAnimaRepository(session)
        self.avatars = SQLAlchemyAvatarRepository(session)
        self.memory_entries = SQLAlchemyMemoryEntryRepository(session)
        self.model_providers = SQLAlchemyModelProviderRepository(session)
        self.chat_profiles = SQLAlchemyAnimaChatProfileRepository(session)
        self.settings = SQLAlchemyAnimaSettingsRepository(session)
        self.loadouts = AnimaLoadoutService(session)
