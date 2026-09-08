"""Authorization rules for cataloged Included and Local content."""

from __future__ import annotations

from animama.domain.content_catalog import CatalogContentEntry, ContentScope


class ContentAccessPolicy:
    """Keep ownership decisions independent from filesystem placement."""

    @staticmethod
    def can_read(*, scope: ContentScope, owner_user_id: str | None, user_id: str) -> bool:
        return scope in {ContentScope.INCLUDED, ContentScope.INSTALLATION_SHARED} or (
            scope is ContentScope.OWNER and owner_user_id == user_id
        )

    @classmethod
    def can_mutate(cls, *, entry: CatalogContentEntry, user_id: str) -> bool:
        """Included is immutable; shared host files require operator filesystem access."""

        return entry.scope is ContentScope.OWNER and entry.owner_user_id == user_id


__all__ = ["ContentAccessPolicy"]
