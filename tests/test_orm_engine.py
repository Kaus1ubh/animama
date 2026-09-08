from __future__ import annotations

import importlib
from typing import Any


def test_get_engine_passes_explicit_pool_settings(monkeypatch) -> None:
    import animama.hooks as hookmod
    from animama.local import database as engine_mod

    patched_get_engine = engine_mod.get_engine
    patched_hook_get_engine = hookmod.get_engine
    engine_mod = importlib.reload(engine_mod)
    engine_mod.get_engine.cache_clear()
    calls: list[dict[str, Any]] = []
    sentinel = object()

    def _fake_create_async_engine(url: str, **kwargs: Any) -> object:
        calls.append({"url": url, **kwargs})
        return sentinel

    monkeypatch.setattr(engine_mod, "create_async_engine", _fake_create_async_engine)
    monkeypatch.setattr(engine_mod.settings, "animama_database_pool_size", 7)
    monkeypatch.setattr(engine_mod.settings, "animama_database_max_overflow", 3)
    monkeypatch.setattr(engine_mod.settings, "animama_database_pool_timeout_seconds", 12.5)
    monkeypatch.setattr(engine_mod.settings, "animama_database_pool_recycle_seconds", 1800)
    monkeypatch.setattr(engine_mod.settings, "animama_database_pool_pre_ping", True)

    try:
        assert engine_mod.get_engine("postgresql+asyncpg://user:pass@localhost:5432/anima") is sentinel
    finally:
        engine_mod.get_engine.cache_clear()
        engine_mod.get_engine = patched_get_engine  # type: ignore[method-assign]
        hookmod.get_engine = patched_hook_get_engine  # type: ignore[method-assign]

    assert calls == [
        {
            "url": "postgresql+asyncpg://user:pass@localhost:5432/anima",
            "connect_args": {},
            "pool_size": 7,
            "max_overflow": 3,
            "pool_timeout": 12.5,
            "pool_recycle": 1800,
            "pool_pre_ping": True,
        }
    ]
