"""Runtime provider credentials: validation, ordering, pinning and removal."""

from __future__ import annotations

import asyncio

import pytest

from animama.app.model_clients.credential_store import (
    CredentialStoreError,
    RuntimeCredentialStore,
    credential_values_from_environment,
)
from animama.app.model_clients.credentials import (
    CREDENTIAL_CONFIGURED,
    CREDENTIAL_MISSING,
    CREDENTIAL_NOT_REQUIRED,
    StoreModelCredentialResolver,
    builtin_openai_connection,
)
from animama.domain.model_connection import ModelConnection

SENTINEL = "sk-SENTINEL-" + "x" * 40


def _connection(env: str | None) -> ModelConnection:
    return ModelConnection(
        id="c1", name="Local", preset="openai_compatible", source="owner", base_url="http://x/v1", credential_env=env
    )


def test_environment_values_keep_only_credential_names() -> None:
    values = credential_values_from_environment(
        {
            "OPENAI_API_KEY": "  sk-openai  ",
            "ELEVENLABS_API_KEY": "el",
            "HF_TOKEN": "hf",
            "ANIMAMA_CONNECTION_C1_API_KEY": "c1",
            "ANIMAMA_DATABASE_URL": "postgresql://secret",
            "PATH": "/bin",
            "DEEPSEEK_API_KEY": "   ",
        }
    )

    assert values == {
        "OPENAI_API_KEY": "sk-openai",
        "ELEVENLABS_API_KEY": "el",
        "HF_TOKEN": "hf",
        "ANIMAMA_CONNECTION_C1_API_KEY": "c1",
    }


def test_replace_swaps_the_whole_snapshot_and_removes_absent_names() -> None:
    store = RuntimeCredentialStore({"OPENAI_API_KEY": "sk-old", "ANIMAMA_CONNECTION_C1_API_KEY": "c1"})

    snapshot = store.replace({"ELEVENLABS_API_KEY": SENTINEL}, generation=1)

    assert snapshot.generation == 1
    assert store.snapshot().get("OPENAI_API_KEY") is None
    assert store.snapshot().get("ANIMAMA_CONNECTION_C1_API_KEY") is None
    assert store.snapshot().get("ELEVENLABS_API_KEY") == SENTINEL


def test_snapshot_repr_never_contains_values() -> None:
    store = RuntimeCredentialStore({"OPENAI_API_KEY": SENTINEL})

    assert SENTINEL not in repr(store.snapshot())
    assert SENTINEL not in str(store.snapshot())
    assert SENTINEL not in repr(store)


@pytest.mark.parametrize("generation", [0, -1, 1.5, True, "2"])
def test_replace_refuses_a_generation_that_is_not_newer(generation: object) -> None:
    store = RuntimeCredentialStore({"OPENAI_API_KEY": "sk-old"})
    with pytest.raises(CredentialStoreError) as caught:
        store.replace({"OPENAI_API_KEY": SENTINEL}, generation=generation)  # type: ignore[arg-type]

    assert store.snapshot().get("OPENAI_API_KEY") == "sk-old"
    assert SENTINEL not in str(caught.value)


def test_replace_refuses_an_older_generation_after_a_newer_one() -> None:
    store = RuntimeCredentialStore()
    store.replace({"OPENAI_API_KEY": "sk-new"}, generation=5)

    with pytest.raises(CredentialStoreError) as caught:
        store.replace({"OPENAI_API_KEY": SENTINEL}, generation=4)

    assert caught.value.code == "credentials_generation_stale"
    assert store.snapshot().get("OPENAI_API_KEY") == "sk-new"


@pytest.mark.parametrize(
    "name",
    [
        "PATH",
        "PYTHONPATH",
        "DYLD_INSERT_LIBRARIES",
        "LD_PRELOAD",
        "ANIMAMA_DATABASE_URL",
        "DEEPSEEK_API_KEY",
        "HF_TOKEN",
        "openai_api_key",
        "ANIMAMA_CONNECTION_c1_API_KEY",
        "ANIMAMA_CONNECTION_" + "A" * 65 + "_API_KEY",  # one over the 64-character id limit
        "ANIMAMA_CONNECTION__API_KEY",
        "OPENAI_API_KEY\n",
        "",
    ],
)
def test_replace_refuses_names_outside_the_deliverable_allowlist(name: str) -> None:
    store = RuntimeCredentialStore({"OPENAI_API_KEY": "sk-old"})

    with pytest.raises(CredentialStoreError) as caught:
        store.replace({name: SENTINEL}, generation=1)

    assert caught.value.code == "credentials_invalid"
    assert SENTINEL not in str(caught.value)
    assert store.snapshot().get("OPENAI_API_KEY") == "sk-old"


@pytest.mark.parametrize(
    "value",
    ["", " ", "sk with space", "sk\tkey", "sk\x00key", "sk\x7fkey", "x" * 8193, 42, None],
    ids=["empty", "space", "inner-space", "tab", "nul", "del", "too-long", "int", "none"],
)
def test_replace_refuses_invalid_values(value: object) -> None:
    store = RuntimeCredentialStore()

    with pytest.raises(CredentialStoreError) as caught:
        store.replace({"OPENAI_API_KEY": value}, generation=1)

    assert caught.value.code == "credentials_invalid"
    assert store.snapshot().get("OPENAI_API_KEY") is None


def test_replace_accepts_the_limits_and_refuses_one_more_connection() -> None:
    store = RuntimeCredentialStore()
    connections = {f"ANIMAMA_CONNECTION_C{index}_API_KEY": "k" * 8192 for index in range(32)}

    store.replace({"OPENAI_API_KEY": "o", "ELEVENLABS_API_KEY": "e", **connections}, generation=1)
    with pytest.raises(CredentialStoreError):
        store.replace({**connections, "ANIMAMA_CONNECTION_EXTRA_API_KEY": "k"}, generation=2)

    assert store.snapshot().generation == 1


def test_subscribers_see_previous_and_current_snapshots() -> None:
    store = RuntimeCredentialStore({"OPENAI_API_KEY": "sk-old"})
    seen: list[tuple[str | None, str | None]] = []
    store.subscribe(
        lambda previous, current: seen.append((previous.get("OPENAI_API_KEY"), current.get("OPENAI_API_KEY")))
    )

    store.replace({"OPENAI_API_KEY": "sk-new"}, generation=1)
    store.replace({}, generation=2)

    assert seen == [("sk-old", "sk-new"), ("sk-new", None)]


def test_pinned_snapshot_survives_a_replace_until_the_scope_ends() -> None:
    store = RuntimeCredentialStore({"OPENAI_API_KEY": "sk-old"})

    with store.pinned():
        store.replace({"OPENAI_API_KEY": "sk-new"}, generation=1)
        assert store.current().get("OPENAI_API_KEY") == "sk-old"
    assert store.current().get("OPENAI_API_KEY") == "sk-new"


async def test_tasks_started_by_a_pinned_request_inherit_its_snapshot() -> None:
    store = RuntimeCredentialStore({"OPENAI_API_KEY": "sk-old"})
    started = asyncio.Event()
    swapped = asyncio.Event()

    async def request() -> list[str | None]:
        with store.pinned():
            first = store.current().get("OPENAI_API_KEY")
            started.set()
            await swapped.wait()

            async def child() -> str | None:
                return store.current().get("OPENAI_API_KEY")

            return [first, store.current().get("OPENAI_API_KEY"), await asyncio.create_task(child())]

    task = asyncio.create_task(request())
    await started.wait()
    store.replace({"OPENAI_API_KEY": "sk-new"}, generation=1)
    swapped.set()

    assert await task == ["sk-old", "sk-old", "sk-old"]
    assert store.current().get("OPENAI_API_KEY") == "sk-new"


def test_resolver_reads_the_current_snapshot_per_call() -> None:
    store = RuntimeCredentialStore({"OPENAI_API_KEY": "sk-old", "ANIMAMA_CONNECTION_C1_API_KEY": "c1"})
    resolver = StoreModelCredentialResolver(store)
    owner = _connection("ANIMAMA_CONNECTION_C1_API_KEY")

    assert resolver.resolve(builtin_openai_connection()).api_key == "sk-old"
    assert resolver.resolve(owner).state == CREDENTIAL_CONFIGURED

    store.replace({"OPENAI_API_KEY": "sk-new"}, generation=1)

    assert resolver.resolve(builtin_openai_connection()).api_key == "sk-new"
    assert resolver.resolve(owner).state == CREDENTIAL_MISSING
    assert resolver.resolve(_connection(None)).state == CREDENTIAL_NOT_REQUIRED
    assert resolver.resolve(_connection("ANIMAMA_DATABASE_URL")).state == CREDENTIAL_MISSING
