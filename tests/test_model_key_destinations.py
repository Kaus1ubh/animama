"""A stored key goes only to its provider's API or to the origin saved with it.

These tests use synthetic keys and never call a provider.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import replace
from typing import cast
from uuid import uuid4

import httpx2
import pytest
from openai import AsyncOpenAI

from animama.adapters.memory_manager.openai_agents_runtime import OpenAIAgentsMemoryManagerRuntime
from animama.adapters.model_clients import OpenAIChatCompletionsModelClient
from animama.adapters.model_clients.openai_chat_completions.embedder import ConnectionEmbedder
from animama.adapters.model_clients.openai_chat_completions.probe import OpenAICompatibleConnectionProbe
from animama.app.model_clients import ModelClientProviderError
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
    managed_credential_env,
    static_credential_resolver,
)
from animama.app.model_clients.key_origins import canonical_origin
from animama.app.model_clients.probe import ModelConnectionProbeError
from animama.app.ports.memory_manager_runtime import MemoryManagerRuntimeConfigurationError
from animama.app.services.memory_entry_service import MemoryEntryService
from animama.domain import ModelConnection
from tests.local_http_client import local_client
from tests.test_embeddings_role import _embedding_row
from tests.test_model_client_registry import _collect, _spec
from tests.test_model_configuration_api import _app, _connection_body

LAB_KEY = "ANIMAMA_CONNECTION_LAB_API_KEY"
LAB_ORIGIN = "ANIMAMA_CONNECTION_LAB_ORIGIN"


@pytest.fixture
def owner_id() -> str:
    return f"owner-{uuid4().hex[:8]}"


def _connection(base_url: str, credential_env: str | None) -> ModelConnection:
    return ModelConnection(
        id="c_lab", name="Lab", preset="custom", source="owner", base_url=base_url, credential_env=credential_env
    )


@pytest.mark.parametrize(
    ("name", "base_url", "refusal"),
    [
        ("OPENAI_API_KEY", "https://api.openai.com/v1", None),
        ("DEEPSEEK_API_KEY", "https://api.deepseek.com", None),
        ("HF_TOKEN", "https://router.huggingface.co/v1", None),
        ("OPENROUTER_API_KEY", "https://openrouter.ai/api/v1", None),
        ("OPENAI_API_KEY", "https://openai-proxy.example.test/v1", "credential_origin_mismatch"),
        ("OPENROUTER_API_KEY", "https://openrouter.ai.example.test/api/v1", "credential_origin_mismatch"),
        ("HF_TOKEN", "https://huggingface.co/v1", "credential_origin_mismatch"),
        ("DEEPSEEK_API_KEY", "http://api.deepseek.com", "credential_insecure_transport"),
    ],
)
def test_a_provider_key_goes_only_to_its_providers_api(name: str, base_url: str, refusal: str | None) -> None:
    credential = static_credential_resolver({name: "sk-provider"}).resolve(_connection(base_url, name))

    assert credential.refusal == refusal
    assert credential.state == (CREDENTIAL_CONFIGURED if refusal is None else CREDENTIAL_MISSING)
    assert credential.api_key == ("sk-provider" if refusal is None else None)


@pytest.mark.parametrize(
    ("base_url", "saved_origin", "refusal"),
    [
        ("https://lab.example.test/v1", "https://lab.example.test", None),
        # Another spelling of the same origin.
        ("https://LAB.example.test:443/v1", "https://lab.example.test", None),
        ("https://lab.example.test:8443/v1", "https://lab.example.test", "credential_origin_mismatch"),
        ("https://other.example.test/v1", "https://lab.example.test", "credential_origin_mismatch"),
        ("https://lab.example.test/v1", None, "credential_origin_missing"),
        ("https://lab.example.test/v1", "not an origin", "credential_origin_missing"),
        # Plain HTTP only to this computer.
        ("http://127.0.0.1:8000/v1", "http://127.0.0.1:8000", None),
        ("http://localhost:1234/v1", "http://localhost:1234", None),
        ("http://host.docker.internal:8000/v1", "http://host.docker.internal:8000", None),
        ("http://[::1]:8080/v1", "http://[::1]:8080", None),
        ("http://192.168.1.20:8000/v1", "http://192.168.1.20:8000", "credential_insecure_transport"),
        ("http://lab.lan:8000/v1", "http://lab.lan:8000", "credential_insecure_transport"),
        # Origins as a browser's URL.origin writes them, which the vault stores.
        ("https://[::ffff:10.0.0.5]/v1", "https://[::ffff:a00:5]", None),
        ("https://api..example.test/v1", "https://api..example.test", None),
        ("https://xn--fa-hia.de/v1", "https://xn--fa-hia.de", None),
        # A non-ASCII host name never matches: IDNA standards disagree on some
        # names (faß.de is xn--fa-hia.de to the HTTP client, fass.de to IDNA 2003).
        ("https://faß.de/v1", "https://fass.de", "credential_origin_mismatch"),
        ("https://faß.de/v1", "https://xn--fa-hia.de", "credential_origin_mismatch"),
        ("https://σοφιας.gr/v1", "https://xn--mxaprpdp.gr", "credential_origin_mismatch"),
        # An empty user part once hid the brackets, so these two compared equal.
        ("https://@[2001:db8::1]:8443/v1", "https://@[2001:db8::1:8443]", "credential_origin_mismatch"),
        ("https://例え.jp/v1", "https://xn--r8jz45g.jp", "credential_origin_mismatch"),
    ],
)
def test_a_connection_key_goes_only_to_the_origin_saved_with_it(
    base_url: str, saved_origin: str | None, refusal: str | None
) -> None:
    keys = {LAB_KEY: "sk-lab", **({LAB_ORIGIN: saved_origin} if saved_origin else {})}
    credential = static_credential_resolver(keys).resolve(_connection(base_url, LAB_KEY))

    assert credential.refusal == refusal
    assert credential.api_key == ("sk-lab" if refusal is None else None)


def test_a_keyless_connection_is_unaffected() -> None:
    credential = static_credential_resolver().resolve(_connection("http://192.168.1.20:8000/v1", None))

    assert (credential.state, credential.refusal) == (CREDENTIAL_NOT_REQUIRED, None)


def test_a_delivery_carries_canonical_origins_beside_connection_keys() -> None:
    store = RuntimeCredentialStore()
    store.replace({LAB_KEY: "sk-lab", LAB_ORIGIN: "https://lab.example.test"}, generation=1)
    resolver = StoreModelCredentialResolver(store)

    assert resolver.resolve(_connection("https://lab.example.test/v1", LAB_KEY)).api_key == "sk-lab"
    # A later delivery without the origin leaves the key unused.
    store.replace({LAB_KEY: "sk-lab"}, generation=2)
    assert resolver.resolve(_connection("https://lab.example.test/v1", LAB_KEY)).api_key is None


@pytest.mark.parametrize(
    ("url", "origin"),
    [
        # The forms a browser's URL.origin gives, which the desktop vault stores.
        ("http://[0:0:0:0:0:0:0:1]:8080/v1", "http://[::1]:8080"),
        ("https://LAB.example.test.:443/v1", "https://lab.example.test."),
        ("https://xn--r8jz45g.jp/v1", "https://xn--r8jz45g.jp"),
        # No key matches a non-ASCII name, user information (even empty), a
        # percent sign or a bracketed host that is not IPv6.
        ("https://例え.jp/v1", None),
        ("https://faß.de/v1", None),
        ("https://\u212aey.example/v1", None),
        ("https://[v1.fe]/v1", None),
        ("https://@[2001:db8::1]:8443/v1", None),
        ("https://@lab.example.test/v1", None),
        ("https://:@lab.example.test/v1", None),
        ("https://[fe80::1%eth0]/v1", None),
        ("https://lab%2eexample.test/v1", None),
        # An ASCII name stays as written; a spelling a browser rewrites, such as
        # 127.1, therefore never matches and its key is withheld.
        ("http://127.1/v1", "http://127.1"),
        ("https://api..example.test/v1", "https://api..example.test"),
    ],
)
def test_origins_compare_in_the_form_a_browser_gives(url: str, origin: str | None) -> None:
    assert canonical_origin(url) == origin


@pytest.mark.parametrize(
    "origin",
    [
        "https://lab.example.test/",
        "HTTPS://lab.example.test",
        "https://lab.example.test/v1",
        "https://lab.example.test?",
        "https://lab.example.test:99999",
        "ftp://lab.example.test",
        "https://user:secret@lab.example.test",
        "lab.example.test",
        "https://faß.de",
        "https://[v1.fe]",
        "https://@[v1.fe]",
        "https://@lab.example.test",
        "https://@[2001:db8::1:8443]",
        "https://[fe80::1%eth0]",
        "https://lab%2eexample.test",
        "https://\u212aey.example",
        "https://lab.example.test\u3000",
    ],
)
def test_a_delivery_refuses_a_value_that_is_not_an_origin(origin: str) -> None:
    with pytest.raises(CredentialStoreError, match="credentials_invalid"):
        RuntimeCredentialStore().replace({LAB_KEY: "sk-lab", LAB_ORIGIN: origin}, generation=1)


def test_an_origin_that_matches_no_address_withholds_only_its_own_key() -> None:
    store = RuntimeCredentialStore()
    store.replace(
        {
            "OPENAI_API_KEY": "sk-openai",
            LAB_KEY: "sk-lab",
            LAB_ORIGIN: "https://[::ffff:a00:5]",
            "ANIMAMA_CONNECTION_OTHER_API_KEY": "sk-other",
            "ANIMAMA_CONNECTION_OTHER_ORIGIN": "https://other.example.test",
        },
        generation=1,
    )
    resolver = StoreModelCredentialResolver(store)
    other = replace(_connection("https://other.example.test/v1", "ANIMAMA_CONNECTION_OTHER_API_KEY"), id="c_other")

    assert resolver.resolve(_connection("https://lab.example.test/v1", LAB_KEY)).api_key is None
    assert resolver.resolve(_connection("https://[::ffff:10.0.0.5]/v1", LAB_KEY)).api_key == "sk-lab"
    assert resolver.resolve(other).api_key == "sk-other"
    assert store.snapshot().get("OPENAI_API_KEY") == "sk-openai"


def test_startup_reads_an_operators_origin_beside_the_key() -> None:
    values = credential_values_from_environment(
        {LAB_KEY: "sk-lab", LAB_ORIGIN: " https://lab.example.test ", "ANIMAMA_DATABASE_URL": "postgres://"}
    )

    assert values == {LAB_KEY: "sk-lab", LAB_ORIGIN: "https://lab.example.test"}


@pytest.mark.parametrize(
    ("body", "code"),
    [
        (
            {
                "preset": "custom",
                "base_url": "https://openai-proxy.example.test/v1",
                "credential": {"mode": "env", "env": "OPENAI_API_KEY"},
            },
            "credential_origin_mismatch",
        ),
        (
            {
                "preset": "custom",
                "base_url": "http://192.168.1.20:8000/v1",
                "credential": {"mode": "env", "env": LAB_KEY},
            },
            "credential_insecure_transport",
        ),
        (
            {"preset": "vllm", "base_url": "http://192.168.1.20:8000/v1", "credential": {"mode": "managed"}},
            "credential_insecure_transport",
        ),
        (
            {
                "preset": "custom",
                "base_url": "https://other.example.test/v1",
                "credential": {"mode": "env", "env": LAB_KEY},
            },
            "credential_origin_mismatch",
        ),
    ],
)
async def test_saving_refuses_a_key_that_could_never_reach_the_address(
    async_session, tmp_path, owner_id, set_runtime_credentials, body, code
) -> None:
    set_runtime_credentials(OPENAI_API_KEY="sk-openai", **{LAB_KEY: "sk-lab", LAB_ORIGIN: "https://lab.example.test"})
    name = f"Refused {uuid4().hex[:8]}"
    async with local_client(_app(async_session, tmp_path, owner_id)) as client:
        refused = await client.post("/v1/model-connections", json=_connection_body(name=name, **body))
        listed = await client.get("/v1/model-connections")

    assert refused.status_code == 400
    assert refused.json()["detail"]["code"] == code
    assert name not in [connection["name"] for connection in listed.json()]


async def test_an_operators_key_without_an_origin_is_saved_but_not_sent(
    async_session, tmp_path, owner_id, set_runtime_credentials
) -> None:
    set_runtime_credentials(**{LAB_KEY: "sk-lab"})
    async with local_client(_app(async_session, tmp_path, owner_id)) as client:
        created = await client.post(
            "/v1/model-connections",
            json=_connection_body(
                name="Lab",
                preset="custom",
                base_url="https://lab.example.test/v1",
                credential={"mode": "env", "env": LAB_KEY},
            ),
        )

    assert created.status_code == 201
    assert created.json()["credential_state"] == CREDENTIAL_MISSING


async def test_a_desktop_key_saved_for_one_address_is_not_sent_to_another(
    async_session, tmp_path, owner_id, set_runtime_credentials
) -> None:
    async with local_client(_app(async_session, tmp_path, owner_id)) as client:
        created = (
            await client.post(
                "/v1/model-connections",
                json=_connection_body(
                    name="Lab", preset="vllm", base_url="https://lab.example.test/v1", credential={"mode": "managed"}
                ),
            )
        ).json()
        managed = managed_credential_env(created["id"])
        # Main delivers the key with the origin it was entered for.
        set_runtime_credentials(
            **{managed: "sk-lab", managed.removesuffix("_API_KEY") + "_ORIGIN": "https://lab.example.test"}
        )
        saved = (await client.get("/v1/model-connections")).json()
        moved = await client.patch(
            f"/v1/model-connections/{created['id']}", json={"base_url": "https://elsewhere.example.test/v1"}
        )

    assert next(row for row in saved if row["id"] == created["id"])["credential_state"] == CREDENTIAL_CONFIGURED
    # The address may change; the key waits to be entered again for it.
    assert moved.status_code == 200
    assert moved.json()["credential_state"] == CREDENTIAL_MISSING


REFUSED_KEYS = [
    pytest.param({LAB_KEY: "sk-lab"}, id="no-origin"),
    pytest.param({LAB_KEY: "sk-lab", LAB_ORIGIN: "https://elsewhere.example.test"}, id="another-origin"),
]


@pytest.fixture
def sdk_requests(monkeypatch: pytest.MonkeyPatch) -> Iterator[list[httpx2.Request]]:
    """Record every request an OpenAI SDK client sends; none should arrive."""

    requests: list[httpx2.Request] = []
    original_init = AsyncOpenAI.__init__

    def _record(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        return httpx2.Response(500)

    def _init(self, *args, **kwargs):  # noqa: ANN001, ANN002, ANN003
        kwargs["http_client"] = httpx2.AsyncClient(transport=httpx2.MockTransport(_record))
        original_init(self, *args, **kwargs)

    monkeypatch.setattr(AsyncOpenAI, "__init__", _init)
    yield requests


@pytest.mark.parametrize("keys", REFUSED_KEYS)
async def test_no_model_path_sends_a_key_saved_for_another_address(
    sdk_requests: list[httpx2.Request], keys: dict[str, str]
) -> None:
    connection = _connection("https://lab.example.test/v1", LAB_KEY)
    resolver = static_credential_resolver(keys)
    probe = OpenAICompatibleConnectionProbe(credential_resolver=resolver)
    chat = OpenAIChatCompletionsModelClient(credential_resolver=resolver, client=None)
    embedder = ConnectionEmbedder(
        _embedding_row(connection),
        credential_resolver=resolver,
        openai_base_url="https://api.openai.com/v1",
        default_timeout_seconds=5.0,
    )
    row = replace(_embedding_row(connection), id="owner:lab", model_kind="chat")
    memory_manager = OpenAIAgentsMemoryManagerRuntime(
        user_id="user-1",
        memory_entries=cast(MemoryEntryService, object()),
        model_provider=row,
        credential_resolver=resolver,
        openai_base_url=None,
        timeout_seconds=1.0,
    )

    with pytest.raises(ModelConnectionProbeError) as listing:
        await probe.list_models(connection)
    with pytest.raises(ModelConnectionProbeError) as probing:
        await probe.probe_chat_model(connection, model="lab-model")
    with pytest.raises(ModelClientProviderError) as chatting:
        await _collect(chat.stream(_spec(model="lab-model", connection=connection)))
    with pytest.raises(ModelClientProviderError) as embedding:
        await embedder.embed_texts(["a"])
    with pytest.raises(MemoryManagerRuntimeConfigurationError):
        memory_manager._require_model()  # noqa: SLF001
    await chat.aclose()

    assert listing.value.category == probing.value.category == "credential_missing"
    assert chatting.value.code == embedding.value.code == "missing_api_key"
    assert sdk_requests == []


async def test_moving_an_operators_key_to_another_address_is_refused(
    async_session, tmp_path, owner_id, set_runtime_credentials
) -> None:
    set_runtime_credentials(**{LAB_KEY: "sk-lab", LAB_ORIGIN: "https://lab.example.test"})
    name = f"Lab {uuid4().hex[:8]}"
    async with local_client(_app(async_session, tmp_path, owner_id)) as client:
        created = await client.post(
            "/v1/model-connections",
            json=_connection_body(
                name=name,
                preset="custom",
                base_url="https://lab.example.test/v1",
                credential={"mode": "env", "env": LAB_KEY},
            ),
        )
        moved = await client.patch(
            f"/v1/model-connections/{created.json()['id']}", json={"base_url": "https://elsewhere.example.test/v1"}
        )

    assert (created.status_code, created.json()["credential_state"]) == (201, CREDENTIAL_CONFIGURED)
    assert moved.status_code == 400
    assert moved.json()["detail"]["code"] == "credential_origin_mismatch"


async def test_a_key_never_follows_its_address_to_a_look_alike_name(
    async_session, tmp_path, owner_id, set_runtime_credentials
) -> None:
    set_runtime_credentials(**{LAB_KEY: "sk-lab", LAB_ORIGIN: "https://fass.de"})
    async with local_client(_app(async_session, tmp_path, owner_id)) as client:
        created = await client.post(
            "/v1/model-connections",
            json=_connection_body(
                name=f"Lab {uuid4().hex[:8]}",
                preset="custom",
                base_url="https://fass.de/v1",
                credential={"mode": "env", "env": LAB_KEY},
            ),
        )
        moved = await client.patch(
            f"/v1/model-connections/{created.json()['id']}", json={"base_url": "https://faß.de/v1"}
        )
        managed = (
            await client.post(
                "/v1/model-connections",
                json=_connection_body(
                    name=f"Desk {uuid4().hex[:8]}",
                    preset="vllm",
                    base_url="https://fass.de/v1",
                    credential={"mode": "managed"},
                ),
            )
        ).json()
        managed_env = managed_credential_env(managed["id"])
        set_runtime_credentials(
            **{managed_env: "sk-desk", managed_env.removesuffix("_API_KEY") + "_ORIGIN": "https://fass.de"}
        )
        desk_moved = await client.patch(
            f"/v1/model-connections/{managed['id']}", json={"base_url": "https://faß.de/v1"}
        )

    assert created.json()["credential_state"] == CREDENTIAL_CONFIGURED
    assert moved.status_code == 400
    assert moved.json()["detail"]["code"] == "credential_origin_mismatch"
    assert desk_moved.status_code == 200
    assert desk_moved.json()["credential_state"] == CREDENTIAL_MISSING


async def test_a_key_may_travel_over_plain_http_to_this_computer(
    async_session, tmp_path, owner_id, set_runtime_credentials
) -> None:
    set_runtime_credentials(**{LAB_KEY: "sk-lab", LAB_ORIGIN: "http://127.0.0.1:8000"})
    async with local_client(_app(async_session, tmp_path, owner_id)) as client:
        created = await client.post(
            "/v1/model-connections",
            json=_connection_body(
                name=f"Lab {uuid4().hex[:8]}",
                preset="custom",
                base_url="http://127.0.0.1:8000/v1",
                credential={"mode": "env", "env": LAB_KEY},
            ),
        )

    assert (created.status_code, created.json()["credential_state"]) == (201, CREDENTIAL_CONFIGURED)
