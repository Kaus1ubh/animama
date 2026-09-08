from __future__ import annotations

import asyncio
import os
import ssl
from functools import lru_cache
from urllib.parse import parse_qs, quote_plus, urlencode, urlsplit, urlunsplit

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from animama.orm.base import Base
from animama.server.config import Settings, settings


def _extract_sslmode(url: str) -> tuple[str, str | None]:
    """Extract and remove `sslmode` from a SQLAlchemy URL query string.

    SQLAlchemy's asyncpg dialect will pass unknown query params as keyword arguments to
    `asyncpg.connect(...)`. asyncpg does not accept `sslmode`, so we must translate it.
    """

    try:
        parts = urlsplit(url)
    except Exception:  # pragma: no cover - defensive
        return url, None

    qs = parse_qs(parts.query, keep_blank_values=True)
    sslmode_values = qs.pop("sslmode", None)
    sslmode = sslmode_values[0] if sslmode_values else None
    new_query = urlencode(qs, doseq=True)
    cleaned = urlunsplit((parts.scheme, parts.netloc, parts.path, new_query, parts.fragment))
    return cleaned, sslmode


def _asyncpg_ssl_context(sslmode: str) -> ssl.SSLContext | None:
    """Build an asyncpg-compatible SSL context from libpq sslmode semantics.

    We intentionally support a small subset:
    - disable -> no TLS
    - require -> TLS without cert verification (like libpq sslmode=require)
    - verify-ca / verify-full -> TLS with default verification (requires CA bundle in the image)
    """

    mode = (sslmode or "").strip().lower()
    if not mode or mode in ("disable", "allow"):
        return None
    if mode == "require":
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        return ctx
    if mode in ("verify-ca", "verify-full"):
        ctx = ssl.create_default_context()
        if mode == "verify-ca":
            ctx.check_hostname = False
        return ctx
    # Fallback: treat unknown values as "require" (best-effort encryption).
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def _build_async_db_url_from_pg_env() -> str | None:
    """Build an asyncpg SQLAlchemy URL from libpq-style env vars.

    This keeps secrets out of IaC templates: ECS can inject `PGPASSWORD` via Secrets Manager,
    while the app composes the final DSN at runtime.
    """

    host = os.getenv("PGHOST")
    user = os.getenv("PGUSER")
    password = os.getenv("PGPASSWORD")
    database = os.getenv("PGDATABASE")
    port = os.getenv("PGPORT") or "5432"

    if not host or not user or not database:
        return None

    auth = quote_plus(user)
    if password is not None and password != "":
        auth = f"{quote_plus(user)}:{quote_plus(password)}"

    url = f"postgresql+asyncpg://{auth}@{host}:{port}/{quote_plus(database)}"
    return url


def _default_db_url() -> str:
    explicit = os.getenv("ANIMAMA_DATABASE_URL")
    if explicit:
        return explicit
    from_pg = _build_async_db_url_from_pg_env()
    if from_pg:
        return from_pg
    return "postgresql+asyncpg://animama:a@localhost:5432/animama"


def _pool_kwargs(runtime_settings: Settings) -> dict[str, object]:
    return {
        "pool_size": max(1, int(runtime_settings.animama_database_pool_size)),
        "max_overflow": max(0, int(runtime_settings.animama_database_max_overflow)),
        "pool_timeout": max(0.1, float(runtime_settings.animama_database_pool_timeout_seconds)),
        "pool_recycle": int(runtime_settings.animama_database_pool_recycle_seconds),
        "pool_pre_ping": bool(runtime_settings.animama_database_pool_pre_ping),
    }


# LRU Cache enforces a single engine
@lru_cache(maxsize=1)
def get_engine(url: str | None = None) -> AsyncEngine:
    """Return the local CLI compatibility engine; applications own their engine."""
    return create_local_engine(settings, url=url)


def create_local_engine(runtime_settings: Settings, *, url: str | None = None) -> AsyncEngine:
    """Create a local engine from the supplied composition settings and environment."""
    configured_url = (
        runtime_settings.animama_database_url
        if "animama_database_url" in runtime_settings.model_fields_set
        else _default_db_url()
    )
    raw_url = url or configured_url
    cleaned_url, sslmode_from_url = _extract_sslmode(raw_url)

    # Prefer explicit PGSSLMODE env var over URL query.
    sslmode = os.getenv("PGSSLMODE") or sslmode_from_url
    # For consistency with other stacks, allow `PGSSL=true` as shorthand.
    if not sslmode and os.getenv("PGSSL") == "true":
        sslmode = "require"

    connect_args: dict[str, object] = {}
    if sslmode:
        ctx = _asyncpg_ssl_context(sslmode)
        if ctx is not None:
            connect_args["ssl"] = ctx

    # SQLAlchemy expects connect_args to be a mapping; passing None breaks engine creation.
    engine = create_async_engine(cleaned_url, connect_args=connect_args, **_pool_kwargs(runtime_settings))
    try:
        from animama.server.telemetry import instrument_sqlalchemy

        instrument_sqlalchemy(engine)
    except Exception:
        # Telemetry is optional; never block engine creation.
        pass
    return engine


class LocalDatabase:
    """Lazy database resources owned by one app or CLI, never a shared singleton."""

    def __init__(self, runtime_settings: Settings) -> None:
        self._settings = runtime_settings
        self._engine: AsyncEngine | None = None
        self._factory: async_sessionmaker[AsyncSession] | None = None
        self._loop: asyncio.AbstractEventLoop | None = None

    def session_factory(self) -> async_sessionmaker[AsyncSession]:
        """Initialize on the serving loop and reject accidental cross-loop reuse."""
        loop = asyncio.get_running_loop()
        if self._factory is not None and self._loop is not loop:
            raise RuntimeError("Local database cannot be reused across event loops before disposal")
        if self._factory is None:
            self._engine = create_local_engine(self._settings)
            self._factory = async_sessionmaker(self._engine, expire_on_commit=False)
            self._loop = loop
        return self._factory

    async def close(self) -> None:
        """Dispose only this composition's engine on shutdown."""
        if self._engine is not None:
            await self._engine.dispose()
        self._engine = None
        self._factory = None
        self._loop = None


async def dispose_engine(*, engine: AsyncEngine | None = None, url: str | None = None) -> None:
    """Dispose the cached engine and clear it from the cache."""

    candidate = engine
    if candidate is None:
        try:
            candidate = get_engine(url)
        except Exception:
            candidate = None
    if candidate is None:
        return

    try:
        await candidate.dispose()
    finally:
        cache_clear = getattr(get_engine, "cache_clear", None)
        if cache_clear is not None:
            cache_clear()


async def create_all(url: str | None = None) -> None:
    """Create the complete local ORM schema, including its installation model."""
    from animama.local import installation_model  # noqa: F401

    engine = get_engine(url)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
