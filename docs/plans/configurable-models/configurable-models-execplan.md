# Configurable models execution plan (Plan A)

Status: In progress. All phases authorized.
Source agreement: [Configurable models spec](configurable-models-spec.md),
accepted by the owner on 2026-09-26 when execution planning was invoked, with
the removal behavior (R2), summarizing indicator (R10), shared web-search
control (R11) and guardrail-only posture for non-OpenAI models agreed the same
day.
Authorized scope: phases 1–6, by the owner's `/implement` instruction on
2026-09-26. Exact-candidate merge approval stays separate.

This plan delivers spec R1–R9 and their R13 documentation. Plan B (R10–R12:
pre-send compaction, application web search and structured-output handling) is
a separate ExecPlan, `configurable-models-features-execplan.md`, written after
this plan merges because it builds on the connection, probe and role
structures introduced here.

## Purpose and context

After this plan, an installation owner on desktop or self-hosted web can:

- add OpenAI-compatible Chat Completions **model connections** (Ollama,
  LM Studio, llama.cpp, vLLM, DeepSeek, Hugging Face router or custom), with
  keys held outside the database;
- add models under any connection, including a newly released OpenAI model
  under the built-in OpenAI connection, by copying a built-in model's
  capabilities or running a capability probe;
- assign **model roles** for chat default, utility (titles and compaction),
  memory manager and embeddings;
- run a fully local companion with no OpenAI key.

The hosted composition gains nothing configurable: owner management routes are
mounted only by the local application, and shared catalog code takes its
policy as a composition input.

The spec is the requirements authority; this plan records how to implement and
verify it.

Repository `raymond-van/animama`, worktree
`worktrees/animama/configurable-models`, branch `feat/configurable-models`
tracking `origin/feat/configurable-models`. Starting revision `feb6ad3`
(`main` after the 0.1.1 release). The primary
checkout stays on `main`. No Cloud checkout or private input is needed.

Follow:

- [SDLC](../../../SDLC.md), [PLANS](../../../PLANS.md), the root guide and the
  [backend](../../../src/backend/AGENTS.md) and
  [frontend](../../../src/frontend/AGENTS.md) guides;
- [ADR 0001](../../adr/0001-independent-local-product-and-packaged-sharing.md):
  shared code takes explicit composition inputs;
- [ADR 0002](../../adr/0002-accountless-installation-and-http-admission.md): a
  single installation owner; no browser credentials;
- [ADR 0003](../../adr/0003-request-local-streamed-chat.md): request-local
  turns and one `run.completed`;
- [ADR 0008](../../adr/0008-non-overridable-companion-guardrail.md): the
  guardrail is the final instruction on every provider.

Standing rules:

- No Alembic revisions. Edit the ORM and `alembic/versions/0001_baseline.sql`
  together and update `BASELINE_SHA256` and the table count in
  `tests/test_alembic_fresh_install.py`. Task stacks need a reset after schema
  changes (see Idempotence and recovery).
- Regenerate the SDK offline with `pnpm openapi-ts` from a Python 3.12.13
  environment so OpenAPI wording matches CI; never hand-edit
  `packages/runtime-contracts/src/generated/**`.
- `animama.app` and `animama.domain` must not import `animama.server`,
  `animama.local` or `animama.runtime`
  (`scripts/repository-boundary/check-python-imports.py`). Environment reads
  and local-only routes live in `server/` or `local/`; shared code receives
  ports or values.
- Keys never enter the database, API responses, logs, diagnostics or test
  fixtures with real values.

## Progress

- [x] Discovery and spec accepted (2026-09-26).
- [x] Repository investigation for Plan A (2026-09-26); findings under
      Surprises & Discoveries.
- [x] Plan drafted (2026-09-26).
- [x] Owner authorized all phases via `/implement` (2026-09-26).
- [x] Workspace setup (2026-09-26): branch fast-forwarded to `main` `feb6ad3`;
      spec and plan committed `37abfed` and pushed; parent #165 with sub-issues
      #171 (p1), #166 (p2), #167 (p3), #168 (p4), #169 (p5), #170 (p6), chained
      blocked-by.
- [x] Phase 1: connection-aware catalog and credential isolation (review #2
      pass; commit recorded below).
- [x] Phase 2: owner management API, probe and composition boundary (review
      #2 pass; commit recorded below).
- [x] Phase 3: Chat Completions turn parity and errors (review #2 pass; commit
      recorded below).
- [ ] Phase 4: model roles and fully local operation.
- [ ] Phase 5: App Settings, model selector and desktop keys.
- [ ] Phase 6: documentation, decisions and acceptance gates G1–G3.
- [ ] Final integration review.
- [ ] PR, hosted Validation and owner merge approval.

## Surprises & Discoveries

Observed on `2064540` during planning.

**Security and correctness**

- **The OpenAI key goes to unknown base URLs.** Chat Completions picks a key by
  exact base URL and otherwise falls back to `OPENAI_API_KEY`
  (`adapters/model_clients/openai_chat_completions/client.py:271-279`).
  Responses always sends the OpenAI key to the row's base URL
  (`openai_responses/client.py:357-370`). A connection with an owner-supplied
  URL would receive the OpenAI key. Keyless servers are rejected with
  `missing_api_key` (`client.py:85-96`), and `AsyncOpenAI(api_key="")` itself
  raises. Phase 1 fixes this before any owner connection can run.
- **One row per `(provider_type, model)`.** `model_providers` has that unique
  constraint (`orm/model_provider.py:18`), and
  `chat_messages(model_provider, model)` has a composite foreign key to it
  (`0001_baseline.sql:1572-1573`). Two connections serving `qwen3:8b` would
  collide. `anima_chat_profiles.default_model_provider_id` is a NOT NULL
  foreign key to `model_providers.id` (`:1497-1498`), so referenced rows can
  only be retired, never deleted.
- **The seed never retires rows.** `01-seed-model-providers.sql` upserts on `id`
  only; removed catalog entries stay active in existing databases.
  `ModelProviderCatalogService.sync_from_registry` would retire every row not
  in the static catalog, including future owner rows, but has no production
  caller. Nothing marks a row as built-in or owner-added.
- **`GET /v1/model-providers` hides database failures.** It returns the static
  catalog when the query is empty or raises (`server/routers/model_provider.py:24-30`),
  which would silently drop owner rows.
- **Provider quirks are inferred.** DeepSeek and Hugging Face behavior is chosen
  from row metadata, base URL or a `deepseek-v4-` model prefix
  (`openai_chat_completions/request.py:59-128`). Unknown chunk extras such as
  `reasoning_content` produce `unknown_provider_event` warnings except for the
  Hugging Face allowlist (`client.py:286-290`).
- **A model without tools cannot chat.** Memory tools default on, and setup
  rejects a row without tool support unless both memory flags are off
  (`app/chat/direct_turn/provider_state.py:136-144`).
- **Missing usage disables compaction.** Without streamed usage,
  `active_context_tokens` becomes 0 (`app/services/chat_manager.py:18-24,296`),
  so post-response compaction never triggers.
- **Chat restore is ambiguous.** The frontend restores a chat's model by
  `(model_client, slug, api_standard)`
  (`packages/product-ui/src/lib/chat/model-provider-compatibility.ts:17-33`);
  chats store only the slug (`chats.last_model_id`).

**Roles**

- **Preferences are an unvalidated whole object.** `PATCH /v1/users/me/settings`
  replaces `preferences` (`app/services/settings_service.py:75-77`); the typed
  shape exists only in `web/src/lib/settings/preferences.ts`.
  `memory.manager_model` stores a bare slug, not a row id.
- **Titles and compaction are env-only** (`server/config.py:146-171`), and
  `DirectModelPromptRunner` drops `request_options`, so the title
  `reasoning_effort` is never sent
  (`app/services/direct_model_prompt_runner.py:65-102`).
- **The memory manager is Responses-only.** It uses `OpenAIResponsesModel`,
  the hosted `ApplyPatchTool`, `previous_response_id` continuity and the global
  OpenAI key (`adapters/memory_manager/openai_agents_runtime.py:99-107,220-231,282-299`).
  In openai-agents 0.18.0 the hosted tool raises on Chat Completions and
  `previous_response_id` is ignored, while `FunctionTool(needs_approval=True)`
  is supported. Tracing is enabled and exports to OpenAI whenever a key exists.
- **Embeddings are an env singleton.** `Embedder` reads
  `ANIMAMA_EMBEDDING_MODEL`, calls `load_dotenv()` and builds an OpenAI client
  (`embeddings.py:7-37`). Vectors are untyped and record no model; mixed
  dimensions make pgvector raise, which hybrid search does not catch.
  Archive search is vector-only and returns 500 on embedding failure
  (`server/routers/archive.py:~290`); no product UI calls the archive API.
  `orm/archive_passage.py:21` types the archive vector by
  `ANIMAMA_EMBEDDING_DIM` although the baseline column is untyped.
- **Starter Animas ignore the default chat model preference.** Local bootstrap
  builds `AnimaCreationService` without the preference reader
  (`server/local_installation_bootstrap.py:130-141`), so starter Animas use
  `ANIMAMA_DEFAULT_MODEL_PROVIDER_ID`.

**Composition, desktop and self-host**

- **All `/v1` routes are mounted through one aggregate**
  (`server/routers/__init__.py:27-50`, `server/app.py:53`). The only
  composition-conditional precedent is the desktop control router
  (`app.py:54-81`). No hosted app factory exists in this repository.
- **Saving a desktop key restarts everything visible.** `changeCredentials`
  quiesces, destroys all product windows (including the caller), restarts
  FastAPI and recreates the window (`desktop/src/main-process/runtime/supervisor.ts:889-930`).
  Unsaved form state is lost; a key is visible to the backend only after the
  restart.
- **The vault rejects unknown provider names on load**
  (`vault.ts:115-117`), so removing `deepseek`, `huggingface` or `gemini` from
  the list would make existing vaults `vault_unreadable`. Older builds ignore
  unknown top-level fields and preserve them on save. The vault file is capped
  at 128 KiB and batches at five changes.
- **Compose lists backend env vars one by one** and has no `env_file`
  (`docker-compose.yml:54-99`); an operator-named variable never reaches the
  container without a Compose change.
- **Frontend runtime kind is available.** `GET /v1/runtime/capabilities`
  reports `runtime_kind` (`server/routers/runtime_capabilities.py:70-79`).
  Web tests render static markup only; nothing tests the settings modal or
  model selector rendering, so browser checks are required.
- **Error copy is OpenAI-only.** Codes are `openai_*`, metadata says
  `provider: "openai"` (`adapters/model_clients/openai_errors.py:221-255`), and
  `packages/product-ui/src/chat/chat-failure.ts` copy names OpenAI. There is no
  context-exceeded category.
- **Removing google-genai and litellm changes the desktop runtime closure.**
  The core license inventory (`src/frontend/desktop/runtime/release-policy.json`)
  is re-reviewed at the next desktop release stage; it is not a PR check.
  `litellm` data collection is in `src/backend/packaging/desktop/animama-runtime.spec:35`.
- **Tokenization is offline on desktop.** The document worker bundles a
  tiktoken cache (`src/backend/packaging/desktop/document_worker_resources.py`).
- **Docs drift.** `model-client-providers.md` says the Responses compaction
  threshold defaults to 200000; `config.py:143-145` uses 10000.
- **Local servers.** llama.cpp reports the served window at `GET /props`;
  Ollama reports a loaded model's `context_length` at `GET /api/ps`; LM
  Studio's documented `GET /api/v0/models` gives `max_context_length`, the
  model maximum rather than the loaded window. Ollama's OpenAI API cannot set
  the context size.

## Decision Log

- 2026-09-26 — Owner: spec decisions as recorded in the spec's
  [Open questions and decisions](configurable-models-spec.md#open-questions-and-decisions).
- 2026-09-26 — Owner: G1 acceptance models `qwen3.5:4b-mlx` or
  `gemma4:e4b-mlx`; all six phases authorized via `/implement`.
- 2026-09-26 — Agent (planning; implementation choices within the accepted
  scope, revisable during implementation without new product approval):
  - **Six phases on one branch and PR.** Credential isolation lands in Phase 1,
    before owner connections can run.
  - **Connections are a shared table; their management is local-only.**
    `model_connections` is a shared ORM table so the catalog and runtime can
    join it. The built-in `openai` connection is seeded. CRUD, discovery and
    probe routes are mounted only by `create_local_app`.
  - **Owner rows** use opaque ids with a reserved `owner:` prefix. Uniqueness
    moves to `(connection_id, provider_type, model)`. Re-adding a removed model
    reactivates its row. Removal is soft (`active=false`), because chat
    profiles hold foreign keys.
  - **Seed scope.** The seed updates only `source='builtin'` rows, never
    touches `hidden`, and retires built-ins missing from the catalog.
  - **Snapshots.** Drop the `chat_messages` composite foreign key; keep the
    provider/model snapshot columns. Add `chats.last_model_provider_id` for
    unambiguous restore.
  - **Credential references** are environment variable names. Owner names must
    match `^ANIMAMA_CONNECTION_[A-Z0-9_]{1,64}_API_KEY$` or be one of
    `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `HF_TOKEN`, so a reference cannot read
    internal secrets. Desktop uses a managed name derived from the connection id
    and stores the value in a new vault `connections` field. Compose gains an
    optional owner-only keys `env_file` selected by
    `ANIMAMA_CONNECTION_KEYS_FILE`.
  - **Compatibility options** replace provider inference: developer-role
    folding, OpenAI request extensions (`prompt_cache_key`,
    `parallel_tool_calls`), streamed usage, function `strict` stripping and a
    reasoning mode (`openai_effort`, `deepseek_thinking`, `omit`). Private
    reasoning extras (`reasoning`, `reasoning_content`, `token_id`) are handled
    for every connection.
  - **Roles live in preferences**, beside the existing chat default:
    `models.utility_model_provider_id`,
    `models.memory_manager_model_provider_id` (replacing
    `memory.manager_model`) and `models.embedding_model_provider_id`. A
    server-side resolver validates them at use and falls back to defaults.
    Removing a model clears role preferences that reference it.
  - **Operator role defaults** use row-id env vars
    (`ANIMAMA_DEFAULT_UTILITY_MODEL_PROVIDER_ID`,
    `ANIMAMA_DEFAULT_MEMORY_MANAGER_MODEL_PROVIDER_ID`,
    `ANIMAMA_DEFAULT_EMBEDDING_MODEL_PROVIDER_ID`). They replace the title,
    compaction, memory-manager and embedding model variables.
  - **Memory manager on Chat Completions** uses `OpenAIChatCompletionsModel`,
    a function-tool patch with approval reusing `adapters/memory_patch.py`, and
    persisted run history. Tracing is disabled unless the row is on the
    built-in OpenAI connection.
  - **Embeddings** store `embedding_model_id` per vector and compare only the
    current role's vectors. An in-process task re-embeds mismatched rows.
    Archive search gains a keyword fallback.
  - **Model kind.** `model_providers.model_kind` (`chat` or `embedding`) keeps
    embedding models out of chat selectors.
  - **Fail clearly.** `GET /v1/model-providers` returns 503 on a database
    failure instead of the static catalog.
  - **Settings UI.** A Models section holds connections, models, built-in
    visibility and the utility, memory manager and embeddings roles. The Memory
    Manager model control moves there; the default chat model stays in General.
  - **Presets** take their host from `ANIMAMA_LOCAL_MODEL_HOST`: `127.0.0.1`
    by default, and `host.docker.internal` in Compose with a `host-gateway`
    mapping.
- 2026-09-26 — Agent (Phase 1 implementation; within accepted scope):
  - **Uniqueness includes `source`**: `(connection_id, provider_type, model,
    source)`. `ON CONFLICT (id)` cannot absorb a second unique violation, so a
    three-column key would abort the seed when a release adds a model the owner
    already added on the OpenAI connection.
  - **`chats.last_model_provider_id` moves to Phase 3**, where it is written
    and read.
  - **The credential resolver lives in `app/model_clients/credentials.py`**
    (pure, with the environment injected by `server/model_clients.py`) rather
    than `server/model_credentials.py`, so adapters and the Phase 2 services
    share one name policy. The Responses adapter keeps the settings OpenAI key,
    which is the built-in connection's credential.
  - **Built-in rows no longer store a base URL**; the built-in connection uses
    `OPENAI_BASE_URL` or the OpenAI default.
  - **Deferred to later phases in this PR**: backend and frontend docs (Phase
    6); desktop vault and settings `gemini`, `deepseek` and `huggingface` key
    entries (Phase 5). The Phase 1 "no Gemini or LiteLLM references" condition
    therefore covers backend code, tests, dependencies and packaging.
  - **Release-scan allowlist** entries that mention litellm stay until the next
    desktop release scan, which is the only place they apply.

## Implementation orientation

Backend (paths under `src/backend/animama/` unless noted):

- Catalog: `app/model_catalog.py` (static built-ins and serializers),
  `domain/model_provider.py`, `orm/model_provider.py`,
  `adapters/mappers/model_provider_map.py`,
  `adapters/repositories/sqlalchemy/model_provider_repo.py`,
  `app/ports/model_provider_port.py`,
  `app/services/model_provider_catalog_service.py`,
  `server/routers/model_provider.py`, `server/schemas/model_provider.py`.
- Seed: `alembic/seeds/01-seed-model-providers.sql`, rendered by
  `_render_seed_sql` in `tests/test_model_provider_catalog.py`; applied by
  `server/db_bootstrap.py` from `reset.sh` and the desktop CLI.
- Model clients: `server/model_clients.py` (registry),
  `app/model_clients/types.py`,
  `adapters/model_clients/openai_chat_completions/`,
  `adapters/model_clients/openai_responses/`,
  `adapters/model_clients/openai_errors.py`.
- Direct chat: `app/chat/direct_executor.py`, `app/chat/direct_turn/`
  (`provider_state.py`, `model_stream.py`, `message_builders.py`,
  `response_format.py`, `constants.py`), `app/chat/api_standard.py`,
  `server/routers/chat/{chat_sse,turn_setup,title,compaction}.py`.
- Roles and consumers: `app/services/direct_model_prompt_runner.py`,
  `chat_title_generation_service.py`, `chat_compaction_service.py`,
  `memory_manager_service.py`, `server/routers/memory_manager.py`,
  `adapters/memory_manager/openai_agents_runtime.py`, `embeddings.py`,
  `server/deps.py`, `app/services/user_file_processing_service.py`,
  `server/routers/archive.py`.
- Composition: `server/app.py` (`create_local_app`),
  `server/routers/__init__.py`, `server/routers/runtime_capabilities.py`,
  `server/config.py`.

Frontend (paths under `src/frontend/`):

- Desktop keys: `shared/desktop-runtime.ts`,
  `desktop/src/main-process/runtime/{vault,supervisor,ipc,runtime-preload}.ts`,
  `desktop/src/preload.cts`, `desktop/tests/runtime-{state,ipc,supervisor}.test.ts`.
- Settings: `web/src/ui/sidebar/ApplicationSettingsModal.tsx`,
  `web/src/ui/settings/*`, `web/src/lib/settings/preferences.ts`,
  `web/src/ui/settings/SettingsProvider.tsx`.
- Selector and chat: `web/src/ui/components/chat-input.tsx`
  (`ChatInputModelSelector`), `web/src/ui/components/model-selector.tsx`,
  `packages/product-ui/src/lib/chat/model-provider-compatibility.ts`,
  `packages/product-ui/src/chat/chat-failure.ts`.

## Setup and execution rules

When implementation is authorized:

1. Use `workspace-setup` to publish the spec as the parent issue and create one
   issue per authorized phase. Read them back and record the URLs here and in
   the spec. Rebase or merge `origin/main` first. If
   `feat/model-asset-downloader` has merged, regenerate the SDK rather than
   hand-resolving generated conflicts.
2. Use a named task stack, for example
   `ANIMAMA_LLM_SKIP=1 ./reset.sh --name cfgmodels --base-port 8780`, then
   `source .animama-stack.env`. Schema phases need a reset of this task stack
   only. Use a non-skip stack only for live-provider or local-server checks.
3. Work test-first on observable behavior. Tests use fake OpenAI-compatible
   servers or stubbed clients, never real keys.
4. Before each phase commit run the affected read-only checks and an
   independent `sdlc-reviewer` review: one full initial review and at most two
   repair rounds. Commit as `<type>(models)[p#]: <summary>`.
5. Stop and report if blockers remain after the repair budget.
6. A later phase starts once the previous phase's completion conditions pass.

## Phased implementation

### Phase 1 — Connection-aware catalog and credential isolation

Requirements: R1 (data model, credentials), R2 (row ownership), R9. No
dependency beyond authorization. Outcome: every model row belongs to a
connection. A connection's requests go only to its base URL, with only its own
credential. Gemini, LiteLLM, DeepSeek and Hugging Face built-ins are gone.
Existing OpenAI chat behavior is unchanged.

1. **Schema.** In the baseline SQL, ORM, domain and mappers:
   - Add a `model_connections` table:
     - `id` text primary key;
     - `source` (`builtin`/`owner`), `name`, `preset`;
     - `base_url`, nullable; the built-in uses the runtime OpenAI base URL;
     - `credential_env`, nullable;
     - `compatibility` JSONB;
     - `timeout_seconds`, nullable;
     - `active` and timestamps.
   - On `model_providers`:
     - add `connection_id` (NOT NULL foreign key), `source`, `model_kind`,
       `hidden`, `allow_memory_writes` and `probe_result` (JSONB, nullable);
     - replace the `(provider_type, model)` unique constraint with
       `(connection_id, provider_type, model)`.
   - Drop the `chat_messages` composite foreign key and keep the snapshot
     columns.
   - Add `chats.last_model_provider_id` (text, no foreign key).
   - Update `BASELINE_SHA256` and the `CREATE TABLE` count.
2. **Built-ins and presets.**
   - Remove the Gemini, LiteLLM, DeepSeek and Hugging Face entries and their
     family/logo inference helpers from `MODEL_CATALOG`.
   - Add a presets module (`app/model_connection_presets.py`) covering Ollama,
     LM Studio, llama.cpp, vLLM, DeepSeek, Hugging Face router and Custom.
     Each preset defines:
     - default base URL, with the host taken from a composition-supplied
       local-model host;
     - label and logo;
     - whether a key is expected;
     - compatibility defaults (non-OpenAI presets fold developer messages and
       omit OpenAI extensions; DeepSeek uses `deepseek_thinking`; Hugging Face
       strips function `strict` and omits streamed usage);
     - timeout defaults: 60 s for cloud, 300 s for local servers.
   - Add `ModelConnectionCompatibility` as a domain value.
3. **Seed.**
   - Extend `_render_seed_sql` to upsert the built-in `openai` connection, then
     built-in rows. `ON CONFLICT (id) DO UPDATE` excludes `hidden`, `source` and
     `connection_id`, and applies only `WHERE model_providers.source = 'builtin'`.
   - Retire built-ins absent from the catalog with
     `UPDATE … SET active=false, deprecated_at=… WHERE source='builtin' AND id NOT IN (…)`.
   - Scope `soft_retire_missing` to built-ins.
   - Regenerate `alembic/seeds/01-seed-model-providers.sql`. The packaging test
     still pins two seed files.
4. **Credential resolution.**
   - Add a `ModelCredentialResolver` port (`app/model_clients/`) that returns a
     key or a state (`configured`, `missing`, `not_required`).
   - Implement it in `server/model_credentials.py`:
     - the built-in connection uses `settings.openai_api_key`;
     - owner connections read the validated `credential_env`;
     - a connection with no reference needs no key.
   - Mark the settings credential fields `repr=False`.
5. **Chat Completions adapter.**
   - Cache SDK clients by connection id, base URL and timeout.
   - Take the key only from the resolver; never fall back to the OpenAI key.
   - Keyless connections send no `Authorization` header (use a placeholder key
     that the SDK requires and strip the header).
   - Replace `_endpoint_family_for_provider` inference with the connection's
     compatibility options.
   - Treat the private reasoning extras as known, private and never text.
   - Derive the effective `supports_developer_role` from the compatibility
     options so the prompt assembler and the adapter agree.
6. **Responses adapter** is valid only on the built-in OpenAI connection.
   Direct-chat validation rejects a Responses row elsewhere, and the key comes
   from the resolver.
7. **Registry and removals.**
   - Drop Gemini and LiteLLM registration; mock mode covers the remaining
     types.
   - Remove the adapters, the `utils` aliases and the Gemini usage conversion.
   - Remove `gemini_api_key`, the `GEMINI_*` Compose variables, and the
     `google-genai` and `litellm` dependencies (`uv lock`).
   - Remove the `litellm` data collection in the desktop runtime spec, the
     `licenses/source-review.json` entries (regenerated with their tool if it
     is generated) and the gitleaks references.
   - Drop LiteLLM from `DIRECT_MEMORY_TOOL_SUPPORT_BY_PROVIDER`.
   - Replace Gemini fixtures used as "unsupported" rows with a fake provider
     type.
   - Remove the unused `default_model` and `slow_model` settings.

Tests:

- Catalog serialization and seed parity.
- A DB test that reruns the seed and shows:
  - owner rows untouched;
  - `hidden` preserved;
  - removed built-ins retired;
  - no uniqueness conflict for the same slug on two connections.
- Credential isolation against a fake server that records headers:
  - the OpenAI key is never sent to an owner connection;
  - a keyless connection sends no header;
  - a missing referenced variable gives a clear missing-credential error.
- Request-shape tests for the DeepSeek and Hugging Face compatibility defaults.
- Startup with no `OPENAI_API_KEY` succeeds.
- Existing executor and route tests pass.

Checks:

- focused `uv run pytest -q tests/test_model_provider_catalog.py tests/test_model_client_registry.py tests/test_direct_chat_turn_executor.py tests/test_alembic_fresh_install.py`
- `make check-test`
- `uv lock --check`
- `bash -n reset.sh`
- both `docker compose … config --quiet` commands

Completion: the tests above pass; no remaining reference to Gemini or LiteLLM
outside history; review leaves no blocker.

Phase record: issue #171; starting source `25abbfb`; commit `6b79505`.

Evidence (pre-review, working tree on `25abbfb`):

- `make check-test`: audit, format, lint, mypy (543 files) and pytest 1914
  passed, 7 skipped. Baseline `main` was 1921 passed; the difference is the
  removed Gemini, LiteLLM, DeepSeek and Hugging Face built-in tests offset by
  the new connection tests.
- `uv lock --check`, `bash -n reset.sh`, both `docker compose … config --quiet`
  and the fresh-install and bootstrap tests (baseline plus seed, twice) pass.

#### Code Review #1 Findings

Reviewer: independent `sdlc-reviewer`, full initial review of the working tree
on `25abbfb`. Checks rerun by the reviewer: ruff, format check, boundary
import check, `uv lock --check`, mypy and 293 focused tests; all pass. An
in-memory SDK probe reproduced F1.

- **P1-R1-F1 (blocking)** — `openai_chat_completions/client.py`: the SDK merges
  `OPENAI_CUSTOM_HEADERS` into every client, so an owner connection could
  receive process headers, and a keyed one a process `Authorization`.
- **P1-R1-F2 (blocking)** — no setup-time rejection of a Responses row on an
  owner connection, and no test of the adapter guard.
- **P1-R1-F3** — a row without its loaded connection fell back to the built-in
  OpenAI connection even when `connection_id` named another.
- **P1-R1-F4** — an injected test `client` bypasses the resolver.
- **P1-R1-F5** — ORM and domain defaults `connection_id='openai'`,
  `source='builtin'` could hide an omission by a future owner-row writer.
- **P1-R1-F6** — `sync_from_registry` would reset an owner-hidden built-in.
- **P1-R1-F7** — forward-looking code without a Phase 1 caller;
  `managed_credential_env` could map two ids to one name or produce an invalid
  name.
- **P1-R1-F8** — duplicated built-in connection and handled-extras definitions.
- **P1-R1-F9** — seed updated `connection_id` and `source`; unique constraint
  name.
- **P1-R1-F10** — deviations not recorded in the plan.
- **P1-R1-F11** — docs mislead until Phase 6.

#### Code Review #1 Revisions

- **F1 accepted.** Owner-connection clients omit every header named in
  `OPENAI_CUSTOM_HEADERS` plus the OpenAI organization and project headers, and
  keyed connections set `Authorization` explicitly from their own key. Tests
  send real SDK requests through an in-memory transport with hostile
  `OPENAI_API_KEY`, `OPENAI_ORG_ID`, `OPENAI_PROJECT_ID` and
  `OPENAI_CUSTOM_HEADERS`: a keyless connection sends none of them, and a keyed
  one sends exactly its own bearer key.
- **F2 accepted.** `validate_model_provider_for_direct_turn` rejects a
  Responses row off the built-in connection (and an inactive connection) before
  the stream opens; the adapter guard now keys on `connection_id`. Tests cover
  both.
- **F3 accepted.** `connection_for_model_provider` falls back only for the
  built-in id; otherwise the adapter raises `connection_unavailable`. Tested.
- **F4 rejected.** The injected client is a test hook that production never
  passes (documented on the constructor); restricting it would only complicate
  request-shape tests.
- **F5 deferred to Phase 2.** The defaults keep built-in and fixture rows
  simple; the Phase 2 owner services set both fields explicitly and their tests
  assert them.
- **F6 accepted.** Catalog upserts preserve `hidden` on built-in rows. Tested.
- **F7 partly accepted.** `managed_credential_env` accepts only generated ids
  (`[a-z0-9_]{1,48}`) and so maps one-to-one onto valid names. The connection
  repository, presets and constants remain for Phase 2, which uses them
  immediately.
- **F8 accepted.** The seed serializer derives from `builtin_openai_connection()`
  (using `PRESET_OPENAI`); the handled extras live once in `events.py`.
- **F9 accepted.** The seed never updates `connection_id` or `source`; the
  constraint is `uq_model_providers_connection_model`.
- **F10 accepted.** Recorded in the Decision Log above.
- **F11 deferred to Phase 6** as planned, within the same PR.
- A boundary test that forbids `Authorization`/`Bearer` literals in route tests
  now also exempts `test_model_client_registry.py`, whose assertions concern
  synthetic upstream model keys, like the existing `test_model_store.py`
  exemption.

After repairs: `make check-test` passes (1919 passed, 7 skipped).

#### Code Review #2 Findings

Reviewer: the same independent reviewer, targeted recheck of the accepted
findings and regressions. Result: **pass**. F1, F2, F3, F6, F7 (managed names),
F8, F9 and F10 are resolved; a real-SDK probe with hostile process headers
(including lowercase variants) confirmed that a keyless connection sends none
and a keyed one sends only its own bearer key. Checks: ruff, format check,
boundary import check, `uv lock --check`, mypy and 261 focused tests pass.

- **P1-R2-F1** (non-blocking) — the new inactive-connection setup rejection had
  no test.
- **P1-R2-F2** (optional) — the boundary exemption covered the whole adapter
  test file.

#### Code Review #2 Revisions

- **P1-R2-F1 accepted.** Added
  `test_direct_turn_rejects_rows_on_an_inactive_connection_before_chat_or_model`.
- **P1-R2-F2 accepted.** The credential header tests moved to
  `tests/test_model_connection_credentials.py`, which is now the exempt file;
  `test_model_client_registry.py` is checked again.
- `make check-test`: 1920 passed, 7 skipped. One repair round used; one remains.

### Phase 2 — Owner management API, probe and composition boundary

Requirements: R1 (management), R2, R3, R8. Depends on Phase 1. Outcome: through
the API, the owner can create connections, list their served models, probe
and add models (including from a built-in template), hide built-ins and
remove models or connections with a usage report. The hosted composition
cannot reach any of it.

1. **Services** (`app/services/`):
   - `ModelConnectionService`:
     - Presets fill defaults.
     - Base URLs must be `http`/`https`, without userinfo, query or fragment,
       and are normalized.
     - Credential modes:
       - `none`;
       - `env` (validated name);
       - `managed` (name derived from the id as
         `ANIMAMA_CONNECTION_<ID>_API_KEY`).
     - Update and soft removal (connection and its models inactive).
   - `OwnerModelService`:
     - Add a model with a label, kind and capabilities. Capabilities come from
       a built-in template, a probe result or manual values; the provider type
       is chosen only on the built-in OpenAI connection.
     - Re-adding a removed model reactivates its row.
     - Update owner rows; set `hidden` on built-ins.
     - Removal reports usage (Animas by chat profile, the default chat model
       preference and, from Phase 4, roles). It requires `confirm=true` when in
       use, otherwise returning 409 with the usage list.
2. **Local-only router** `server/routers/model_connections.py`, included by
   `create_local_app` outside the shared aggregate:
   - list, create, update and remove connections, with each connection's
     `credential_configured` state (never a value);
   - `GET …/available-models`: a bounded proxy of `/v1/models`;
   - add, update and remove models, and `POST …/probe`.
3. **Probe** (`app/services/model_probe_service.py` with an adapter helper).
   Each step is bounded and reported separately:
   - reachable and authorized;
   - streams text;
   - strict `json_schema` reply;
   - function tool call;
   - tools and schema in the same request, recorded as
     `tools_with_structured_output`;
   - for the embedding kind, one `/v1/embeddings` call recording dimensions.

   After the model loads, detect the context window best-effort:
   - llama.cpp `GET {root}/props` `n_ctx`;
   - Ollama `GET {root}/api/ps` `context_length`;
   - LM Studio only when a loaded window is reported.

   Results are returned for the owner to apply; saving stores a summary in
   `probe_result`. Put the error-category classifier in shared code here; Phase
   3 reuses it for chat.
4. **Catalog policy.**
   - `ModelProviderCatalogService.list_public_catalog` takes a
     `ModelCatalogPolicy` (`owner_models_enabled`, optional built-in
     allowlist). The local composition enables owner models.
   - The public item gains `source`, `connection_id`, `connection_name`,
     `model_kind`, `hidden` and `context_window_tokens`. `model_label` is
     never empty (it falls back to the model id).
   - A database failure returns 503 `model_catalog_unavailable`.
5. **Runtime capabilities** gain `model_configuration: true` in the local
   composition.
6. **Direct-chat validation** for owner rows requires:
   - an active connection;
   - `model_kind == "chat"`;
   - a context window;
   - Responses only on the built-in connection.
7. Regenerate the SDK and keep the frontend compiling.

Tests:

- **Route tests:**
  - CRUD, validation errors and the three credential modes;
  - managed name derivation;
  - usage and confirm on removal;
  - reactivation;
  - hidden persisting across a seed rerun.
- **Composition test:** the shared aggregate has no model-connection routes,
  `create_local_app` mounts them, and a disabled policy hides owner rows.
- **Probe tests** with a fake server:
  - success;
  - schema unsupported;
  - tools unsupported;
  - combination rejected;
  - bad key, unreachable and timeout;
  - embedding dimensions;
  - the three context-detection response shapes.
- **The "new OpenAI model" scenario:** copy a template to a new id under the
  built-in connection, select it for an Anima, and complete a turn with the
  mock client.

Checks: focused pytest, `make check-test`, `pnpm openapi-ts:check`,
`pnpm check`.

Completion: tests pass; the SDK is regenerated; review has no blocker.

Phase record: issue #166; starting source `f6f68c5`; commit `42cb40f`.

Implementation notes (agent, within scope):

- One `ModelConfigurationService` covers connections, owner models, hiding and
  removal, because removal spans all three.
- A `tools_with_structured_output` capability column records the probe's
  combination result for Phase 3.
- A Responses probe (built-in connection only) checks that the model exists;
  its capabilities come from the chosen built-in template.
- Hiding a built-in uses a dedicated `set_hidden` repository write, since
  catalog upserts deliberately preserve the flag.
- The Compose `host-gateway` mapping and `ANIMAMA_LOCAL_MODEL_HOST` default
  moved here from Phase 6 because the presets use them now.
- The SDK is regenerated from a Python 3.12.13 environment, matching CI.
- Files: routes are in `server/routers/model_configuration.py`; the probe is an
  app port (`app/model_clients/probe.py`) with an OpenAI-compatible adapter
  (`adapters/model_clients/openai_chat_completions/probe.py`).
- `ModelCatalogPolicy` filters the public listing. Enforcing a hosted
  built-in allowlist in turn setup and chat profiles is left to the hosted
  composition (and the Phase 4 role resolver for roles).

Evidence (pre-review, working tree on `f6f68c5`):

- `make check-test`: 1950 passed, 7 skipped; format, lint, mypy and audit pass.
- `pnpm openapi-ts:check`: generated SDK current (17 files); `pnpm check` passes.
- Both `docker compose … config --quiet` commands and
  `tests/test_compose_network_boundaries.py` (122) pass.

#### Code Review #1 Findings

Reviewer: independent `sdlc-reviewer`, full initial review of the working tree
on `f6f68c5`. Its checks (ruff, format check, boundary imports, mypy, 216
focused tests, `pnpm openapi-ts:check`) pass. Credential isolation on every
probe path was confirmed with hostile process OpenAI settings.

- **P2-R1-F1 (blocking)** — probe steps and model listing caught only SDK
  errors; HTML replies, error bodies, missing fields and mid-stream
  `httpx.ReadTimeout` escaped as HTTP 500 without a category.
- **P2-R1-F2 (blocking)** — `normalize_base_url` let `urlsplit` raise and did
  not validate the port (`http://[::1:…`, `:abc`, `:99999`).
- **P2-R1-F3 (blocking)** — no tests for either PATCH route, the 503 catalog
  path or the runtime capability flag.
- **P2-R1-F4** — PATCH of a connection acted as a full replace (dropping the
  credential reference and custom options).
- **P2-R1-F5** — owner rows kept the connection name from creation, so a
  renamed connection's models stayed under the old selector group.
- **P2-R1-F6** — a capability edit reset a Responses row's hosted tools;
  `_owner_capabilities` had an unused parameter; templates were accepted for
  embedding models.
- **P2-R1-F7** — a template copied OpenAI's context window onto a model on
  another server.
- **P2-R1-F8** (optional) — no short connect timeout for the probe.
- **P2-R1-F9** (optional) — `supports_streaming=False` after connectivity
  failures; a 404 on `/models` reported as `model_not_found`; a missing key
  returned 502.
- **P2-R1-F10** (optional) — plan record drift (router/probe file names,
  reactivation wording for connections, allowlist enforcement scope).
- **P2-R1-F11** (optional) — small cleanups (duplicate policy lookup and
  provider-type constants, hardcoded Responses type, and others).
- Compose comment overstated Linux reachability; docs deferred to Phase 6.

#### Code Review #1 Revisions

- **F1 accepted.** Each step and model listing reports SDK errors,
  `httpx` timeouts (`timeout`), other transport failures (`unreachable`) and
  non-OpenAI replies (`unexpected_response`) as categorized steps or probe
  errors; SDK client construction is guarded. Tests cover a stalled stream, an
  HTML reply and a wrong base path.
- **F2 accepted.** Base URLs failing `urlsplit` or port validation are
  rejected with `invalid_base_url`; the three reviewer cases are tested.
- **F3 accepted.** Tests cover partial connection updates (including the
  built-in rejection), owner model updates, the 503 catalog response and the
  capability flag in local and non-local compositions.
- **F4 accepted.** `PATCH /v1/model-connections/{id}` takes
  `PyModelConnectionUpdate`; omitted fields, including the credential
  reference, keep their values.
- **F5 accepted.** The public catalog labels owner rows with their
  connection's current name and preset logo.
- **F6 accepted.** Capability edits keep native tools from a Responses
  template; the unused parameter is gone; templates are rejected for embedding
  models.
- **F7 accepted.** Template context windows (and output limits) apply only on
  the built-in OpenAI connection.
- **F8 accepted.** Probe clients use a 10 s connect timeout within the
  connection timeout.
- **F9 accepted.** Connectivity, credential and model-not-found failures leave
  `supports_streaming` undetermined; a 404 while listing models reports
  `unreachable` with a wrong-path hint; a missing key returns 400.
- **F10 accepted.** Recorded below and in Idempotence and recovery.
- **F11 partly accepted.** Runtime capabilities reuse
  `get_model_catalog_policy`; the service and probe route use the provider-type
  constants from `app/chat/api_standard.py`. The remaining items are left: the
  app error carries a status like other app services, per-connection model
  queries are bounded by the owner's few connections, and stricter literal
  types in the public catalog schema would churn the generated client for no
  behavioral gain.
- The Compose comment now says Linux host servers must listen beyond
  `127.0.0.1`; the Phase 6 guide will repeat it.

After repairs: `make check-test` 1963 passed, 7 skipped; SDK regenerated and
current; `pnpm check` passes.

#### Code Review #2 Findings

Reviewer: the same independent reviewer, targeted recheck. Result: **pass**.
F1–F3 and the accepted optional findings are resolved with no blocking
regression; the reviewer's failure scripts now produce categorized results and
credential isolation still holds on every probe path. Checks: ruff, format
check, boundary imports, mypy, 283 focused tests and `pnpm openapi-ts:check`.

- **P2-R2-F1** (optional) — an invalid stored base URL at probe time returned
  502 instead of 400.
- **P2-R2-F2** (optional) — a streaming step with no text had no category; a
  literal category string duplicated a constant.
- **P2-R2-F3** (optional) — the catalog sorted groups by the stored label, not
  the displayed connection name.

#### Code Review #2 Revisions

- **P2-R2-F1 accepted.** A new `invalid_base_url` category maps to 400.
- **P2-R2-F2 accepted.** An empty stream reports `unexpected_response`; the
  constant is used.
- **P2-R2-F3 accepted.** The public catalog sorts by the displayed labels.
- `make check-test`: 1963 passed, 7 skipped; SDK current. One repair round
  used; one remains.

### Phase 3 — Chat Completions turn parity and errors

Requirements: R5, R7. Depends on Phase 2. Outcome: a Chat Completions model on
any connection gives a complete companion turn within its capabilities and
fails with a named, categorized error.

1. **Errors.**
   - Classify provider failures into `unreachable`, `credential_missing`,
     `credential_rejected`, `model_not_found`, `timeout`, `context_exceeded`,
     `rate_limited`, `quota_exceeded`, `server_error` and `bad_request`.
   - `context_exceeded` covers the OpenAI `context_length_exceeded` code and
     the known llama.cpp, vLLM and LM Studio messages.
   - Error details carry `category`, `connection_id`, `connection_name` and
     `connection_preset`.
   - Existing `openai_*` codes stay for built-in OpenAI rows; metadata stops
     claiming `provider: "openai"` for other connections. Sanitization is
     unchanged; no key or raw body is logged.
2. **Failure semantics.** Each category ends the turn with one error event and
   one `run.completed`, persists no assistant message and leaves chat state
   (cursor, usage, turn counters) unchanged.
3. **Tool gating.**
   - A row without tool support runs without memory tools instead of failing
     setup.
   - `allow_memory_writes=false` exposes read tools only.
4. **Split turn** when `tools_with_structured_output` is false: tool rounds
   send tools without `response_format`, then a final round sends
   `response_format` with no tools, reusing the forced-final path in
   `model_stream.py`.
5. **Usage estimate** when a stream reports none. Use a character-based
   estimate, recorded as `usage_estimated` in message metadata, so
   `active_context_tokens` advances and post-response compaction triggers.
6. **Timeouts.** The per-connection timeout applies to both the client and the
   request.
7. **Chat restore.** Persist `chats.last_model_provider_id` with the existing
   last-model fields and expose it in the chat payload.

Tests:

- **Route tests:** each category gives an error event, then `run.completed`,
  with no assistant row and unchanged chat state.
- **Executor tests:**
  - a tool-less model completes a turn;
  - writes-disabled exposes read tools only;
  - the split turn completes;
  - private reasoning is never persisted or spoken;
  - the guardrail stays last with developer folding;
  - an estimated usage triggers compaction.

Checks: focused pytest, `make check-test`, `pnpm openapi-ts:check` if schemas
changed.

Completion: tests pass; review has no blocker.

Phase record: issue #167; starting source `d9b3b43`; commit PHASE3SHA.

Implementation notes (agent, within scope):

- Error details come from one helper (`model_error_details`) at the point the
  executor emits the error event; `provider` becomes the connection preset.
- The split turn discards the unconstrained answer of the last tool round and
  asks again under the response format without tools; only that round
  streams public text.
- Per-connection timeouts were already applied in Phase 1 (client and
  request); no further change.
- Usage estimates use about four characters per token over the serialized
  messages and tools and are marked `usage_estimated` in the message's
  provider metadata; `active_context_tokens` then advances, so post-response
  compaction can trigger.

Evidence (pre-review, working tree on `d9b3b43`):

- `make check-test`: 1990 passed, 7 skipped.
- SDK regenerated and current; `pnpm check` passes.

#### Code Review #1 Findings

Reviewer: independent `sdlc-reviewer`, full initial review of the working tree
on `d9b3b43`. Its checks (ruff, format check, boundary imports, mypy, 263
focused tests, SDK currency) pass; a scratch probe exercised the split turn.

- **P3-R1-F1 (blocking)** — the split turn stored usage summed over every
  request on the final message, and `active_context_tokens` used it, so the
  prompt counted at least twice and compaction ran far too early.
- **P3-R1-F2 (blocking)** — no test showed an estimated usage reaching
  `active_context_tokens` and triggering compaction.
- **P3-R1-F3** — the split test's plain-text draft would never stream anyway.
- **P3-R1-F4** — the split could apply to Responses rows, where moderation,
  stale-cursor retries and continuation assume one request shape.
- **P3-R1-F5** — the structured-round request duplicated the forced-final
  builder; error details guessed "OpenAI" when a connection was not loaded.
- **P3-R1-F6** — an unreachable validation branch and a stale comment.
- **P3-R1-F7** — five categories untested at route level; usage/cursor and the
  chat payload field not asserted.
- **P3-R1-F8** — `string_above_max_length` and server errors could be read as
  context exceeded.
- **P3-R1-F9** (observation) — attachments are silently dropped on tool-less
  models (they cannot call the file tool).
- **P3-R1-F10** (minor) — estimate ignores tool-call arguments and the schema.

#### Code Review #1 Revisions

- **F1 accepted.** The final result records `context_tokens` (the last
  request's prompt and reply) in provider metadata; `ChatManager` uses it for
  `active_context_tokens` and keeps summed usage for cumulative counters. This
  also corrects the existing tool-round case. The split test asserts 41 billed
  and 16 in context.
- **F2 accepted.** A route test sends a real Chat Completions adapter a stream
  without usage and shows the estimate persisted as `usage_estimated`,
  `active_context_tokens` above zero and compaction triggered at that value.
  The plan's reasoning-privacy and guardrail-with-folding tests map to
  existing coverage (`test_openai_chat_completions_client_keeps_reasoning_content_private`,
  `tests/test_companion_guardrail.py`, and the executor folding tests).
- **F3 accepted.** The discarded draft is a well-formed structured reply with
  distinct speech.
- **F4 accepted.** Only Chat Completions rows split; the no-tools request never
  repeats moderation. A test shows a Responses row is not split.
- **F5 accepted.** One `_model_request_without_tools` builder serves the
  structured round and the forced final (which adds the limit instruction and
  guardrail). Error details name a connection only when it is loaded.
- **F6 accepted.** Removed the unreachable branch; the comment describes
  narrowing.
- **F7 accepted.** The route test covers all ten categories and asserts
  cumulative usage and the cursor stay unchanged; chat API tests assert the new
  field.
- **F8 accepted.** Only OpenAI's `context_length_exceeded` code counts, and the
  message heuristic applies to rejected requests only.
- **F9 deferred to Phase 5.** The composer will say attachments need a model
  with tool calling.
- **F10 rejected.** A rough estimate is the stated intent; the omissions are
  small beside the prompt.

After repairs: `make check-test` 1997 passed, 7 skipped.

#### Code Review #2 Findings

Reviewer: the same independent reviewer, targeted recheck. Result: **pass**.
F1–F8 are resolved (a probe through the real `ChatManager` confirmed 41 billed
and 16 in context), F9's deferral and F10's rejection are accepted, and no
regression was found. Checks: ruff, format check, boundary imports, mypy, 287
focused tests and SDK currency.

- **P3-R2-F1** (optional) — no direct `ChatManager` test for recorded context
  tokens.
- **P3-R2-F2** (optional) — an unused `previous_final` parameter.
- **P3-R2-F3** (naming nit) — context-token helpers live in the estimate module.

#### Code Review #2 Revisions

- **P3-R2-F1 accepted.** Added
  `test_chat_manager_active_context_uses_the_last_request_footprint`.
- **P3-R2-F2 accepted.** Removed the parameter.
- **P3-R2-F3 rejected.** Both helpers describe request token accounting and sit
  beside the estimate that feeds them; moving them adds churn only.
- `make check-test`: 1998 passed, 7 skipped. One repair round used; one remains.

### Phase 4 — Model roles and fully local operation

Requirements: R4, R6, R2 (role fallback). Depends on Phase 3. Outcome: titles,
compaction, the memory manager and embeddings use owner-assigned rows, and a
configuration with only local rows makes no OpenAI request.

1. **Role resolution.**
   - `ModelRoleResolver` (app layer) reads:
     - `chat.default_model_provider_id`;
     - `models.utility_model_provider_id`;
     - `models.memory_manager_model_provider_id`;
     - `models.embedding_model_provider_id`.
   - It applies the composition policy (hosted: operator defaults only) and the
     new row-id env defaults.
   - Defaults: utility and memory manager inherit the chat default; embeddings
     are off when unset.
   - An inactive, wrong-kind or incapable assignment falls back to the default
     and logs a warning:
     - utility needs streaming chat;
     - memory manager needs tools;
     - embeddings needs the embedding kind.
   - A local-only `GET /v1/model-roles` reports the effective row, its source
     (owner or default), availability and re-embedding status.
   - Removal in `OwnerModelService` clears role preferences that reference the
     removed row and includes them in usage.
   - Remove the replaced env variables and `ANIMAMA_EMBEDDING_DIM`.
2. **Utility.**
   - `DirectModelPromptRunner` resolves by row id and honors `request_options`,
     sending reasoning effort only when the row supports it.
   - Titles and compaction record the resolved row.
3. **Memory manager.**
   - Build the Agents SDK model from the role row:
     - Responses rows keep `OpenAIResponsesModel` with the hosted patch tool
       and cursor continuity;
     - Chat Completions rows use `OpenAIChatCompletionsModel` with the
       connection's client, a `memory_apply_patch` function tool with
       `needs_approval=True` (reusing `adapters/memory_patch.py`), and run
       history persisted with the run in place of `previous_response_id`.
   - `store` and `prompt_cache_key` are sent only to OpenAI.
   - Tracing is disabled unless the row is on the built-in OpenAI connection.
   - Runs record the row's provider and model.
   - Waiting-approval, decide and resume work on both paths.
4. **Embeddings.**
   - Replace the env singleton with a role-bound embedder (connection URL,
     resolved key, model, timeout). Add built-in OpenAI embedding rows (for
     example `text-embedding-3-small`, kind `embedding`).
   - Add `embedding_model_id` to `user_file_chunk` and `archive_passages`, and
     make ORM vectors dimensionless.
   - Writes record the model id. Search compares only vectors of the current
     role, and uses keyword retrieval while the role is off or re-embedding is
     pending. Archive search gains a full-text fallback instead of returning
     500.
   - An in-process task started by the application lifespan re-embeds
     mismatched chunks and passages in batches, with backoff. Same-file reuse
     copies only vectors from the current model.
   - Remove `load_dotenv()` from the embedder.
5. **Fully local.** With no `OPENAI_API_KEY`, `OPENAI_BASE_URL` pointed at an
   unused loopback port and every role on a fake local connection, the
   following all succeed while the OpenAI connection is never constructed or
   called:
   - a chat turn, title generation and compaction;
   - a memory-manager run with an approval;
   - an embedding write and search.

   Assert this with a registry spy and resolver.

Tests:

- **Resolver:** defaults, fallbacks, policy-disabled mode and removal clearing
  roles.
- **Utility:** reasoning is honored only when supported.
- **Memory manager:** both paths (a stubbed Chat Completions model, approval
  resume, history continuity).
- **Embeddings:**
  - no mixed-space comparison;
  - keyword retrieval while pending;
  - re-embedding progress and completion;
  - archive fallback.
- The fully local test from step 5.
- Update the baseline SHA for the schema change.

Checks: focused pytest, `make check-test`, `pnpm openapi-ts:check`.

Completion: tests pass; review has no blocker.

Phase record: issue #168; starting source —; commits —.

#### Code Review #1 Findings

Not yet run.

#### Code Review #1 Revisions

Not yet run.

### Phase 5 — App Settings, model selector and desktop keys

Requirements: R1–R4 and R7 user-facing behavior. Depends on Phase 4. Outcome:
the owner manages connections, models and roles in App Settings on desktop and
self-hosted web, and the selector and chat errors reflect them.

1. **Desktop vault and bridge.**
   - Add a connection-key credential type restricted to the managed name
     pattern. Store keys in a new top-level `connections` map; the vault
     version stays 1.
   - Set explicit bounds: at most 32 connection keys, an explicit batch
     maximum, and a larger file cap.
   - Drop legacy `deepseek`, `huggingface` and `gemini` entries on load instead
     of failing.
   - The supervisor adds connection keys to the backend environment. They are
     redacted and removed from the cleanup worker's environment.
   - `list()` returns connection statuses.
   - Update the vault, IPC and supervisor tests.
2. **API Keys** lists OpenAI and ElevenLabs only.
3. **Models section** (new panels in `web/src/ui/settings/`), shown when
   runtime capabilities report `model_configuration`:
   - **Connections:**
     - presets, base URL, timeout, and compatibility options under Advanced;
     - key entry:
       - desktop: a managed write-only key;
       - self-hosted web: an env name with configured status;
     - a warning when a key would go to a non-loopback `http` URL.
   - **Models** under each connection:
     - choose from the discovered list or type an ID;
     - copy a template, or Test to prefill capabilities;
     - the context window is required, with guidance;
     - a memory-writes toggle and the model kind.
   - **Built-ins:** a list with a hide toggle.
   - **Removal:** confirmation naming the Animas and roles that use it.
   - **Desktop save order:** save the connection, apply its key (the window
     reloads), then probe. The copy says the app will restart.
4. **Model roles group.** Utility, Memory manager (moved from the Memory
   section, stored as a row id) and Embeddings, with re-embedding progress. The
   default chat model stays in General.
5. **Model selector.**
   - Include owner rows and use label fallbacks.
   - Omit hidden rows except the current one; exclude embedding rows.
   - Show an unavailable stored model in the trigger as unavailable.
   - Restore by `last_model_provider_id` before the slug.
6. **Chat failures.** Provider-neutral copy by category, naming the connection,
   with preset hints (for example "Is Ollama running at …?").

Tests:

- Helper and static-markup tests for preferences, selector filtering, failure
  copy and panel states.
- Desktop vault, IPC and supervisor tests.
- **Browser checks** on a task stack at desktop width, then narrow:
  - create a connection against a fake or local server;
  - add a model from a template;
  - probe;
  - assign roles;
  - hide a built-in;
  - remove an in-use model;
  - chat with the selector;
  - see an unreachable-server error.

Checks: `pnpm openapi-ts:check`, `pnpm check`, `pnpm web:lint`,
`pnpm web:test`, `pnpm build`, `pnpm desktop:check`, `pnpm desktop:test`.

Completion: checks pass, browser checks are recorded, and review has no
blocker.

Phase record: issue #169; starting source —; commits —.

#### Code Review #1 Findings

Not yet run.

#### Code Review #1 Revisions

Not yet run.

### Phase 6 — Documentation, decisions and acceptance

Requirements: R13 for R1–R9; acceptance evidence. Depends on Phase 5.

1. **Backend docs:**
   - `model-catalog.md`, `runtime/adding-ai-models.md` and
     `runtime/model-client-providers.md` (fixing the compaction-threshold
     drift);
   - `runtime/chat.md`, `features/memory.md`, `features/user-files.md`;
   - `architecture/{http-api,data-model,overview}.md`;
   - `operations/development.md` (variable table and drift list) and
     `operations/desktop-runtime.md`.
2. **Frontend docs:**
   - `desktop/{overview,installation,troubleshooting}.md`;
   - `runtime/chat.md` (model selector);
   - `features/anima-memory.md`.
3. **Local model setup guide:**
   - Ollama, LM Studio, llama.cpp (`--jinja`) and vLLM;
   - context-window setup, including the Ollama Modelfile;
   - Compose host access through `host.docker.internal`;
   - the keys file.
4. **Configuration:** `.env.example`, `docker-compose.yml` (the optional keys
   `env_file`, `ANIMAMA_LOCAL_MODEL_HOST`, `host-gateway`) and `reset.sh`
   pass-through.
5. **Glossary:** **model connection** and **model role**.
6. **ADR 0009:** companion features are application-owned with provider-native
   fast paths; catalog policy is a composition input. Add it to the index.
7. **Desktop release note:** the next stage re-reviews the core license
   inventory after the dependency removals.
8. Run the owner gates below and record their evidence.

Checks: docs review against the delivered behavior, then the full validation
set below.

Phase record: issue #170; starting source —; commits —.

#### Code Review #1 Findings

Not yet run.

#### Code Review #1 Revisions

Not yet run.

## Final integration review

Covers the combined Plan A diff against the spec's Plan A acceptance, reusing
still-valid phase evidence. One full review and at most two repair rounds.

Not yet run.

## Validation and acceptance

Spec acceptance (Plan A) and its evidence:

| Criterion | Evidence | Phase |
| --- | --- | --- |
| New OpenAI model from a template, no code change or reset | route and executor tests; browser check; gate G2 | 2, 5 |
| Owner rows survive restart and seed; hidden built-ins stay hidden | seed rerun DB test | 1, 2 |
| Keys write-only; absent from DB, API and logs | resolver and route tests; vault tests; log inspection during G1 and G3 | 1, 5, 6 |
| Probe reports and prefills | probe tests; G1 | 2, 6 |
| Fully local on Ollama, LM Studio and llama.cpp | fully local test; G1 | 4, 6 |
| Error categories with one `run.completed` and no assistant row | route tests | 3 |
| Embedding change re-embeds without mixing spaces | service tests | 4 |
| Hosted composition exposes no management routes | composition test | 2 |
| Removed built-ins gone; presets work | catalog tests; G1 preset smoke | 1, 6 |

Full local validation before pushing:

```bash
uv run pytest -q
uv run ruff check
make check-test
bash -n reset.sh
docker compose -f docker-compose.yml config --quiet
docker compose -f docker-compose.yml -f docker-compose.development.yml config --quiet
```

Run both Compose commands with and without `ANIMAMA_CONNECTION_KEYS_FILE`,
after exporting the model directories as in the root guide.

From `src/frontend`:

```bash
pnpm openapi-ts:check
pnpm check
pnpm web:lint
pnpm web:test
pnpm build
pnpm desktop:check
pnpm desktop:test
```

Owner gates:

- **G1 — Fully local acceptance.**
  - Setup: owner hardware, a desktop or task stack with no OpenAI key and
    `OPENAI_BASE_URL` pointed at an unused loopback port.
  - Run on each of Ollama, LM Studio and llama.cpp, with one Anima:
    - turns with speech, emotion, gesture and TTS;
    - memory read and write;
    - a generated title and post-response compaction;
    - a memory-manager run with an approval;
    - embedding search.
  - Record server versions, models, context windows and the probe results.
  - Confirm that backend logs show no OpenAI request and no key values.
  - Acceptance models: `qwen3.5:4b-mlx` or `gemma4:e4b-mlx` (owner,
    2026-09-26), or the same model in the format each server loads.
- **G2 — Live OpenAI template.** With the owner's key, add a current OpenAI
  model ID from a template and complete a turn. Uses the paid API; run only
  with owner authorization.
- **G3 — Desktop keys.** On a development or packaged desktop:
  - save a keyed connection;
  - observe the restart, then a successful probe;
  - remove the connection and its key;
  - load a vault that contains legacy `deepseek` or `gemini` entries.
- Hosted Validation and exact-candidate owner merge approval remain separate.

## Idempotence and recovery

- **Schema.** Baseline edits need a reset of the task's own named stack
  (`./reset.sh --name cfgmodels --base-port 8780 --purge` or the documented
  equivalent). Never reset the owner's main stack or another task's stack. The
  owner decides when to reset their own development databases.
- **Seed.** Rerunning is idempotent and never modifies owner rows or `hidden`.
  Retired built-ins keep their ids, so chat profiles and history stay valid.
- **Removal** is soft. Re-adding a model to the same connection reactivates its
  row; a re-added connection is a new connection with a new id (and managed
  key name). Chats keep their snapshots.
- **Keys.** Removing a desktop connection key uses the existing batched apply.
  Older builds ignore and preserve the vault `connections` field. Legacy
  provider entries are dropped on the first load of the new build; re-enter a
  DeepSeek or Hugging Face key as a connection key.
- **Re-embedding** resumes after a restart from rows whose model id differs
  from the role; search stays on keyword retrieval until it completes.
- **Rollback** is reverting the branch; a reverted build needs a stack reset
  because of the baseline change.

## Outcomes & Retrospective

Not started.
