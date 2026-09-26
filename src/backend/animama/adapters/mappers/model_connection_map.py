from __future__ import annotations

from animama.domain.model_connection import ModelConnection, ModelConnectionCompatibility
from animama.orm import ORMModelConnection


def model_connection_orm_to_domain(orm: ORMModelConnection) -> ModelConnection:
    """Map a stored connection into the framework-free domain type."""

    return ModelConnection(
        id=orm.id,
        name=orm.name,
        preset=orm.preset,
        source=orm.source,
        base_url=orm.base_url,
        credential_env=orm.credential_env,
        compatibility=ModelConnectionCompatibility.from_mapping(orm.compatibility),
        timeout_seconds=orm.timeout_seconds,
        active=orm.active,
        created_at=orm.created_at,
        updated_at=orm.updated_at,
    )


def apply_model_connection_to_orm(orm: ORMModelConnection, connection: ModelConnection) -> ORMModelConnection:
    """Update an ORM connection in place from the domain value."""

    orm.name = connection.name
    orm.preset = connection.preset
    orm.source = connection.source
    orm.base_url = connection.base_url
    orm.credential_env = connection.credential_env
    orm.compatibility = connection.compatibility.to_dict()
    orm.timeout_seconds = connection.timeout_seconds
    orm.active = connection.active
    return orm


def model_connection_domain_to_orm(connection: ModelConnection) -> ORMModelConnection:
    """Create an ORM connection row from the domain value."""

    return apply_model_connection_to_orm(ORMModelConnection(id=connection.id), connection)


__all__ = [
    "apply_model_connection_to_orm",
    "model_connection_domain_to_orm",
    "model_connection_orm_to_domain",
]
