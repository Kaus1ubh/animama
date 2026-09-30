# Apply desktop API keys without restarting services

Source agreement: [raymond-van/animama#219](https://github.com/raymond-van/animama/issues/219)
as read on 2026-09-30 (Status: Proposal), plus the owner's task instruction of
2026-09-30. That instruction requires a threat model, negative security tests and
an independent security review before the PR.
Authorized scope: whole plan (Phases 1–4, security review and final integration
review), approved by the owner on 2026-09-30 with the recommended decisions D1–D6.
The packaged-app acceptance with real provider keys remains an owner gate.

## Purpose and context

Saving, replacing or removing an API key in the desktop app currently restarts
FastAPI and destroys every product window. After this work, key changes apply to
the running backend in about a second. No window is destroyed or reloaded, and
the FastAPI process keeps its PID. The encrypted vault in Electron main remains
the only durable source of truth. The backend holds a runtime copy in memory.

### Current mechanism (source revision `36a40177`)

| Area               | Behavior                                                                                                                                                                                                                                                                                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vault              | `desktop/src/main-process/runtime/vault.ts`: `CredentialVault` stores `providers` (`openai`, `elevenlabs`) and `connections` (`ANIMAMA_CONNECTION_<ID>_API_KEY`, ≤ 32) encrypted with `safeStorage`. `apply()` writes one batch atomically. `childEnvironment()` maps them to environment names.                                                               |
| Spawn              | `supervisor.ts` `environment()` spreads `childEnvironment()` into the env of FastAPI, the **document worker** and **database commands**. The avatar-cleanup worker has them deleted.                                                                                                                                                                              |
| Save               | `changeCredentials()` runs `quiesceBackend()` → `vault.apply()` → `restartConsumers()`. The last step destroys product windows (`quiesceProductWindows` in `desktop/src/main.ts`) and respawns the document worker and FastAPI.                                                                                                                                     |
| Control channel    | `/_desktop/*` routes are admitted by `LocalHTTPAdmission` (`src/backend/animama/local/http/admission.py`) only when the desktop composition is configured, the `Host` equals the loopback public origin, and `X-Animama-Desktop-Control` matches (SHA-256 + `hmac.compare_digest`). Otherwise they return 404. Existing routes: `/_desktop/health`, `/_desktop/runtime:quiesce`, `/_desktop/feature-packs/{id}:removal-check`. |
| Backend keys       | `Settings.openai_api_key` / `.elevenlabs_api_key` are read once at import (`server/config.py`). `EnvironmentModelCredentialResolver` reads connection keys from `os.environ` (`app/model_clients/credentials.py`).                                                                                                                                                 |
| Key-baked clients  | `build_model_client_registry` gives `OpenAIResponsesModelClient` a fixed `api_key` and a startup `AsyncOpenAI`. `OpenAIChatCompletionsModelClient` caches one `AsyncOpenAI` per `(connection.id, base_url, credential_env, timeout)` with the key in `default_headers`/`api_key`, so the cache key omits the value and a rotated key is never picked up. `get_elevenlabs_client()` is an `lru_cache` holding `ElevenLabs(api_key=…)`. |
| Env fallbacks      | `OpenAIResponsesModelClient` and `OpenAIChatCompletionsModelClient` fall back to `os.getenv("OPENAI_API_KEY")`. `AsyncOpenAI(api_key=None)` and `ElevenLabs(api_key=None)` also read the environment. The `openai-agents` trace exporter reads `os.environ["OPENAI_API_KEY"]` at export time (memory-manager runs on the built-in OpenAI connection).              |
| Renderer           | `web/src/ui/settings/DesktopCredentialsPanel.tsx` (setup and App Settings → API Keys), `ModelConnectionDialog.tsx` (connection keys), and `desktop-credential-state.ts`. The panel shows "Restarting local services…". Setup blocks key edits when its draft cannot be saved, because a save replaces the renderer (`routes/setup.tsx`).                          |

### Answers to the issue's open questions

1. **Endpoint shape: full snapshot plus a generation acknowledgement.** Main sends
   the complete vault-derived set on every change with
   `PUT /_desktop/credentials`. The backend replaces its store atomically.
   - The body carries a per-launch, monotonically increasing `generation`, and
     the backend echoes it.
   - A snapshot is idempotent, so Retry is simply "send the current vault again".
   - Removal is expressed by absence, so there is no merge logic or partial state
     that could drift from the vault.
   - The bounded size (2 providers + 32 connections × 8192 characters, ≤ 300 KiB)
     is cheap on loopback.
   - The generation stops a delayed or retried older push from overwriting a
     newer one, because the backend refuses any generation ≤ its current one.
   - It also lets main confirm exactly which snapshot was applied.
   - Per-change deltas were rejected: they need ordering and merge rules and
     cannot self-heal after a lost request.
2. **Other key consumers.** The **document worker does consume provider keys**.
   `workers/user_file_processing.py` embeds user-file chunks through
   `server.embeddings.role_embedder` → `build_model_credential_resolver`, which
   uses the OpenAI key or a connection key inherited from its spawn environment.
   The **avatar-cleanup worker does not**; main already strips keys from its env.
   **Database commands** (`animama-runtime database …`) receive keys but never
   use them.
   Plan:
   - After each successful delivery, restart only the document worker, and only
     when the document-processing pack is active. Its SIGTERM handler finishes
     the claimed batch, and a lease recovers any interruption.
   - Stop passing keys to database commands.
   - No worker gets a control endpoint.

### Boundaries

- The vault format, encryption and `safeStorage` usage stay unchanged.
- Feature-pack install/removal and app updates keep their restart behavior.
- Self-host, the Compose development stack and `desktop:dev` against an external
  stack get no credential route and no new behavior. They keep reading keys from
  their environment at startup.
- No generic environment editor. The route accepts only the provider names and
  the managed connection-key pattern.
- The renderer stays write-only. It receives status, never values or the control
  token, and PiP/quick-chat windows gain no credential access.

## Threat model

Assets: provider key values (OpenAI, ElevenLabs, model-connection keys), the
per-launch control token and the renderer capability. Trust boundaries: Electron
main ↔ renderer (IPC), Electron main ↔ FastAPI (loopback HTTP), FastAPI ↔ its
libraries and child processes, and FastAPI ↔ logs.

| #  | Threat                                                                                                                                         | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                       | Negative tests                                                                                                                                                                                                                      |
| -- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1 | A local process or web page reaches the loopback port and writes keys, for example to redirect traffic to an attacker-held key.             | The route sits under `/_desktop`, so the existing admission requires the ≥ 32-character per-launch control token and compares SHA-256 digests in constant time. A missing or wrong token returns an indistinguishable 404. The route is registered only when `http_config.desktop` is configured, which needs both launch secrets and is absent in self-host, Compose and external `desktop:dev`. The token is only in FastAPI's env and main's memory, is added to `runtimeRedactor`, and `DesktopAccess` already enforces that it differs from the renderer capability. | Missing, wrong, short, non-ASCII or duplicated token → 404 and store unchanged. Renderer capability sent as the control token → 404. Self-host/Compose composition → 404 and route absent from `app.routes`. Not in OpenAPI. |
| T2 | A browser page (CSRF, DNS rebinding, or a compromised renderer's `fetch`) sends the request.                                                   | Admission already requires `Host` to equal the loopback authority, which stops DNS rebinding with 421. New: for every `/_desktop/*` path, reject any `Origin` header and any `Sec-Fetch-Site`/`Sec-Fetch-Dest` header (Node/undici fetch sends neither; browsers send them to loopback). The custom control header forces a CORS preflight. `OPTIONS` has no token, so it gets 404, and no CORS headers are ever emitted. `Content-Type` must be `application/json`. The renderer cannot obtain the token. | `Origin` (any value, including the app origin), `Sec-Fetch-Site: same-origin/cross-site`, wrong `Host` (`localhost:<port>`, `evil.test`) → rejected. `OPTIONS` → 404 without `Access-Control-*`. `text/plain` → rejected. |
| T3 | A key leaks through logs, access logs, tracebacks, crash reports, metrics, query strings or response bodies.                                  | The body stays out of Pydantic: the route reads the raw body with a bounded read and validates manually, so FastAPI's 422 handler, which echoes input, cannot run. Every failure returns a fixed `{"detail":{"code":…}}`. Parse and apply errors are re-raised `from None` with no values in messages. Values live only in `CredentialSnapshot` fields with `repr=False`. The success body is `{schema_version, generation}` only. The route never logs the body. Uvicorn access logs record method/path/status only (verified in a test). Main sends values only in the JSON body, never the URL, and registers every value with `runtimeRedactor` before sending. Desktop disables OTel (`OTEL_SDK_DISABLED`) and the backend has no crash reporter (verified: no Sentry). | A sentinel key in malformed, oversize, bad-name and bad-value requests never appears in the response body, `caplog`, captured stderr or the exception chain. The route has no Pydantic body model (asserted). Supervisor push failures leave the sentinel out of status and logs. |
| T4 | Environment-variable injection. A crafted name overrides `PATH`, `PYTHONPATH`, `DYLD_*`, or pushed values leak to subprocesses.               | The backend re-validates names against the same allowlist as main: `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, and `MANAGED_CREDENTIAL_ENV_PATTERN` (identical to `connectionCredentialPattern`). It also enforces value rules (1–8192 characters, no control/space characters), ≤ 32 connection names and a 512 KiB body cap. Values go into an in-memory store and are **never** written to `os.environ`. In the desktop composition, FastAPI also removes the credential names from `os.environ` after loading them at startup, so no stale copy remains for SDK env fallbacks or child processes. | `PATH`, `PYTHONPATH`, `DYLD_INSERT_LIBRARIES`, lowercase or overlong names, `DEEPSEEK_API_KEY`, 33 connections, a 8193-character value, control characters, unknown top-level fields and duplicate JSON keys → 400. `os.environ` is unchanged after any push. A parity test pins backend and desktop patterns and limits. |
| T5 | A removed or replaced key keeps working through a cached client, pool, default header, fingerprint cache, registry entry or env fallback.     | Long-lived OpenAI SDK clients hold **no key**: a placeholder `api_key` and no `Authorization` default header. Each request creates a keyed view with `client.with_options(api_key=…, default_headers=…)`; in `openai` 2.x `copy()` shares the key-free `httpx` pool, and the view is dropped when the request ends. `lru_cache` ElevenLabs clients are replaced by a client built per request from the pinned key; the pool stays shared through one key-free `httpx` client. The voice-access cache is keyed by store generation and cleared on ElevenLabs key changes. The trace-export key is reset from the store on every change. All `os.getenv("OPENAI_API_KEY")` fallbacks are removed, and the SDKs always receive an explicit key or placeholder. | After replacing the store with `{}`, every consumer reports the key missing on its next use: Responses, Chat Completions, embedder, probe, memory manager, ElevenLabs TTS/realtime, credential status. No cached client, header or trace exporter contains the old sentinel. Replacement: a mock transport sees the new `Authorization` on the next request. |
| T6 | Races. Concurrent saves interleave, a request mixes keys, or a failed delivery leaves the backend on a key that differs from the vault indefinitely. | Main serializes saves in the existing supervisor queue, with the vault write and delivery inside one queued operation. Pushes carry monotonic generations. The backend swaps an immutable snapshot by a single assignment on the event loop. Each admitted HTTP/WebSocket scope pins the snapshot at admission in a `ContextVar`, and tasks spawned by the request inherit it. Background loops (embedding refresh, document worker) read the current snapshot per unit of work. A spawn always passes the current vault. Delivery-failure handling is in [D1](#decision-log). | Two concurrent saves apply in order, with generations increasing. A stale generation → 409 with the store unchanged. A request pinned before a swap uses the old key for all of its provider calls, while a request started afterwards uses the new key. After a failed push, a backend restart gets the current vault. |
| T7 | Widening existing boundaries.                                                                                                                  | No vault changes. The new IPC (`credentials:retry-delivery`) takes no arguments, is main-window only and goes through `RuntimeIpcCallers.require`. The unused `credentials:set`/`credentials:delete` IPC is removed ([D4](#decision-log)). No endpoint returns key values. The store is not exposed through any `/v1` route beyond the existing configured/missing credential state.                                                                                                                                                                      | The retry IPC rejects unregistered, PiP-style, recovery and wrong-arity callers. Status objects contain no value fields (asserted by key set).                                                                                                                                       |

## Progress

- [x] Plan drafted on branch `feat/live-api-keys` from `origin/main` `36a40177`.
- [x] Workspace: worktree `worktrees/live-api-keys/animama` (sibling of the primary checkout), branch `feat/live-api-keys` pushed to `origin`, base `origin/main` `36a40177`; phase issues #222–#225 are sub-issues of #219. No Compose stack started.
- [x] Owner approved this plan and the recommended decisions D1–D6 (2026-09-30).
- [x] Phase 1 (#222): backend runtime credential store and live-safe consumers. Review passed (Review #2); `make check-test` 2792 passed.
- [ ] Phase 2 (#223): authenticated desktop credential route.
- [ ] Phase 3 (#224): Electron main live delivery.
- [ ] Phase 4 (#225): renderer, setup and documentation.
- [ ] Security review (`security-review` skill + `sdlc-reviewer`) and final integration review.
- [ ] Owner gate: packaged macOS acceptance with real provider keys.

## Surprises & Discoveries

- 2026-09-30: The document worker inherits provider keys and uses them for
  user-file embeddings (`workers/user_file_processing.py` → `role_embedder`), so
  it needs the same update path.
- 2026-09-30: `OpenAIChatCompletionsModelClient._clients_by_connection` caches SDK
  clients under a key that omits the credential value, so a rotated connection
  key would keep using the old value even without the restart change.
- 2026-09-30: `openai-agents` `BackendSpanExporter` falls back to
  `os.environ["OPENAI_API_KEY"]` when exporting traces.
- 2026-09-30: `/_desktop/*` admission today does not reject `Origin` or
  `Sec-Fetch-*`. All existing callers are Electron main's Node `fetch`. Phase 2
  must confirm with a captured request that undici sends neither `Origin` nor
  `Sec-Fetch-Site`/`Sec-Fetch-Dest` (it may send `Sec-Fetch-Mode`, which stays
  allowed) before enforcing the rejection.
- 2026-09-30 (Phase 1): `ElevenLabs.__init__` takes
  `api_key=os.getenv("ELEVENLABS_API_KEY")` as a default argument, which is
  evaluated when the SDK is imported. Scrubbing inside `create_local_app` would
  run too late. `animama-runtime serve` therefore scrubs before importing the
  application, and `create_local_app` scrubs again for the desktop composition.
- 2026-09-30 (Phase 1): `openai-agents` 0.18.0 persists an unsalted SHA-256 of
  a per-run `RunConfig(tracing={"api_key": …})` key in serialized run state, so
  per-run keys must not be used (P1-R1-F1). A store subscriber
  (`follow_trace_export_key`) sets the exporter's key instead, as planned, and
  clears it to `""` on removal.
- 2026-09-30 (Phase 1): A new test caught a gap in the first Responses-client
  draft. Once its shared client existed, a removed key skipped the missing-key
  check and would have sent the placeholder. The check now depends on whether a
  test client was injected, not on whether a client exists.
- 2026-09-30: Backend baseline on `36a40177` (clean source): full suite passed
  (the one failure seen in the first run was caused by edits made mid-run and
  passes on clean source).
- 2026-09-30: The renderer's `applyCredentialChange` and the
  `credentials:set`/`credentials:delete` IPC have no renderer callers; only
  `credentials:apply` is used.

## Decision Log

On 2026-09-30 the owner approved the plan with every recommended decision:
D1 option A and D2–D6 as written.

- **Q1 (agent resolution, 2026-09-30):** full-snapshot `PUT /_desktop/credentials`
  with a per-launch monotonic `generation` echoed by the backend. Rationale is in
  [open questions](#answers-to-the-issues-open-questions).
- **Q2 (agent finding, 2026-09-30):** the document worker consumes keys, so it is
  restarted after delivery (D3). The cleanup worker does not. Database commands
  stop receiving keys.
- **D1: delivery-failure policy (owner-approved: A).**
  - A: main retries the push once immediately. If it fails again, main falls back
    to the existing restart path: quiesce, then `restartConsumers`, which spawns
    from the current vault. If quiesce reports busy, main records
    `credential_delivery_failed` with `applyPending: true`. The panel then shows a
    Retry that re-runs delivery (push, then fallback) without re-entry, and main
    also re-attempts the push in the background at 5 s, 15 s, 30 s and then every
    60 s until it succeeds, the next save runs, or the app shuts down. The window
    teardown happens only on this double-failure path. The backend can never
    keep a key that differs from the vault beyond a busy window.
  - B: no automatic restart; only background re-push and panel Retry. The
    backend keeps the old or removed key until a push succeeds or the app
    restarts.
- **D2 (owner-approved: yes):** the desktop FastAPI removes the credential
  names from `os.environ` after loading its store at startup. Self-host keeps its
  environment unchanged.
- **D3 (owner-approved: yes):** restart the document worker (graceful
  SIGTERM, 15 s bound) after every successful delivery while the
  document-processing pack is active. It runs as a follow-up queued operation, so
  Save returns without waiting for it.
- **D4 (owner-approved: yes):** remove the unused `credentials:set` and
  `credentials:delete` IPC, their preload bridge methods and
  `applyCredentialChange`. Rename status field `restartRequired` to
  `applyPending` (saved in the vault, not yet applied to the running backend).
- **D5 (owner-approved: yes):** reject `Origin`, `Sec-Fetch-Site` and
  `Sec-Fetch-Dest` on **all** `/_desktop/*` routes, not only the new one, since
  every caller is Electron main.
- **D6 (owner-approved as written):** R3 "request" means one admitted
  Animama HTTP request or WebSocket, such as a chat SSE turn, including tasks it
  spawns. Work in progress keeps the snapshot pinned at admission, and every
  later request uses the new snapshot. Background loops take the current
  snapshot per job.

## Phased implementation

One branch (`feat/live-api-keys`) and one PR. Phase issues are created under
#219 when implementation is authorized. Phases 1–2 are backend only and change
no desktop behavior; FastAPI still gets keys at spawn. Phase 3 switches main to
live delivery. Phase 4 updates the renderer and docs.

### Phase 1: Backend runtime credential store and live-safe consumers

Requirements: R2, R3, R5 (values in memory only) and the removal requirement.
Threats T4 (store only), T5, T6. Working directory: repository root.

Changes:

1. Add `animama/app/model_clients/credential_store.py`:
   - `CredentialSnapshot`: frozen, with `generation: int` and a read-only mapping
     of values; values are excluded from `repr` and `__eq__` output.
   - `RuntimeCredentialStore` with `snapshot()`, `replace(values, generation)` and
     change subscribers. `replace` validates names and values, rejects a
     `generation` ≤ the current one, and notifies subscribers synchronously on
     the event loop.
   - `is_deliverable_credential_name()`: the provider names plus
     `MANAGED_CREDENTIAL_ENV_PATTERN`.
   - `current_credentials()`: the `ContextVar`-pinned snapshot, falling back to
     `store.snapshot()`.
   - `pinned_credentials(snapshot)`: a context manager.
2. Add `animama/server/runtime_credentials.py`, which creates the process
   singleton from the environment at import (generation 0). It reads
   `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, `KNOWN_PROVIDER_CREDENTIAL_ENVS` and
   managed-pattern names. It also provides `scrub_credential_environment()` (D2).
3. Remove `Settings.openai_api_key` and `Settings.elevenlabs_api_key`. Replace
   `EnvironmentModelCredentialResolver` with `RuntimeModelCredentialResolver`,
   which reads `current_credentials()`. `build_model_credential_resolver()`
   returns it everywhere: routers, embeddings, memory manager, worker.
4. Pin the snapshot per scope with a small ASGI middleware added in
   `create_local_app` for `http` and `websocket` scopes (D6).
5. Model clients:
   - `OpenAIChatCompletionsModelClient`: cache key-free base clients per
     `(connection.id, base_url, timeout)`. Resolve the credential **once** per
     `stream()` and use it for the usable check, the keyed view and the keyless
     headers.
   - `sdk_client_for_connection`: split into a key-free base builder plus
     `keyed_client(base, connection, credential)`.
   - `OpenAIResponsesModelClient`: take a credential resolver instead of
     `api_key`. Resolve the built-in credential once per `stream()` and raise
     `missing_api_key` when absent. Use a key-free base client with a
     `with_options` keyed view. The registry always builds it.
   - Remove the `os.getenv("OPENAI_API_KEY")` fallbacks.
   - Memory manager, probe and embedder resolve once per run or probe and pass
     the credential through.
6. ElevenLabs: replace `get_elevenlabs_client` (`lru_cache`) and
   `_require_api_key` with a function that builds a client from the pinned key
   and a shared key-free `httpx` client. Key the voice-access cache by store
   generation and clear it through a store subscriber when the ElevenLabs value
   changes.
7. Trace exporter: a store subscriber calls
   `agents.set_tracing_export_api_key` with the current OpenAI value, or `""`,
   which disables export once the env copy is scrubbed.
8. Update tests that set `settings.openai_api_key` or `ELEVENLABS_API_KEY`
   through a `runtime_credentials` fixture that replaces and restores the
   singleton.

Tests (TDD, `tests/`):

- Store validation and generation.
- Resolver reads the current and pinned snapshot.
- Removal and replacement for each consumer, using mock transports that record
  `Authorization` / `xi-api-key`.
- No old sentinel remains in cached clients, headers or the trace exporter.
- An in-flight pinned request keeps the old key across multiple provider calls.
- The scrub removes only credential names.
- Self-host startup still reads keys from the environment.

Checks: `uv run pytest -q`, `uv run ruff check`, `make check-test`.

Completion: all consumers read the store per request, and existing behavior is
unchanged when the store never changes.

#### Code Review #1 Findings

Reviewed source: uncommitted Phase 1 working tree on `feat/live-api-keys` over
`c92d198b`. Reviewer: independent `sdlc-reviewer` agent. The checks agent ran
`ruff check`, `ruff format --check`, mypy, the Python import-boundary check and
the full backend suite. All passed: 2789 passed, 7 skipped.

- **P1-R1-F1 (should-fix):** passing a per-run tracing key made `openai-agents`
  0.18.0 persist `tracing_api_key_hash`, an unsalted SHA-256 of the OpenAI key,
  in `serialized_agent_state` in Postgres for runs awaiting approval. The
  baseline persisted no key-derived data.
- **P1-R1-F2 (should-fix):** no test proves that `create_local_app` installs
  `PinnedCredentialsMiddleware` or that the desktop composition, or `serve`,
  scrubs `os.environ` while self-host does not. Deleting that wiring would pass
  every test.
- **P1-R1-F3 (should-fix):** the desktop composition tests scrub the test
  session's `os.environ` and never restore it, so later tests depend on order
  and live runs lose `OPENAI_API_KEY`.
- **P1-R1-F4 (optional):** an embedding-refresh owner batch resolves keys per
  embed call, so a swap in the middle of a batch can mix keys.
- **P1-R1-F5 (optional):** three overlapping name predicates;
  `is_process_credential_env` is exactly `is_allowed_credential_env` plus
  ElevenLabs.
- **P1-R1-F6 (optional):** `static_credential_resolver` builds a full store,
  and a new `ContextVar`, per adapter.
- **P1-R1-F7 (optional):** missing tests for key replacement in the memory
  manager and for the registry's default resolver following the process store.
- **P1-R1-F8 (optional, docs):** the backend docs already describe Electron main
  replacing the store; that becomes true only in Phase 3. Re-check at final
  integration.

#### Code Review #1 Revisions

- **P1-R1-F1: accepted and fixed.** Removed the per-run tracing key.
  `server/runtime_credentials.follow_trace_export_key` subscribes the exporter
  to the store (installed by `create_local_app`, idempotent).
  `test_memory_manager.py` asserts `run_config.tracing is None`, and
  `test_trace_export_key_follows_the_process_store` covers replacement and
  removal.
- **P1-R1-F2: accepted and fixed.**
  `test_local_app_composition.py::test_startup_admits_only_the_bootstrap_owner…`
  asserts that `PinnedCredentialsMiddleware` is `user_middleware[0]`, that
  desktop `serve` removes the credential names from `os.environ`, and that
  self-host keeps them. A mutation check (removing the middleware and the app
  scrub) makes both cases fail.
- **P1-R1-F3: accepted and fixed.** The autouse
  `_restore_runtime_credentials` fixture also snapshots and restores the
  credential names in `os.environ`.
- **P1-R1-F4: accepted.** `EmbeddingRefreshWorker._refresh_owner` pins one
  snapshot per owner batch.
- **P1-R1-F5: accepted.** `is_allowed_credential_env` moved to
  `credential_store`, `is_process_credential_env` is defined from it, and
  `credentials.py` re-exports it.
- **P1-R1-F6: accepted.** `FixedCredentials` (a constant snapshot) backs
  `static_credential_resolver`, and the resolver takes any `CredentialSource`.
- **P1-R1-F7: accepted.** Added `test_memory_manager_runs_on_a_replaced_key`
  and `test_registry_default_resolver_follows_the_process_store`. The probe
  builds its client from one resolution per call, which is already covered by
  the probe tests.
- **P1-R1-F8: deferred** to final integration. Phase 3 makes the statement true.
- **Verification:** `make check-test` passed: ruff, format, mypy, 2792 passed,
  7 skipped. Repair budget: 1 of 2 rounds used.

#### Code Review #2 Findings

Targeted recheck by an independent `sdlc-reviewer` of the same working tree
after the revisions. F1–F7 are verified with evidence: the installed
`agents` 0.18 serializes only a per-run key's hash; test order was checked for
F3; targeted tests (202) and ruff, format and mypy pass. Nothing blocks.
Non-blocking notes: one test leaves an `AsyncOpenAI` view unclosed. The desktop
`serve` path scrubs twice, in the CLI and in the factory, and this is harmless.
Result: pass.

#### Code Review #2 Revisions

No change required. Phase 1 is complete: 1 of 2 repair rounds used.

### Phase 2: Authenticated desktop credential route

Requirements: R5 and the security instruction items 1–4. Threats T1–T4. Depends on
Phase 1.

Changes:

1. `PUT /_desktop/credentials` in `server/routers/desktop_control.py`, mounted
   only through the existing `if http_config.desktop is not None` block.
   - Handler signature: `Request` only. It requires `content-type:
     application/json`, reads the body with a 512 KiB cap (checking
     `content-length` first), and parses with a duplicate-key-rejecting
     `object_pairs_hook`.
   - Exact shape:
     `{"schema_version":1,"generation":<int ≥1>,"credentials":{<name>:<value>}}`.
     Unknown fields → 400.
   - The store is replaced atomically. Success returns
     `{"schema_version":1,"generation":N}` with `cache-control: no-store`.
   - Failures return fixed codes: `credentials_invalid` 400,
     `credentials_too_large` 413, `credentials_media_type` 415,
     `credentials_generation_stale` 409.
   - Errors are raised `from None`, and nothing is logged beyond the code.
2. D5: in `LocalHTTPAdmission`, `/_desktop` paths also reject requests that carry
   `Origin`, `Sec-Fetch-Site` or `Sec-Fetch-Dest`, with the same 404 as a bad
   token so probes learn nothing.
3. Capture one real request from Electron main's Node `fetch` in a desktop test
   harness to confirm its headers before enforcing (see Discoveries).

Tests (`tests/test_desktop_credentials_route.py`, extending
`tests/test_local_http_*`): every T1–T4 negative case in the threat model. Each
one uses a sentinel value and asserts it is absent from the response, `caplog`,
`capsys` and `__cause__`/`__context__`. The happy path acks the generation and
updates the store with `os.environ` unchanged. Existing `/_desktop` routes still
work with a header set matching Node fetch.

Checks: as in Phase 1.

Completion: the route exists only in the desktop composition and every negative
case passes.

#### Code Review #1 Findings

#### Code Review #1 Revisions

### Phase 3: Electron main live delivery

Requirements: R1, R4, R6 (main side), and the security instruction items 3, 6
and 7. Threats T3, T6, T7. Depends on Phase 2. Working directory: `src/frontend`.

Changes (`desktop/src/main-process/runtime/`):

1. `supervisor.ts` `changeCredentials()`, inside `serialize`:
   1. validate;
   2. check capacity;
   3. register values with `runtimeRedactor`;
   4. `vault.apply(batch)`;
   5. `deliverCredentials()`;
   6. on success, clear this batch's failures and queue a document-worker restart
      (D3);
   7. return `credentials()`.

   It does **not** call `stage()`, `quiesceBackend()`, `quiesceRenderers()` or
   `restartConsumers()` on the success path, so the status stays `ready`.
2. `deliverCredentials()`:
   - Sends `PUT` to `/_desktop/credentials` with only the control token and
     `content-type` headers, `redirect: "error"` and a 5 s timeout.
   - The body is `vault.childEnvironment()` with `++credentialGeneration`.
   - Verifies the ack's `schema_version` and `generation` with
     `readDesktopControlJson`.
   - Discards error details: the code never includes `error.message` or `cause`.
   - Failure follows D1.
3. `retryCredentialDelivery()` plus IPC `credentials:retry-delivery` (0 args,
   main-window only) and the preload method `retryDelivery()`.
4. `applyPending` replaces `restartRequired` (D4). Remove the
   `credentials:set`/`credentials:delete` IPC, `changeCredential` and the unused
   bridge methods.
5. `databaseCommand` receives an environment without credential names.
6. A spawn after any failure uses the current vault (unchanged `environment()`).
   Reset `credentialGeneration` bookkeeping per backend child; the backend
   starts at 0.

Tests (`desktop/tests/runtime-supervisor.test.ts`, `runtime-ipc.test.ts`), using a
fake loopback backend:

- The save issues no quiesce or restart, the backend PID is unchanged and the
  status never leaves `ready`.
- The push has headers without `Origin`, a full snapshot and an increasing
  generation.
- Values are registered with the redactor before the push.
- Removal sends a snapshot without the name.
- Concurrent saves run in order.
- Push failure: vault saved, `applyPending` and the failure code set, no value in
  the status or the captured log. The D1 fallback runs, busy is handled, and the
  background re-push stops after success.
- Retry IPC re-delivers without values and rejects bad callers and arity.
- The document worker restarts only when the pack is active.
- Cleanup-worker and database-command envs contain no keys.
- A restart after a failed push spawns with the current vault.

Checks: `pnpm check`, `pnpm desktop:check`, `pnpm desktop:test`.

Completion: in automated tests, a key save changes the backend's store without
any process or window restart.

#### Code Review #1 Findings

#### Code Review #1 Revisions

### Phase 4: Renderer, setup and documentation

Requirements: R1, R4 and R6 on the renderer side, plus the documentation
acceptance. Depends on Phase 3.

Changes:

1. `DesktopCredentialsPanel`:
   - The button reads "Saving…".
   - Success copy: "Saved."
   - The description drops "local services restart after saving".
   - Pending-apply failures show a Retry that calls `retryDelivery()`.
   - After success, invalidate the model-provider, model-configuration
     (connections, credential state, roles) and ElevenLabs/voice availability
     queries. Identify the exact keys in `web/src/query/keys.ts`.
2. `desktop-credential-state.ts`: remove `applyCredentialChange`, update
   `credentialFailureMessage` for `credential_delivery_failed`/`applyPending`,
   and update `applyCredentialChanges` to check `applyPending`.
3. `ModelConnectionDialog.tsx`: drop the "replaces this window" assumption and
   invalidate the same queries.
4. `routes/setup.tsx`: the draft-retention block no longer gates API keys, only
   speech downloads, which still restart. Pending-edit and busy guards stay.
5. Docs:
   - `docs/frontend/desktop/installation.md` and `overview.md`: describe live
     apply, failure/Retry and the document-worker restart.
   - `docs/backend/`: runtime credential store and route, where the desktop
     control routes are documented.
   - The glossary only if a term changes.

Tests: `web/src/ui/settings/*.test.tsx` cover no restart copy, Retry calling
`retryDelivery`, query invalidation, and setup allowing key edits when the draft
is unavailable.

Checks: `pnpm check`, `pnpm web:lint`, `pnpm web:test`, `pnpm build`,
`pnpm desktop:check`, `pnpm desktop:test`.

#### Code Review #1 Findings

#### Code Review #1 Revisions

## Final integration review

Before the PR:

1. Run the `security-review` skill on the full branch diff.
2. Run an independent `sdlc-reviewer` pass with the threat model as acceptance.
3. Record findings and dispositions here: one initial review and at most two
   repair rounds.
4. Then run the combined integration review against R1–R6.

## Validation and acceptance

Local automated evidence, since hosted CI does not run on PRs:

- Backend (repository root): `uv run pytest -q`, `uv run ruff check`,
  `make check-test`.
- Frontend (`src/frontend`): `pnpm check`, `pnpm web:lint`, `pnpm web:test`,
  `pnpm build`, `pnpm desktop:check`, `pnpm desktop:test`.

Packaged app: `pnpm desktop:mac:build:run` from the worktree's `src/frontend`.

- **Agent-run with generated test values:**
  - Add, replace and remove a fake OpenAI key, ElevenLabs key and connection
    key in setup and App Settings.
  - Record the FastAPI PID before and after, and confirm no window reload
    (window generation and renderer PID unchanged).
  - A chat after adding a fake key fails with a provider authentication error.
    This shows the new key is used without a restart. After removal it reports
    "not configured".
  - Then scan the app logs, renderer storage (Local Storage, IndexedDB, session
    storage) and crash-report directories for the fake values.
- **Owner gate:** the same flows with real keys. A chat succeeds immediately
  after adding an OpenAI key; ElevenLabs voice synthesis and a model-connection
  chat work after adding their keys.

## Idempotence and recovery

- Delivery is idempotent. Every push is the whole vault, so Retry or background
  re-push converges regardless of what was lost.
- The vault write is atomic and happens before delivery, so a crash at any point
  leaves the vault authoritative. The next spawn reads it.
- If the route misbehaves in a release, D1's fallback restart path still applies
  keys, the same way the app does today.
- Tests replace the backend store through a fixture that restores the prior
  snapshot. No shared stack or database data is touched.

## Outcomes & Retrospective

Not started.
