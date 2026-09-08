"""SQLAlchemy-backed repository adapters.

This package contains SQLAlchemy implementations for app-layer repository
ports. Modules here were moved from `animama.adapters.persistence.sqlalchemy`
to consolidate all concrete repositories under `animama.adapters.repositories`.

Imports previously using `animama.adapters.persistence.sqlalchemy.*` should
now reference `animama.adapters.repositories.sqlalchemy.*`.
"""
