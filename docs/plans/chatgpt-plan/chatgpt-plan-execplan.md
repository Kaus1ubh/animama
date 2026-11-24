# Use a ChatGPT plan instead of an API key

Source agreement: [#919](https://github.com/raymond-van/animama/issues/919),
published from the agreed [spec](chatgpt-plan-spec.md) at
2026-11-24T18:25:43Z. The owner accepted the spec on 2026-11-24 including P1
to P8, and it was revised the same day with this plan's D2, D5 and D6.
Authorized scope: the whole plan. The owner approved it, including D1 to
D14, on 2026-11-24 (G0), authorized Phase 0 the same day, and asked for the
rest to be implemented after Phase 0 ("implement the execplan"). Gates G1 to
G4 still apply where the phases name them.
Planning baseline: `origin/main` at `1c7d7295e`, which the line numbers below
refer to. Implementation base: `origin/main` at `c7b98f73a`; nothing the plan
cites changed between the two.
Workspace: worktree `chatgpt-plan`, branch `feat/chatgpt-plan`. Task stack
`animama-chatgpt-plan` at `http://animama-chatgpt-plan.localhost:9100`,
started with `./reset.sh --name chatgpt-plan --base-port 9100` when a phase
needs it and stopped afterwards; it holds only test data.

## Purpose and context

After this plan, a person using the desktop app or a self-hosted stack on
their own machine can choose **Continue with ChatGPT** in App Settings →
Models or in first-run setup, sign in at OpenAI in their browser, and pick a
model from their ChatGPT plan for an Anima's chat, the default chat model,
Utility and the Memory Manager, with no API key. Tokens rest only on that
machine. The app shows when the plan is in use, links to OpenAI's usage
settings, stops cleanly at a usage limit and never moves a request to another
connection by itself. Work the backend starts by itself uses the plan only
after the person agrees. Hosted, embeddings, speech and image generation are
out of scope. No database migration is expected.

Orientation, from read-only surveys on 2026-11-24 (paths under
`src/backend/animama` unless they start with `src/frontend`, `tests`, `docs`,
`scripts` or `contracts`; line numbers at `1c7d7295e`):

- **Admission.** `local/http/admission.py` `LocalHTTPAdmission` (L55) admits
  every HTTP and WebSocket request, including `/health` and static files.
  `Host` must equal `LocalHTTPConfig.authority` exactly or the answer is 421
  (L131). `_browser_status` (L91) then requires `Origin`, when present, to
  equal the public origin, `Sec-Fetch-Site` to be absent, `none` or
  `same-origin`, and on desktop a matching `animama_renderer_capability`
  cookie (401 otherwise). Only `/_desktop/*` takes another path, with its own
  control token. OpenAI's return to `http://127.0.0.1:<port>/auth/callback` is
  a cross-site navigation from the system browser, so today it is refused in
  every mode: 403 for the fetch metadata, 401 on desktop for the cookie, and
  421 on a stack whose origin is `http://localhost:<port>`.
- **Origins.** Desktop uses `http://127.0.0.1:<saved port>`, stable across
  launches (`src/frontend/desktop/src/main-process/runtime/supervisor.ts`
  L321-345, `runtime/state.json`). A stack uses `ANIMAMA_PUBLIC_ORIGIN`,
  default `http://localhost:8000` (`server/config.py` L69); `reset.sh` allows
  loopback hosts only. In development Vite serves that origin and proxies to a
  private FastAPI with the browser's `Host` unchanged.
- **Serving.** `local/http/composition.py` `install_local_http` (L21)
  registers the asset catch-all last (L90-95), so a router included earlier in
  `server/app.py` `create_local_app` wins. `local/http/assets.py` answers a
  navigation outside `_NO_FALLBACK_PREFIXES` (L90-103) with `index.html`, so
  `/auth/callback` would return the app shell today. The development proxy
  forwards only `/v1`, `/health` and telemetry
  (`src/frontend/web/vite-plugins/local-api-proxy.ts` L34-48).
- **Routes and capabilities.** `product_http/inventory.py` lists every route
  in mount order as `_shared`, `_local` or `_excluded(capability)`, and
  `tests/test_product_http_inventory.py` pins it.
  `server/routers/model_configuration.py` is the local-only precedent, mounted
  at `server/app.py` L100. `app/contracts/runtime_capabilities.py` (L56) and
  `server/runtime_capabilities.py` (L45) define and fill capabilities,
  `contracts/runtime-capabilities/hosted.json` holds the hosted values, and
  `src/frontend/web/src/app/hosted-runtime/hosted-composition.ts` L527-545
  refuses local-only ones.
- **Contracts.** `contracts/versions.json` has `local-http` `23.0.0`; any
  structural OpenAPI change needs a new major. `runtime-contracts` is `0.23.0`
  and `product-ui` `0.20.0`; changed declarations need a version bump, checked
  by `scripts/package-sets` `compare`. The chat image input plan (#904) also
  plans `24.0.0`; whichever merges second takes the next major.
- **Credentials today.** Keys live in the desktop vault
  (`src/frontend/desktop/src/main-process/runtime/vault.ts`), one
  `safeStorage`-encrypted blob at `secrets/vault.bin` that also holds the
  generated `postgresPassword`. Electron main sends keys to the backend in the
  spawn environment and through `PUT /_desktop/credentials`
  (`server/routers/desktop_control.py` L141) into `RuntimeCredentialStore`
  (`app/model_clients/credential_store.py`). Nothing flows from the backend to
  Electron main. `backendEnvironment()` (`supervisor.ts` L222) carries
  backend-only values such as the control token. A self-hosted backend reads
  keys from its environment at startup.
- **Private data.** `ANIMAMA_DATA_ROOT` is `<userData>/data` on desktop and
  the `data` volume in a stack; `server/local_runtime.py` L85 lays out
  `internal/…`. `adapters/content_store/mutations.py` `persist` (L225) is the
  atomic owner-only write (`utils/files.py` `open_no_follow`,
  `sync_directory`, `replace`). `scripts/backup-local.sh` L98 archives the
  whole data tree except listed paths.
- **Catalog.** Connections and models are rows in `model_connections` and
  `model_providers` (unique on `connection_id, provider_type, model, source`).
  Built-in ones come from `app/model_catalog.py` through the repeatable seed
  `src/backend/migrations/seeds/01-seed-model-providers.sql`, which runs at
  every start and deactivates any `builtin` row missing from the catalog
  (L165). Row ids are `<provider_type>:<model>`. Anthropic is the precedent
  for a built-in connection: `domain/model_connection.py` L17-20,
  `app/model_clients/credentials.py` L97-142, `app/model_connection_presets.py`,
  `app/services/model_configuration_service.py` `_provider_type` (L569) and
  `app/chat/direct_turn/provider_state.py`
  `validate_model_provider_for_direct_turn` (L90). `ModelCatalogPolicy`
  (`app/services/model_provider_catalog_service.py` L19) offers the hosted
  composition the `openai` connection only.
- **Selections.** An Anima's model is
  `anima_chat_profiles.default_model_provider_id`, a foreign key to
  `model_providers.id`. Roles are owner preferences read by
  `app/services/model_role_resolver.py`, whose `suits_role` (L149) already
  limits Embeddings to embedding models. A missing credential is found at
  request time, not at selection, and the public model list carries no
  credential state.
- **Responses adapter.** `adapters/model_clients/openai_responses/client.py`
  refuses any connection but `openai` (L159), resolves the key once per stream
  and makes a per-request view of one key-free `AsyncOpenAI` with
  `with_options(api_key=…)` (L406). `request.py` `create_response_kwargs`
  (L53) sends `store` (true unless told otherwise), `moderation` when crisis
  detection is on, `previous_response_id`, `context_management`,
  `prompt_cache_key`, `reasoning` and flat function tools (L475). Tool rounds
  inside a turn chain with `previous_response_id` even when `store` is false,
  and replay by hand only after the provider rejects the cursor
  (`app/chat/direct_turn/model_stream.py` L870). Reasoning items are never
  replayed. `adapters/model_clients/openai_errors.py` classifies errors and
  redacts `Bearer`, `sk-` and `hf_` shapes, but not a bare JWT.
- **Behavior keyed by provider type.** The client registry
  (`server/model_clients.py` L43), the chat-row cursor (`provider_state.py`
  L294, `app/services/chat_manager.py` L69), inline moderation
  (`provider_state.py` L218), native compaction
  (`app/chat/direct_turn/constants.py` L18), hosted tools
  (`app/model_provider_native_tools.py` L14) and the API standard
  (`app/chat/api_standard.py` L32) switch on `provider_type`, not on the
  connection.
- **Other model users.** Titles and compaction run through
  `app/services/direct_model_prompt_runner.py` on the Utility role. The Memory
  Manager on Responses rows uses the OpenAI Agents SDK
  (`adapters/memory_manager/openai_agents_runtime.py`): not streamed,
  `store=True`, `previous_response_id`, native `apply_patch`. A Reflection is
  owner-started. Automatic episode processing (`server/episode_processing.py`)
  is the only model work the backend starts by itself; it reports
  `needs_model` when `server/memory_manager.py`
  `local_memory_manager_model_usable` (L126) is false.
- **Desktop shell.** Any `https` link the page opens goes to the system
  browser (`src/frontend/desktop/src/main-process/security/guards.ts`
  L154-169); there is no host list. The preload exposes status-only
  credentials.
- **Settings UI.**
  `src/frontend/web/src/ui/settings/models/ModelConnectionsSettings.tsx`
  renders a `ConnectionCard` per connection with `BuiltinKey` (L679) for its
  key; `model-configuration-state.ts` holds the provider tabs (L138) and
  status text. `ModelDefaultsSettings.tsx` renders the role pickers from
  `roleCandidates`. The chat picker is `ChatInputModelSelector`
  (`src/frontend/web/src/ui/components/chat-input.tsx` L400), and
  `src/frontend/web/src/ui/main/chat/ChatInterface.tsx` L413-547 lays out the
  composer with a `role="status"` line. First-run setup is
  `src/frontend/web/src/app/local-runtime/setup/SetupAiStep.tsx`. Chat
  failures map codes to text in
  `src/frontend/packages/product-ui/src/chat/chat-failure.ts` and can carry
  an `https` link button.
- **Localization.** Five locales. Model settings strings are in
  `src/frontend/web/src/locales/<locale>/models.json`. `pnpm i18n:check`
  enforces key and placeholder parity, and codes in `userVisibleCodes.json`
  need wording in every catalog.
- **Tests.** Backend fakes are `httpx.MockTransport`, `httpx2.MockTransport`
  and `_FakeOpenAIClient` (`tests/test_model_client_registry.py` L85). Stacks
  under test run `ANIMAMA_LLM_SKIP=1`, which registers `MockModelClient` for
  every provider type. Journeys intercept routes with Playwright.
- **Dependencies.** `openai` `3.39.0` has `NamespaceToolParam`, and its
  function-call items carry `namespace`. `pyjwt` `2.15.1` and `cryptography`
  `50.0.2` are locked as transitive dependencies; no backend module imports
  them. `openai-agents` `0.24.0` has `tool_namespace`, `run_streamed` and a
  `store` setting. The desktop bundle collects every `animama` submodule
  (`src/backend/packaging/desktop/animama-runtime.spec` L45).
- **Records.** `licenses/source-review.json` lists every tracked file; each
  phase adds entries for its new files.

OpenAI facts, read from the official documentation on 2026-11-24. The route
is a preview, so Phase 0 tried them against a live account. Where the trial
differed, "Live trial" under Surprises & Discoveries says how.

| Topic | Rule |
| --- | --- |
| Registration | The first sign-in sends `client_id=dynamic_agent_client`, `agent_name_hint` (the app's own name) and a stable `ext_agent_host_id`. The return carries the issued `client_id`, which later sign-ins reuse. There is no client secret. |
| Authorization | System browser to `https://auth.openai.com/api/accounts/authorize` with PKCE `S256`, `state`, `nonce`, `resource=https://api.openai.com/v1` and scopes `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`. |
| Return | An HTTP loopback URI on `127.0.0.1`, such as `http://127.0.0.1:<port>/auth/callback`. Only the port may vary later; `localhost` is not accepted. |
| Tokens | Code exchange and refresh at `https://auth.openai.com/api/accounts/oauth/token`. Access tokens last one hour. Refresh tokens last 30 days and are replaced on every refresh. The response carries `earliest_refresh_at`. |
| ID token | Validate the signature against OpenAI's JWKS, then issuer, audience (the issued client id), expiry and nonce. Plan use needs `chatgpt.tokens.use.direct` among the granted scopes. |
| Sign-out | Revoke the refresh token at the discovery document's `revocation_endpoint`, then clear tokens. Keep the client id and host id. |
| Models | `GET https://api.openai.com/v1/models` returns the account's `models[]` with `slug`, `display_name` and `visibility`. |
| Inference | `POST /v1/responses` only, with `store: false` and `stream: true`. A request succeeded only once `response.completed` arrives. |
| Rejected fields | `background`, `conversation`, `max_output_tokens`, `max_tool_calls`, `metadata`, `moderation`, `multi_agent`, `prompt`, `prompt_cache_retention`, `safety_identifier`, `temperature`, `top_logprobs`, `top_p`, `truncation`, `user`, `previous_response_id` over HTTP, and system-role input items. |
| Tools | Function and custom tools must be grouped in namespaces or supplied through `additional_tools` input items. Image generation, file search, Code Interpreter, computer use, hosted MCP and `tool_search` are unsupported. Web search depends on the model and account. |
| Inputs | Text, images and files where the model accepts them. No audio or video input, Files upload or transcription. |
| Errors | `subscription_sharing_usage_limit_exceeded` (429), `…_user_not_eligible` (403), `…_usage_unavailable` and `…_user_unavailable` (503), `…_unsupported_capability` (400), `…_route_not_supported` (403), `…_invalid_user` (401). Admission can fail before the stream with a bare `{"detail": …}` body. OpenAI never moves a request to another billing path. |
| Plans | The developer documentation names Plus and Pro. The end-user page names Go, Plus, Pro and Business, where a Business admin must allow the app. Free is on neither list. Usage draws on the plan's existing allowance. The Phase 0 trial confirmed sign-in and the route on a Go plan (the tier as the account holder stated it, 2026-11-24); Go's allowance was not reached. |
| Limits | The Plus five-hour limit is shared across every app. A person can cap one app's weekly share in ChatGPT's settings. |
| Interface | A one-time "You're using your ChatGPT plan" confirmation; **Continue with ChatGPT** to start; "Using ChatGPT plan" with **Manage usage** near the composer or model selector; **Manage usage** as the primary action at a limit. |
| Terms | Effective 2026-11-04: requests originate from the person's own runtime; tokens are stored locally under their control; express consent before background use; the plan serves only the connected app; no charge to use it; OpenAI may suspend access. |
| Remote hosts | A `127.0.0.1` return reaches the machine running the browser. OpenAI's guidance for a remote machine is to sign in locally and copy the credential file, which this plan does not build (spec P2). |

The namespace tool shape comes from the pinned SDK's types:

```text
{"type": "namespace", "name": …, "description": …,
 "tools": [{"type": "function", "name": …, "parameters": …}]}
```

## Threat model

Assets: the access token, the rotating refresh token, the retained ID token,
the desktop store key, the authorization code, and a pending attempt's `state`
and PKCE verifier. Boundaries: the system browser and the backend (the
sign-in return), the app page and the backend (`/v1`), the backend and
OpenAI, the backend and its disk, logs and child processes, and Electron main
and the backend.

| # | Threat | Mitigation | Negative tests |
| --- | --- | --- | --- |
| T1 | The sign-in return exemption admits requests the normal checks refuse. | The exemption covers exactly `GET /auth/callback` over HTTP, and only when the installation's origin is a loopback `http` origin. `Host` must equal `127.0.0.1:<public port>`. No `Origin` and no body. `Sec-Fetch-Mode`, when present, must be `navigate` and `Sec-Fetch-Dest` must be `document`. A request that misses any condition gets the normal checks, and every other path is unchanged. | Other methods, a WebSocket, a body, an `Origin`, `Host` `localhost:<port>`, another port or `evil.test`, subresource fetch metadata, a non-loopback public origin, `/auth/callback/x` and `/auth/other` are refused as today. On desktop `/v1` without the cookie is still 401. |
| T2 | Login CSRF or code injection: a page or local process drives the return with an attacker's code, or replays one. | One pending attempt at a time with a ten-minute life. A 256-bit `state` is compared in constant time and consumed once. The PKCE verifier and nonce never leave the backend. On reauthorization a returned client id must match the attempt. A wrong `state` neither completes nor cancels the pending attempt. | Missing, wrong, expired and reused `state`; a mismatched client id; a second return after success; an `access_denied` return. Each gets the fixed failure page and leaves the session unchanged. |
| T3 | A token, code or the store key leaks through logs, errors, URLs, API responses, diagnostics, the page or backups. | Tokens exist only in the session service and its file. Status responses carry state, email and scopes. Secret fields use `repr=False`. Provider error text passes a redactor that knows JWT shapes and the current token values. The return handler never logs or reflects its query and answers with a static page marked `no-store` and `no-referrer`. The authorize URL, which can carry an ID token hint, is never logged. Backup and restore skip the session directory. | A sentinel token and code appear in no response body, `caplog`, captured stderr, exception chain, database row, stream event or diagnostics summary, on success and on each failure path. G2 scans a packaged profile's logs. |
| T4 | A token is sent to the wrong host. | Access tokens go only to `https://api.openai.com`; refresh and ID tokens only to `https://auth.openai.com`. Both origins are constants, not settings, and ignore `OPENAI_BASE_URL`. Redirects are not followed. The plan client carries no organization, project or custom headers from the environment. | With `OPENAI_BASE_URL` set to another host the plan client still targets `api.openai.com`; a redirect response is an error; a discovery document that names another host for revocation is refused. |
| T5 | A rotated refresh token is lost or used twice. | One refresh at a time. The new token set is written atomically before any request uses it. `earliest_refresh_at` is respected. A terminal refresh error clears tokens and asks for sign-in; a transient one does not. | Concurrent requests near expiry cause one refresh; an interrupted write leaves the previous file intact; each terminal error code clears tokens; a network error keeps them. |
| T6 | Tokens at rest are readable by another user, or survive sign-out. | Directory mode 0700, file mode 0600, atomic replace, no symlink following. On desktop the file is AES-256-GCM ciphertext under a key that only the vault holds (D2). Sign-out revokes, then removes the token fields. A malformed or undecryptable file means signed out, and the file is removed. | File mode and symlink refusal; tampered ciphertext and a wrong key both mean signed out; sign-out leaves no token bytes on disk. |
| T7 | The plan is used for work the person did not agree to, or spend moves silently to another connection. | Every token request names its purpose. `background` is refused without recorded agreement and while a usage limit pauses the plan. No code path retries a plan request on another connection. | Automatic episode processing on a plan model without agreement makes no request; after a limit error a background request is refused until an interactive one succeeds; a failed plan turn sends nothing to any other connection. |
| T8 | The plan becomes a relay for other tools. | No route accepts a caller-supplied model request for the plan. Only the app's own features reach the plan client. | The inventory has no generic completion route; the status and preference routes accept fixed fields only. |

## Progress

- [x] Plan drafted on `feat/chatgpt-plan` from `origin/main` `1c7d7295e`.
- [x] G0: the owner approved this plan, including D1 to D14 (2026-11-24).
- [x] Workspace setup (2026-11-24): #919 published and read back, spec
  snapshot and plan tracked, branch fast-forwarded to `c7b98f73a`, Python
  dependencies installed. No stack started.
- [x] Phase 0: live trial of the route (2026-11-24). The probe was built and
  reviewed, and the trial ran on a live account: 24 of the 25 requests G1
  allows, then a sign-out that OpenAI confirmed. Findings are under
  Surprises & Discoveries; the choices they settle are in the Decision Log.
- [x] Phase 1: sign-in core (2026-11-24). Code Review #3 passed.
- [x] Phase 2: routes and the sign-in return (2026-11-24). Code Review #2
  passed.
- [ ] Phase 3: desktop custody.
- [ ] Phase 4: settings and setup.
- [ ] Phase 5: the plan connection and its model client.
- [ ] Phase 6: chat on plan models.
- [ ] Phase 7: roles, agreement and limits.
- [ ] Phase 8: documentation and records.
- [ ] Final integration review, G1 to G4, pull request.

## Surprises & Discoveries

- 2026-11-24 (planning): nothing is exempt from admission today, not even
  `/health`. The sign-in return is the first browser route that needs a
  different rule, so it gets its own threat model row (T1) and tests.
- 2026-11-24 (planning): OpenAI's documentation requires function tools
  inside a namespace, and a tool call then returns with its namespace. The
  live trial found flat tools accepted all the same (see Live trial).
- 2026-11-24 (planning): most of the Responses adapter's behavior that the
  route forbids is keyed by provider type: the stored cursor, inline
  moderation, native compaction and hosted tools. A separate provider type
  avoids each of them without a connection check in every place (D3).
- 2026-11-24 (planning): tool rounds inside one turn chain with
  `previous_response_id` even for unstored requests. On the plan route every
  tool round would fail once and retry, so the plan client replays by hand
  from the first round.
- 2026-11-24 (planning): the seed deactivates every `builtin` model row that
  the static catalog lacks, at every start. Rows synced from an account would
  be switched off on restart unless the seed skips the plan connection (D4).
- 2026-11-24 (planning): the Memory Manager's Responses runtime is not
  streamed and stores its responses. The route allows neither, so Phase 7
  gives that runtime a plan mode.
- 2026-11-24 (planning): a Reflection never runs by itself. Automatic episode
  processing is the only model work the backend starts unprompted (D5).
- 2026-11-24 (planning): nothing flows from the backend to Electron main, but
  a refresh replaces the refresh token about hourly while the plan is in use.
  Writing each new token into the vault would need a new channel (D2).
- 2026-11-24 (planning): `scripts/backup-local.sh` archives the whole data
  tree, so a session file there would enter backups unless excluded.
- 2026-11-24 (planning): an earlier packaged check found `uvicorn.access`
  lines in the desktop log although the access log is off. Phase 2 confirms
  that no log line can carry the return's query string.
- 2026-11-24 (planning): the OpenAI SDK retries a 429 by default. A usage
  limit must stop, so the plan client sets no SDK retries.
- 2026-11-24 (Phase 0): the OpenAI SDK's default HTTP client follows
  redirects, and the SDK adds organization, project and custom headers from
  the shell's environment. Phase 5's plan client must pass an HTTP client
  with redirects off and omit those headers (T4), as the probe's SDK trial
  now does.
- 2026-11-24 (Phase 0): OpenAI's guide gives the issuer and the signing-key
  location through its discovery document. The probe reads both from there
  and holds them to OpenAI's sign-in host; Phase 1 should do the same, before
  any code is exchanged.

### Live trial, 2026-11-24

The Phase 0 probe ran against a live account on model `gpt-6-luna`: one
sign-in, the model list, 24 route requests, one refresh and a sign-out that
OpenAI confirmed. The credentials file was deleted afterwards. Nothing below
identifies the account.

Sign-in, tokens and the model list:

| Subject | Observed |
| --- | --- |
| Registration | The first sign-in with `dynamic_agent_client` returned `client_id`, `code`, `iss`, `scope` and `state`. The discovery document matched the documented endpoints, and all six requested scopes were granted. |
| Token response | `access_token`, `refresh_token`, `id_token`, `token_type`, `expires_in` (3600), `scope` and `earliest_refresh_at`. |
| ID token | Signed with `RS256` and a key id. Claims: `iss`, `aud`, `sub`, `exp`, `iat`, `auth_time`, `nonce`, `at_hash`, `jti`, `sid`, `email`, `email_verified`, `name`, `given_name`, `family_name` and `https://api.openai.com/auth`. A refreshed ID token has no `nonce`. |
| Access and refresh tokens | The access token is a JWT of about 2,100 characters (`RS256`, type `at+jwt`), valid for one hour. The refresh token is opaque, about 200 characters, and its length varies. |
| Refresh | `earliest_refresh_at` is Unix seconds, 54 minutes after issue. A refresh sent about 50 minutes before that time was still accepted and replaced the refresh token. |
| Sign-out | The revocation endpoint answered 200. |
| Model list | `GET /v1/models` returned `models[]` with five items of 55 fields each. The useful ones: `slug`, `display_name`, `description`, `visibility` (`list` on three items, `hide` on two), `priority`, `context_window` (272,000 on every item), `max_context_window` (872,000), `input_modalities` (`text`, `image`), `supported_reasoning_levels` (`low` to `max`; one model adds `ultra`), `default_reasoning_level`, `supports_parallel_tool_calls`, `supports_search_tool`, `web_search_tool_type` and `apply_patch_tool_type` (`freeform`). |
| Model list, other content | The list is written for Codex, OpenAI's coding client. Each item carries that client's instructions and message templates (`base_instructions`, `model_messages`), tens of thousands of characters an item. `available_in_plans` names about 28 plans, `free` and `go` among them on four items. That field describes the model; the trial did not test which plans may use this route. |

Requests, each streamed and unstored:

| Request | Result |
| --- | --- |
| A plain prompt | Completed. The stream includes a `response.metadata` event that the pinned SDK does not type, and `usage` carries an `attribution` field. |
| `instructions` with a developer-role item | Accepted. |
| A system-role input item | 400 with the body `{"detail": "System messages are not allowed"}`. |
| A flat function tool | Accepted, although the documentation requires a namespace. The call has `name` and no `namespace`. |
| A function tool in a namespace | Accepted. The call keeps the tool's own `name` and carries `namespace` as a separate field. |
| An `additional_tools` developer item | Accepted. The call has no `namespace`. |
| `tool_choice: "auto"` with `parallel_tool_calls: false` | Accepted. |
| A tool round replayed by hand: the call with its `namespace`, then its output, with no cursor and no item ids | Accepted. |
| `reasoning.effort` at `low` and `high` | Accepted. |
| `include: ["reasoning.encrypted_content"]` | Accepted. No tool-calling request returned a reasoning item, at `low` or `high` effort, so no reasoning was replayed. The image request, which set neither field, returned a reasoning item with encrypted content. |
| `prompt_cache_key` | Accepted. |
| `text.format` with a strict JSON schema | Accepted and followed. |
| An image as a data URL | Accepted and read correctly. |
| `context_management` with a compaction entry | Admitted. The prompt was too short to compact, so compaction itself is untested. |
| Hosted `web_search` | A search ran: a `web_search_call` item, then a message. That response's terminal event carried no output items; they arrived only as `response.output_item.done` events. |
| Native `apply_patch` | 400 with the body `{"detail": "Unsupported tool type: apply_patch"}`. |
| `max_output_tokens` | Accepted, although the documentation lists it as rejected. Whether it is applied was not tested. |
| One request through the pinned SDK, with redirects off and no environment headers | Completed. |
| `/v1/embeddings` and `/v1/moderations` | 401 with an `error` object of type `rejected_by_access_enforcement` and code `no_matching_rule`, not the documented 403 `subscription_sharing_route_not_supported`. |

What this changes:

- `adapters/model_clients/openai_responses/final.py` reads the final items
  from the terminal event's `response.output`. On the hosted-search response
  that list was empty or absent; the probe cannot tell which. The plan
  client must fall back, in both cases, to the items it collected from
  `response.output_item.done` (Phase 5 step 5).
- The model list holds another product's prompts and is large. Model sync
  keeps a few fields of the `list` items and never logs the response (Phase 5
  step 3).
- The catalog gives `gpt-6-luna` a 1,050,000-token window, and the plan's
  list gives the same slug 272,000. A plan row uses the list's figure, so one
  model has a smaller window on the plan than on a key.
- A refused route answers 401. The trial never sent an expired or revoked
  token, so it does not show how that 401 differs. Phase 5 step 7 keeps
  its rule for every 401: one refresh and one retry.
- No request produced a `subscription_sharing_*` error, so Phase 5's
  mapping of those codes rests on the documentation.
- `earliest_refresh_at` is a number, not a date string, and a refreshed ID
  token has no `nonce` (Phase 1).
- The route accepts two things the documentation says it refuses: flat
  function tools and `max_output_tokens`. The plan client follows the
  documentation, because a preview route may start enforcing it.
- Reasoning replay is unproven. The route returns encrypted reasoning, but
  no trial request returned it beside a tool call.

## Decision Log

- 2026-11-24, owner: the spec is accepted as written, including P1 to P8. The
  sign-in has its own spec, is delivered before content generation uses it,
  uses the direct sign-in and serves local compositions only.
- 2026-11-03, owner (standing instruction, recorded during #823): phases run
  the checks their changes affect, not the full pre-push suite. The full suite
  runs once on the final candidate after the owner agrees to the run (G3).
- 2026-11-24, owner: plan approved with D1 to D14 as proposed (G0). The
  spec's R2.1, R4.1, R4.2 and one acceptance line were revised the same day
  to match D2, D5 and D6.
- 2026-11-24, owner: workspace setup and Phase 0 authorized.
- 2026-11-24, agent proposals, approved by the owner at G0. D2 and D5 changed
  the wording of an accepted requirement. The rest are implementation choices
  inside the agreed behavior.
  - **D1. The backend owns the sign-in in both runtimes.** One Python
    implementation of registration, exchange, validation, refresh and
    revocation. Electron main only opens the browser, as it does for any link.
  - **D2. Desktop custody: an encrypted file under a vault key.** The vault
    gains one generated key. The backend writes the session as AES-256-GCM
    ciphertext in its data directory. Spec R2.1 said the tokens rest "in the
    desktop app's encrypted vault"; it now says they rest in a file encrypted
    with a key held in the vault. The literal alternative was a
    control route that Electron main polls so it can copy each refreshed
    token set into the vault. It needs a new channel in a boundary that is
    one-way today, moves tokens across loopback at every refresh, and loses
    the session if the app stops between OpenAI's answer and the vault write.
  - **D3. A separate provider type for plan models**, proposed name
    `ChatGPTPlanResponsesHTTPAgent`, mapped to the existing Responses API
    standard so a chat can move between key and plan models (R3.6). Its
    client reuses the Responses request, stream and result code through a
    route profile.
  - **D4. Account-listed models are read-only built-in rows.** Sign-in and
    refresh upsert one row per listed model under the plan connection, with
    ids `<provider type>:<slug>`. Rows are active only while signed in, and
    the seed leaves this connection's rows alone.
  - **D5. Agreement gates work that starts by itself.** That is automatic
    episode processing. A Reflection the person starts is their own action
    and needs none, like a chat title. Spec R4.1 listed "the Memory Manager"
    beside automatic episode processing; it and its acceptance line now name
    automatic episode processing only.
  - **D6. A plan-selected role that may not run does not run.** Without
    agreement, or while paused, the job waits. It does not move to another
    model, and spec R4.2 now says so.
  - **D7. Agreement and the one-time confirmation live with the session**,
    not in shared owner preferences, so they stay local, follow the account
    and are asked again after a different account signs in.
  - **D8. Web search.** OpenAI's hosted search is offered on a plan model
    only if Phase 0 shows the route accepts it. Otherwise a plan model gets
    the app's own web search like any other tool-calling model, and the
    control explains when neither is available (R3.5).
  - **D9. Context window.** Use the account list's own figure when it has
    one, else the catalog's entry for the same model id, else 128,000 tokens.
    Phase 0 records what the list contains.
  - **D10. The return page speaks the installation's language**, from a small
    backend table in the five locales, because the app page is not involved.
  - **D11. The probe script is committed** as developer tooling, so the
    preview route can be checked again when OpenAI changes it.
  - **D12. One branch and one pull request.** The content generation plan can
    start from this branch once Phase 5 passes review, or from `main` after
    the merge.
  - **D13. `pyjwt[crypto]` becomes a declared dependency.** It and
    `cryptography` are already locked and installed; no new package enters
    the lock.
  - **D14. Sign-in is offered only when the installation's origin is a
    loopback `http` origin**, which is how the backend knows the return can
    reach it (spec P2). Anywhere else the app explains instead of starting.
- 2026-11-24, agent, from the Phase 0 trial (Phase 0 step 3). Each applies a
  rule the approved plan already set, and none changes agreed behavior.
  - **D8 settled: hosted web search is offered.** The route ran a hosted
    search. A plan row offers it when its list item has `supports_search_tool`
    true, and the app's own web search otherwise. Every listed item had
    it true, so the other branch is untried.
  - **D9 settled: the list's `context_window`.** Every item has one. A plan
    row uses it, not `max_context_window` and not the catalog's figure for
    the same slug. The fallbacks stay for an item without one.
  - **Compaction: the app's own.** The trial showed only that
    `context_management` is admitted, so plan rows do not send it. The plan's
    provider type stays out of the native-compaction set, and a chat fits its
    context to the row's window.
  - **Memory edits: the function form.** The route refuses native
    `apply_patch`, so no plan request declares it, in chat or in the Memory
    Manager.
  - **Reasoning replay: built, and on only once confirmed.** The route
    returns encrypted reasoning, but no trial response held a reasoning
    item beside a tool call, so its answer to a replayed one is unknown.
    The route profile gets a switch for requesting and replaying
    reasoning. It ships off, and the client then replays calls and outputs
    only, as the adapter's hand replay does today. The switch turns on in
    this plan only if Phase 5's manual check shows the route accepting a
    replayed reasoning item. It is a setting in the code, not a retry at
    run time.
  - **Tools stay in a namespace.** Flat function tools were accepted, against
    the documentation. The client still wraps them, so later enforcement
    does not break it. A tool's `name` comes back unchanged with `namespace`
    beside it, and a replayed call keeps both.
  - **Synced rows.** Only items with `visibility` `list` become rows. A row
    takes `slug`, `display_name`, `context_window`, `input_modalities`,
    `supports_search_tool` (as its hosted-search support) and the
    `supported_reasoning_levels` the app already knows. Nothing else from
    the list is stored or logged.

## Phased implementation

Each phase starts from the previous phase's commit and writes its tests first.
Phase 0's findings can change later steps; a finding that changes agreed
behavior goes to the owner before the phase it affects. Phase 3 needs Phase 1.
Phase 4 needs Phase 2. Phase 5 needs Phases 0 and 1. Phase 6 needs Phase 5.
Phase 7 needs Phases 5 and 6. Phase 8 is last.

Module names below are proposals; the implementing agent may adjust them
within the repository's layering (domain, application services and ports,
adapters, server composition).

### Workspace setup

After G0, in worktree `chatgpt-plan`:

1. Merge `origin/main` if it moved. Run `uv sync --python 3.12.13 --extra
   voice --extra viz --extra realtime --extra encrypt --extra documents
   --all-packages --group dev`. Before the frontend phases run `pnpm install`
   in `src/frontend`, and run `git lfs pull` before backend content tests.
2. Publish the spec as the parent issue with the parent form's sections, read
   it back, and record the issue and its capture time in the spec file and at
   the top of this plan. Apply the type and triage labels the repository
   defines, after checking they exist.
3. Commit the spec snapshot and this plan as the plan's first commit.

### Phase 0: Live trial of the route

Review tier: standard. The probe is developer tooling, not product code, but
it handles real tokens, so the review reads its secret handling closely.

Requirements: spec checks C1 and C2. Informs D3, D4, D8 and D9.

Gate: G1 before any request.

Steps:

1. Add `scripts/chatgpt_plan_probe.py`, one file using `httpx`, `jwt` and
   `openai` from the project environment, with subcommands `sign-in`,
   `models`, `requests`, `refresh` and `sign-out`. It listens on `127.0.0.1`
   for its own `/auth/callback`. Its credential file path is a required
   argument; the probe creates it with mode 0600 and refuses a path inside a
   Git work tree. It prints field names, shapes and statuses, never token
   values.
2. Record these findings under Surprises & Discoveries, with no account
   identifiers:
   - the ID token's signing algorithm and claims;
   - the fields of a `/v1/models` item;
   - whether the route accepts a flat function tool, a namespace tool and an
     `additional_tools` item, and how a call names its tool;
   - image input, `reasoning.effort`, `prompt_cache_key`, `text.format`,
     `tool_choice` and `parallel_tool_calls`;
   - `context_management`, `web_search` and `apply_patch`;
   - `include: ["reasoning.encrypted_content"]` and replay of the returned
     reasoning item in a second request;
   - the error body for a rejected field and for a wrong route;
   - the refresh response's fields, and revocation.
3. Decide D8, D9, the compaction path, native `apply_patch` and reasoning
   replay from that evidence, and update Phases 5 to 7 where a finding
   changes them.

Checks: `uv run ruff check scripts/chatgpt_plan_probe.py`;
`python3 scripts/public-release/check_source.py`.

Completion: the findings are recorded, and no token is in the repository,
this plan or the shell history.

Recovery: `sign-out` revokes the session, the credential file can be deleted,
and the app can be disconnected in ChatGPT's settings.

Step 1 was built on 2026-11-24, starting from `4bb966a02`: the probe, and
`tests/test_chatgpt_plan_probe.py`, which runs it against a fake OpenAI. The
`requests` command has 20 named trials and sends at most 23 requests, inside
G1's bound.

To run the trial, from the worktree root, with a credentials path outside any
Git work tree:

```bash
uv run python scripts/chatgpt_plan_probe.py sign-in --credentials PATH
uv run python scripts/chatgpt_plan_probe.py models --credentials PATH
uv run python scripts/chatgpt_plan_probe.py requests --credentials PATH --model SLUG
uv run python scripts/chatgpt_plan_probe.py refresh --credentials PATH
uv run python scripts/chatgpt_plan_probe.py sign-out --credentials PATH --delete
```

Check record, from the worktree root, on working tree
`2eb7250394c5bd0e26232f27191b031fe7e6fce0`:

| Check | Result |
| --- | --- |
| `uv run pytest -q tests/test_chatgpt_plan_probe.py -p no:cacheprovider` | 35 passed |
| `uv run ruff check` | All checks passed |
| `uv run ruff format --check src/backend/animama tests` | 908 files already formatted |
| `uv run mypy tests/test_chatgpt_plan_probe.py scripts/chatgpt_plan_probe.py` | No issues in 2 files |
| `python3 scripts/public-release/check_source.py` | Every tracked file covered once |
| `uv run python scripts/chatgpt_plan_probe.py requests --credentials /nonexistent/plan.json --list` | 20 trial names, exit 0 |
| Guard removal: 19 temporary mutations of the probe, restored byte-identical | Each made the test file fail |

Not run at that point: the full pre-push suite, and the live trial (G1).
Commits: `4bb966a02` (the plan) and `152db15a4` (the probe).

#### Code Review #1 Findings

Independent review, standard tier, of working tree
`432d9157b8bc4dbbea101326e53969eb16871363` against baseline `4bb966a02`. The
reviewer reused the recorded lint, format, source and guard-removal results
and reran mypy and the tests. Result: blocked by F1 to F3.

| ID | Kind | Finding |
| --- | --- | --- |
| P0-R1-F1 | Required | `requests` built its redactor before a possible token refresh, so a refreshed token echoed in provider text could print in clear. |
| P0-R1-F2 | Required | The SDK trial used the SDK's default HTTP client, which follows redirects, against T4. It also picked up organization and project headers from the shell. |
| P0-R1-F3 | Required | The `web_search` and `apply_patch` trials used a prompt that calls neither tool, so a pass showed only that the declaration was admitted. `context_management` had the same limit. |
| P0-R1-F4 | Optional | `plan_use_granted` could be wrong when the token response omits `scope`. |
| P0-R1-F5 | Optional | Items were read only from the terminal event, so items delivered only as stream events would look like "no tool call". |
| P0-R1-F6 | Optional | ID-token checks relied on an assumed key location and issuer, and ran after the code was spent, with nothing printed on failure. |
| P0-R1-F7 | Optional | The client id, the subject and raw model metadata could reach output described as safe to paste. |
| P0-R1-F8 | Optional | `sign-out` could fail with tokens still on disk without saying so, and treated two failure paths differently. |
| P0-R1-F9 | Optional | An idle connection could hold the listener past its timeout. |
| P0-R1-F10 | Optional | A busy port and a non-ASCII `state` produced tracebacks; one lost connection aborted the whole `requests` run. |
| P0-R1-F11 | Optional | `refresh` did not show whether it ran before the saved `earliest_refresh_at`. |
| P0-R1-F12 | Optional | No test covered the free-text guard, the algorithm allow-list, a token signed by another key or an interrupted write; the listener test honoured proxy variables. |

#### Code Review #1 Revisions

Every finding was verified against the code and accepted. Each fix has a test
that fails without it.

| ID | Fix |
| --- | --- |
| P0-R1-F1 | The redactor reads the record at every call and remembers earlier values. |
| P0-R1-F2 | The SDK trial passes an HTTP client with redirects off, omits the organization and project headers, and skips itself when `OPENAI_CUSTOM_HEADERS` is set. |
| P0-R1-F3 | `web_search` asks for a search and says how to read the result. `apply_patch` asks for a file and replays the call with its output. `context_management` is labelled admission only. |
| P0-R1-F4 | Scopes come from the token response, else the access token's claim, else "not reported"; a stale saved list is removed. |
| P0-R1-F5 | Items are also collected from `response.output_item.done`, and the event types and the item source are printed. |
| P0-R1-F6 | Discovery is read before the browser opens. The issuer and key location come from it and must be on OpenAI's sign-in host. A failed check revokes the new session and prints the ID token's shape. |
| P0-R1-F7 | The subject and client id are redacted, the client id prefix is not echoed without an underscore, and the docstring says to read model metadata before pasting it. |
| P0-R1-F8 | Tokens are removed only once OpenAI confirms or there is nothing to revoke. The command exits 1 and says whether tokens were kept or the file was deleted. |
| P0-R1-F9 | The listener's handler has a five-second socket timeout. |
| P0-R1-F10 | A busy port is a plain error, `state` and nonce are compared as bytes, and a lost connection no longer stops the run. |
| P0-R1-F11 | `refresh` prints when it ran and the previous `earliest_refresh_at`. |
| P0-R1-F12 | Tests added for each gap, and the listener test ignores proxy variables. |

Verified by the check record of that round on working tree
`b2158425e9941bab3af3f71133b9c218c16f3792` (34 tests, 16 guard removals).
Remaining repair budget: one round.

#### Code Review #2 Findings

Targeted recheck of working tree `b2158425e9941bab3af3f71133b9c218c16f3792`,
reusing the round's check record. The reviewer also drove every command end
to end against the test fake. Result: pass. F1 to F12 are resolved, with no
blocking regression. Two notes on the repairs, neither blocking:

| ID | Kind | Finding |
| --- | --- | --- |
| P0-R2-F1 | Optional | When a round trip's follow-up lost its connection, the first result was dropped and the request count was one short. A skipped SDK trial was counted as sent. |
| P0-R2-F2 | Optional | A refused tool request carried the note "the model made no tool call". |

#### Code Review #2 Revisions

Both accepted. A lost connection now becomes that request's own result, so
earlier results stay and the count is exact; a skipped trial is not counted;
the note is set only when the request completed. Each has a test that fails
without it. These are small repairs below the high-risk tier, verified by the
implementing agent with the check record above and not rechecked by the
reviewer. Remaining repair budget: one round, unused.

#### Trial record

Steps 2 and 3 ran on 2026-11-24, starting from `152db15a4`. The account holder
signed in in their own browser; the agent ran the commands and saw only the
probe's redacted output. In order: `sign-in`, `models`, `requests --model
gpt-6-luna` (22 requests), `requests --only reasoning_replay` (2 requests),
`refresh` and `sign-out --delete`, which OpenAI confirmed. The saved outputs
hold no JWT-shaped text, no command took a token as an argument, and the
credentials file and its directory are gone. One request of G1's 25 was left
unspent.

The first run's reasoning trial returned no reasoning item, so the probe
changed before the two-request rerun: that trial now asks for `high` effort on
a prompt with a sum to work out, and says when nothing was replayed. It still
returned none. The rerun, the refresh and the sign-out ran with that change
applied and not yet committed. Two more changes followed what the trial
showed: the `models` command prints a length in place of any text over 200
characters, since each item carries tens of thousands of characters of another
product's prompts, and the test fake gives `earliest_refresh_at` as Unix
seconds. Three tests cover the changes, and each failed before its change.

Findings are under "Live trial" in Surprises & Discoveries, and the choices
of step 3 are in the Decision Log. Phases 1, 5, 6 and 7 were updated where a
finding changed a step.

Check record, from the worktree root, on working tree
`a40da151310fe7e2206c50ae8d018f9d6fd7229a` (hashed while this line still
held a placeholder for the tree name):

| Check | Result |
| --- | --- |
| `uv run pytest -q tests/test_chatgpt_plan_probe.py -p no:cacheprovider` | 37 passed |
| `uv run ruff check` | All checks passed |
| `uv run ruff format --check src/backend/animama tests scripts/chatgpt_plan_probe.py` | 909 files already formatted |
| `uv run mypy tests/test_chatgpt_plan_probe.py scripts/chatgpt_plan_probe.py` | No issues in 2 files |
| `python3 scripts/public-release/check_source.py` | Every tracked file covered once |

Not run: the full pre-push suite (G3).

#### Code Review #3 Findings

Targeted review, the last in this phase's budget, of the working tree above
against baseline `152db15a4`: the trial findings against the probe's raw
output, the decisions, the edits to later phases, the probe changes made
after the trial, and the two round-2 repairs no reviewer had rechecked. The
reviewer reused the check record and ran the tests on scratch copies with
guards removed. Result: blocked by F1 to F3, all plan wording. The probe and
test changes passed, the round-2 repairs hold, and the public record holds
no secret, identifier or personal data.

| ID | Kind | Finding |
| --- | --- | --- |
| P0-R3-F1 | Required | Phase 5 step 7 exempted a 401 of type `rejected_by_access_enforcement` from the refresh and retry. The trial saw that type only on refused routes and never sent an expired or revoked token, so the exemption could hide a required sign-in. |
| P0-R3-F2 | Required | D8 keys hosted search on `supports_search_tool`, but "Synced rows" left that field out and said nothing else is stored. |
| P0-R3-F3 | Required | The reasoning-replay confirmation could not run as written. It called an image with a tool the shape that returned a reasoning item, but the image request declared no tool, and the product cannot send an image at Phase 5. Nothing said what ships if the check confirms nothing, or whether the fallback is a retry or a setting. |
| P0-R3-F4 | Optional | No test asserted that the "none was replayed" note is absent when reasoning was replayed. |
| P0-R3-F5 | Optional | The probe's docstring still said `models` prints metadata as returned. |
| P0-R3-F6 | Optional | The Agents SDK replays output items with their ids, and reasoning items, which Phase 0 did not try. Phase 7 step 2 did not say so. |
| P0-R3-F7 | Optional | Precision: the size of the list's prompts; "empty" where the probe cannot tell empty from absent; which source the later commands ran from; that no `subscription_sharing_*` code was observed; T5 against the forced refresh. |
| P0-R3-F8 | Optional | The test fake's refresh time was the literal value from the live response. |

#### Code Review #3 Revisions

All eight accepted.

| ID | Change |
| --- | --- |
| P0-R3-F1 | The exemption is removed. Step 7 keeps one refresh and one retry for every 401, and the findings say what the trial did not observe. |
| P0-R3-F2 | "Synced rows" takes `supports_search_tool` as the row's hosted-search support. D8 notes that every listed item had it true. |
| P0-R3-F3 | Reasoning replay sits behind a route-profile switch that ships off, which leaves today's replay of calls and outputs. Phase 5's manual check runs the probe's `reasoning_replay` trial on each listed model, and the switch turns on only if the route accepts a replayed item. Step 6 says which items carry ids. |
| P0-R3-F4 | The trials test asserts the note is empty when reasoning was replayed. Dropping the condition now fails it. |
| P0-R3-F5 | The docstring describes the shortened output. |
| P0-R3-F6 | Phase 7 step 2 names the difference and points its capture test and manual check at it. |
| P0-R3-F7 | Each point is reworded in "Live trial", the trial record and Phase 1. |
| P0-R3-F8 | The fake uses a made-up time. |

F1 to F3 and F5 to F7 are wording, and F4 and F8 are one line each in the test
file. The budget holds no further review, so the implementing agent verified
them, as the review policy allows below the high-risk tier, and no reviewer
has rechecked them. After the repairs, on working tree
`ca21f873704c52e73bfbcbaa4591fb9cb9658eb6` (hashed while this line still held
a placeholder): the probe's tests, 37 passed; `uv run ruff check`, passed; the
format check, 909 files already formatted; mypy on the two files, no issues;
`check_source.py`, every tracked file covered once. With the note's condition
dropped in a scratch copy of the probe, the trials test fails. The trial
record and these repairs are the commit that carries this section.

### Phase 1: Sign-in core

Review tier: high risk (authentication, secrets at rest, concurrency, a
dependency declaration).

Requirements: R1.2, R1.4, R1.5 (sign-out), R1.6, R2.1 (self-host), R2.2,
R2.3. Threats T2 to T6.

Steps, tests first in `tests/test_chatgpt_plan_identity.py`,
`tests/test_chatgpt_plan_store.py` and `tests/test_chatgpt_plan_session.py`:

1. `pyproject.toml`: declare `pyjwt[crypto]>=2.15.1,<3` and run `uv lock`.
   The lock should change only its metadata.
2. `domain/chatgpt_plan.py`: the account, the session record and its states,
   with secret fields marked `repr=False`.
3. `adapters/chatgpt_plan/openai_identity.py`: an `httpx` client with an
   injectable transport, fixed OpenAI origins (T4) and no redirects. It
   builds the authorize URL (PKCE, `state`, `nonce`, hints for a returning
   account, `prompt=consent` when the person enables plan use later),
   exchanges a code, refreshes, revokes, and validates an ID token against a
   cached JWKS that is fetched again for an unknown key id.
4. `adapters/chatgpt_plan/session_store.py`: the record at
   `<data root>/internal/chatgpt-plan/`, written with the `persist` pattern
   (directory 0700, file 0600, no symlinks). With a key it writes
   AES-256-GCM ciphertext (`session.bin`); without one, JSON
   (`session.json`). The record holds a schema version, the host id
   (`urn:uuid:` version 4, created once and kept), and per account the issued
   client id, email, scopes, tokens, expiry, `earliest_refresh_at`, the
   retained ID token, the confirmation time and the background choice.
5. `app/services/chatgpt_plan_session.py`: status; `begin` (one pending
   attempt, ten minutes); `complete` (T2); `cancel`; `access_token(purpose)`
   with a single-flight refresh that writes before use (T5) and refreshes
   inside the last five minutes; the usage-limit pause; `sign_out`, which
   revokes, clears tokens and reports whether OpenAI confirmed. One account
   is active, and a new one replaces it only after validation (R1.6). A
   malformed or undecryptable record means signed out.
6. `scripts/backup-local.sh` and `scripts/restore-local.sh`: add
   `./internal/chatgpt-plan` to both exclude lists, so a backup never holds
   the session and a restore never extracts one. A restore replaces the data
   tree, so it leaves the installation signed out; Phase 8 documents that.

From the Phase 0 trial: `earliest_refresh_at` arrives as Unix seconds. A
refreshed ID token has no `nonce`, so the nonce is checked at sign-in only.
The ID token also carries the person's name, which the status does not
report. A refresh sent before `earliest_refresh_at` was accepted, so the
forced refresh after a 401 (Phase 5 step 7) may run early; scheduled
refreshes still wait for that time (T5).

Checks: the three test files; `uv run ruff check`; `uv lock --check`;
`bash -n scripts/backup-local.sh scripts/restore-local.sh`. Not run in this
phase: the full pre-push suite.

Completion: against a fake OpenAI, a sign-in completes, survives a restart,
refreshes once under concurrent use and signs out, and every negative test in
T2 to T6 that needs no HTTP route passes.

Recovery: the record is one directory. Removing it signs the installation
out at the next start (a running server keeps the record it read), and
nothing else refers to it.

As built (2026-11-24, from `55e4a8c94`): `domain/chatgpt_plan.py` (record,
status, purposes and error codes); `app/ports/chatgpt_plan_port.py` (the
identity and store ports); `adapters/chatgpt_plan/openai_identity.py` and
`session_store.py`; `app/services/chatgpt_plan_session.py`; and
`tests/chatgpt_plan_fakes.py`, a fake of OpenAI's sign-in service that signs
real ES256 ID tokens and plays the browser. Choices made while building:

- The authorize URL sends `login_hint` for a returning account and no ID token
  hint: the trial never tried an expired one, and a refusal would block
  sign-in.
- Only OpenAI's own OAuth refusal removes the tokens: a 400, 401 or 403 whose
  JSON `error` is `invalid_grant`, `invalid_client` or `unauthorized_client`.
  Anything else, including a proxy or bot-check page, keeps them (R2.3). On a
  refresh the last two also drop the stored client id, so the next sign-in
  registers again. A client id refused at authorization or at code exchange
  is not dropped; G1 checks how OpenAI answers then.
- After OpenAI could not be reached for a refresh, no other refresh is tried
  for 30 seconds; inside the five-minute margin the still-valid token is used
  meanwhile. A failed save never hands out a token.
- Sign-out always removes the tokens and reports whether OpenAI confirmed the
  revocation; an account whose tokens were already rejected has nothing to
  revoke.
- A sign-in by another account revokes the replaced session's refresh token
  after the new record is saved. The same account's earlier grant is left to
  expire, since revoking it might also end the new one; G1 can check that.
- If saving a refreshed token set fails, its access token is not used and the
  caller gets `temporarily_unavailable`; OpenAI has already rotated the
  refresh token, so the next refresh asks for sign-in.
- The usage-limit pause is kept in memory; a restart counts as a new try.
- The identity client honours proxy settings, as the OpenAI SDK does; the
  hosts stay fixed.
- A storage error while reading or writing the session surfaces as
  `temporarily_unavailable` and changes nothing; only a link, a non-file or
  bytes that do not decode are discarded.
- `cryptography` is declared beside `pyjwt[crypto]`, since the session store
  imports it; the lock changed only its metadata. The `encrypt` extra stays so
  existing commands resolve.
- A restore also skips `./internal/chatgpt-plan` when it extracts, in
  `scripts/local-stack-state-common.sh`, so an older archive cannot bring
  tokens back.

Check record, from the worktree root, on working tree
`5d86e7d02243300cef41b924f62b4e097efd4390` (hashed while this line still held
a placeholder):

| Check | Result |
| --- | --- |
| `uv run pytest -q tests/test_chatgpt_plan_store.py tests/test_chatgpt_plan_identity.py tests/test_chatgpt_plan_session.py tests/test_local_state_scripts.py -p no:cacheprovider` | 78 passed |
| `uv run ruff check` | All checks passed |
| `uv run ruff format --check src/backend/animama tests` | 918 files already formatted |
| `python3 scripts/heavy-slot.py -- uv run mypy src/backend/animama tests` | No issues in 918 files |
| `uv lock --check` | Resolved, unchanged |
| `bash -n scripts/backup-local.sh scripts/restore-local.sh scripts/local-stack-state-common.sh` | OK |
| `uv run --no-sync python scripts/repository-boundary/check-python-imports.py` | 0 forbidden edges |
| `python3 scripts/public-release/check_source.py` | Every tracked file covered once |
| Extraction with `--exclude='./internal/chatgpt-plan'`, macOS bsdtar and Alpine GNU tar | The session directory is skipped |

Not run: the full pre-push suite (G3).

#### Code Review #1 Findings

Independent review, high-risk tier, of working tree
`7ff9a78a30f6a2794807ffd6e3c1ae758636c8a1` against `55e4a8c94`. The
reviewer reran the record's checks and ran guard-removal experiments on a
scratch copy. Result: blocked by F1 to F5. Layering, reuse of the file
helpers, AES-GCM use, `repr` hygiene, host pinning, state handling and the
backup and restore exclusions were found correct.

| ID | Kind | Finding |
| --- | --- | --- |
| P1-R1-F1 | Required | The first read of the record could finish after a refresh had saved new tokens and overwrite them in memory, losing the rotated refresh token; on a fresh install it could change the host id between the authorize URL and the file. |
| P1-R1-F2 | Required | Any error opening the file (too many open files, permission, I/O) deleted a valid session. |
| P1-R1-F3 | Required | Rejection was decided by status code alone, so a proxy or bot-check 403, or a 404 during a deploy, ended a valid session. |
| P1-R1-F4 | Required | A failed refresh was not shared: every waiting caller refreshed again, discarding a still-valid token and retrying a 429 at once. |
| P1-R1-F5 | Required | No test covered write-before-use: setting the record before saving passed every test. |
| P1-R1-F6 | Optional | `sign_in_pending` read false while a return was being completed. |
| P1-R1-F7 | Optional | A same-account sign-in revoked the earlier grant, which might also end the new one. |
| P1-R1-F8 | Optional | Nothing recovered from a client id OpenAI no longer accepts. |
| P1-R1-F9 | Optional | A crash during a write could leave a temporary file with plaintext tokens that was never swept. |
| P1-R1-F10 | Optional | Raw `OSError` escaped several service methods. |
| P1-R1-F11 | Optional | Untested guards: an existing directory's mode, registration without a client id, revocation when the sign-in save fails, sign-out ending a pending attempt, a refreshed ID token for another subject, 408 as temporary. |
| P1-R1-F12 | Optional | Proxy settings were ignored by the identity client. |
| P1-R1-F13 | Optional | An unexpected purpose was treated as interactive. |
| P1-R1-F14 | Optional | Recovery wording, and packaging of `jwt` and `cryptography` (G2). |

#### Code Review #1 Revisions

All accepted except F14's packaging note, which G2 covers as planned.

| ID | Change |
| --- | --- |
| P1-R1-F1 | The first read assigns the record only if none was set while it waited. |
| P1-R1-F2 | Only a link (`ELOOP`) is discarded at open; other errors propagate, the service reports `temporarily_unavailable`, and the next call reads again. |
| P1-R1-F3 | Rejection needs a 400, 401 or 403 with an OAuth `error` of `invalid_grant`, `invalid_client` or `unauthorized_client`. |
| P1-R1-F4 | A temporary failure sets a 30-second backoff checked before any refresh; a caller whose token is still valid gets it. |
| P1-R1-F5 | A test shows the unsaved set is never handed out: the next call is refused with `sign_in_required`. |
| P1-R1-F6 | The attempt is cleared in `finally`, so status stays pending until completion ends. |
| P1-R1-F7 | Only another account's grant is revoked. |
| P1-R1-F8 | `invalid_client` and `unauthorized_client` drop the stored client id. Narrowed in round 2. |
| P1-R1-F9 | Every write sweeps `.session.*.tmp` files. Narrowed in round 2. |
| P1-R1-F10 | Storage errors become `temporarily_unavailable`. |
| P1-R1-F11 | Tests added for each. |
| P1-R1-F12 | Proxy settings are honoured unless a test transport is injected. |
| P1-R1-F13 | Any purpose other than `interactive` follows the background rule. |
| P1-R1-F14 | The Recovery line says a running server keeps its record until restart. |

Each new guard was removed in turn and a test failed, except a backoff check
in the refresh-due test, which duplicated the one in the refresh itself and
was removed. After the repairs: the four test files, 98 passed; `uv run ruff
check`, passed; the format check, 918 files already formatted; mypy on the
ten Phase 1 modules and tests, no issues.

#### Code Review #2 Findings

Targeted recheck of working tree `29fa8bedc4c309c442c31571cddeef3faea7464a`.
F1 to F7 and F10 to F14 were resolved; two repairs regressed. Result:
blocked.

| ID | Kind | Finding |
| --- | --- | --- |
| P1-R2-F1 | Required | The sweep on read could remove the temporary file of a save running at the same time, so the save failed after OpenAI had rotated the refresh token. |
| P1-R2-F2 | Required | Dropping the client id when a code exchange refused it left a signed-in account that could neither refresh nor be revoked. No test covered that path. |
| P1-R2-F3 | Optional | The stale-token fallback could hand out a rejected session's token when saving its removal also failed. |
| P1-R2-F4 | Optional | One assertion in the unsaved-token test could never fail. |
| P1-R2-F5 | Optional | A client id refused at authorization or in the return is still kept: a G1 check. |

#### Code Review #2 Revisions

All accepted.

| ID | Change |
| --- | --- |
| P1-R2-F1 | Only a save sweeps; the store test now expects a read to leave a leftover and the next save to remove it. |
| P1-R2-F2 | The exchange path no longer drops the client id; only a refused refresh does, together with the tokens. |
| P1-R2-F3 | The fallback applies only while the backoff set by an unreachable OpenAI is running, with a test. |
| P1-R2-F4 | The assertion reads the session file's bytes. |
| P1-R2-F5 | Recorded in the As-built notes as a G1 check. |

Removing each round-2 guard fails a test. After the repairs: the four test
files, 99 passed; `uv run ruff check`, passed; the format check, 918 files
already formatted; mypy on the ten modules and tests, no issues.

#### Code Review #3 Findings

Final targeted recheck of working tree
`314b2cdb72791a1c4acd4d7ef8c0dc4fcb1678fd`. The reviewer reran the tests,
lint, mypy and the import-boundary check, replayed its race and failure
experiments, and removed each round-2 guard. Result: pass, with no finding.
The phase's review budget is spent.

### Phase 2: Routes and the sign-in return

Review tier: high risk (the admission boundary, the API contract, the
generated client).

Requirements: R1.1 (API), R1.4, R1.5, R1.7. Threats T1 to T3 and T8.

Steps, tests first in `tests/test_local_http_admission.py`,
`tests/test_chatgpt_plan_api.py`, `tests/test_product_http_inventory.py`,
`tests/test_runtime_capabilities.py` and
`src/frontend/web/tests/local-api-proxy.test.ts`:

1. `local/http/config.py`: `LocalHTTPConfig` gains the sign-in return path
   and derives its authority, `127.0.0.1:<port>`, only when the public origin
   is `http` on `localhost` or `127.0.0.1` (D14). `server/local_http.py` sets
   the path.
2. `local/http/admission.py`: admit the return as T1 describes, tested before
   the `Host` rule and only for the exact path. A request that misses a
   condition falls through to the existing checks. `lifecycle.admit` still
   applies.
3. `local/http/assets.py`: add `/auth` to `_NO_FALLBACK_PREFIXES`, so no
   `/auth/*` path returns the app shell.
4. `server/routers/chatgpt_plan.py`, included in `create_local_app` after the
   model configuration router. Every `/v1` route depends on
   `get_current_principal`:
   - `GET /v1/chatgpt-plan`: state, whether sign-in is available and why not,
     the account's email, whether plan use is enabled, whether the
     confirmation is due, the background choice and the pause.
   - `POST /v1/chatgpt-plan/sign-in`: starts an attempt and returns the
     authorize URL; refused with a code when sign-in is unavailable.
   - `DELETE /v1/chatgpt-plan/sign-in`: cancels the attempt.
   - `POST /v1/chatgpt-plan:sign-out`.
   - `PUT /v1/chatgpt-plan/preferences`: records the confirmation and the
     background choice.
   - `GET /auth/callback`, outside the schema: completes the attempt and
     answers with the static page (D10, T3).
5. Keep the return out of OpenTelemetry instrumentation, and add a test that
   the server writes no log line containing the return's query.
6. `product_http/inventory.py`: `_excluded("chatgpt_plan", …)` rows for the
   `/v1` routes and a `_local` row for the return, in mount order. Add the
   `chatgpt_plan` capability (false by default, true locally, `false` in
   `hosted.json` and in the test's permission list), and refuse it in
   `hosted-composition.ts` with a test.
7. `local-api-proxy.ts`: forward `/auth/callback` and fence other `/auth/*`
   paths. Confirm Vite accepts `Host: 127.0.0.1:<port>`.
8. Raise `local-http` to the next major in `contracts/versions.json`, run
   `pnpm openapi-ts`, raise the runtime-contracts version and run
   `pnpm packages:build`.
9. Correct the two sentences this phase makes wrong: "Adding A Route" in
   `docs/backend/operations/development.md` and the proxied paths in
   `docs/frontend/architecture/auth-server.md`.

Checks: the test files; `uv run ruff check`; from `src/frontend`
`pnpm openapi-ts:check`, `pnpm check` and the proxy test; the package-set
`compare` against a `main` baseline. Start a task stack with
`./reset.sh --name chatgpt-plan --base-port <free port>` and send the T1
request variants to it with `curl`, in development and built mode.

Completion: a return with a valid `state` completes a sign-in against the
fake OpenAI in development, built and desktop configurations; every T1 and T2
variant is refused; the inventory and contract checks pass.

Recovery: the exemption is one branch in admission and one config field.
Removing the path from the config closes it.

As built (2026-11-24, from `024ebd0c2`): `server/routers/chatgpt_plan.py`
with the five `/v1` routes and the return; `server/chatgpt_plan.py`, which
decides availability and creates the session service on first use;
`server/chatgpt_plan_return_page.py`, the fixed page in five languages; and
`server/schemas/chatgpt_plan.py`. Choices made while building:

- The return authority is derived for `localhost`, `127.0.0.1` and any
  `*.localhost` name, all loopback (RFC 6761), so a named worktree stack
  (`http://animama-<name>.localhost:<port>`) can sign in too; `https`,
  `[::1]` and other hosts get no return. On port 80 the authority is the bare
  `127.0.0.1`, as browsers send it.
- A desktop composition without the vault key (Phase 3) reports
  `secure_storage_unavailable` and its service reads and writes no session
  file at all.
- Every route words an unavailable session as a code: 503
  `chatgpt_plan_temporarily_unavailable` while storage or OpenAI is down,
  otherwise 409 `chatgpt_plan_<code>`.
- Accepted exception to T3, development only: if FastAPI is down or
  restarting when the return arrives, Vite's proxy logs the request URL with
  its query. The code is useless without the PKCE verifier, which never
  leaves the backend's memory, and the attempt's state grants nothing alone.
- The return page uses the language sent with the latest sign-in start.
  Outcomes: signed in (200), declined, expired (also a return with no pending
  attempt) and failed (400). A repeated query field fails.
- A return whose `iss` names another issuer is refused before any exchange
  (RFC 9207).
- The capability is `chatgpt_plan`, a permission; `contracts/hosted-web.md`
  lists it. `local-http` is 24.0.0 and `runtime-contracts` 0.24.0.
- Tracing excludes `auth/callback` and keeps the operator's own exclusions.
- The stack check found uvicorn access lines, query included, in both
  development and built logs. `configure_logging` re-enabled the
  `uvicorn.access` logger that the launcher's `access_log=False` had turned
  off. It now has no handler and does not propagate; a test pins it. This was
  also the cause of the earlier packaged-build observation.

Check record, from the worktree root, on working tree
`42cce7af29e3d9ef8cf0b9f1f7efd9acb852103d` (hashed while this line still held
a placeholder):

| Check | Result |
| --- | --- |
| `uv run pytest -q` on the four Phase 1 test files, `test_chatgpt_plan_api.py`, `test_local_http_admission.py`, `test_product_http_inventory.py`, `test_runtime_capabilities.py`, `test_local_http_composition.py`, `test_local_http_wiring.py`, `test_local_app_composition.py`, `test_local_http_transport.py`, `test_desktop_credentials_route.py`, `test_local_http_telemetry.py` and `test_local_state_scripts.py` | 434 passed |
| `uv run ruff check`; `uv run ruff format --check src/backend/animama tests` | Passed; 923 files already formatted |
| `python3 scripts/heavy-slot.py -- uv run mypy src/backend/animama tests` | No issues in 923 files |
| `check-python-imports.py`; `check_source.py` | 0 forbidden edges; every tracked file covered once |
| From `src/frontend`: `pnpm openapi-ts:check` | Generated SDK is current |
| From `src/frontend`: `python3 ../../scripts/heavy-slot.py -- pnpm check` | No issues; every catalog complete |
| From `src/frontend`: `pnpm packages:build`, then vitest on `tests/local-api-proxy.test.ts` and `src/app/hosted-runtime/hosted-composition.test.ts` | 109 passed |
| Task stack, development then built mode: the return's variants with `curl` | Valid shape reaches the route (400 for a wrong `state`, attempt kept); Origin, page Host, other port, foreign host, image fetch, POST, body, `/auth/other`, `/auth/callback/x` and cross-site `/v1` refused (403, 404 or 421); return page headers as designed; no query in container or file logs after the logging fix |

Not run: the package-set `compare`, deferred to the final candidate so one
comparison covers this phase's `runtime-contracts` bump and Phase 6's
`product-ui` one; the full pre-push suite (G3).

#### Code Review #1 Findings

Independent review, high-risk tier, of working tree
`41a9ecdee4bb5da28619c55644025e3cea0307bf` against `024ebd0c2`; the
reviewer reran 691 tests across the affected files, lint, the boundary and
licence checks, the frontend checks, and removed guards one at a time on a
scratch copy. Result: blocked by F1 and F2, both test gaps. The exemption
was found exactly as narrow as T1, and the return page, logging fix,
inventory and hosted refusal sound.

| ID | Kind | Finding |
| --- | --- | --- |
| P2-R1-F1 | Required | The T1 tests did not pin the path, method, `Transfer-Encoding`, `Sec-Fetch-Mode` and `Sec-Fetch-Dest` guards: removing any one still passed, because the tests accepted the router's 404 or 405 or changed two headers at once. A WebSocket and desktop `/v1` without the cookie at the return authority were untested. |
| P2-R1-F2 | Required | The real wiring was untested: the return path in `local_http.py`, the keyless desktop store, the `/auth` asset fence and the schemas' fixed fields. |
| P2-R1-F3 | Optional | On port 80 the authority read `127.0.0.1:80`, which no browser sends. |
| P2-R1-F4 | Optional | Vite's proxy error log prints the request URL if FastAPI is down when the return arrives. |
| P2-R1-F5 | Optional | A session storage failure was a bare 500 on every route but preferences. |
| P2-R1-F6 | Optional | Wording: the hosted contract said the capability withholds the return; a stale logging comment; the tracing exclusion's wiring untested. |

#### Code Review #1 Revisions

All accepted; F4 as a recorded exception.

| ID | Change |
| --- | --- |
| P2-R1-F1 | The tests assert the exact refusal (421 self-hosted; 401 or 403 desktop) for other paths, methods and each fetch-metadata header alone, plus a chunked body, a WebSocket and desktop `/v1` without the cookie. The separate WebSocket check was removed: a WebSocket scope has no method, so the `GET` check excludes it. |
| P2-R1-F2 | Tests on `create_local_app` for a loopback self-hosted origin and a keyless desktop that ignores a planted plain session file, a built-asset test for `/auth` paths, and 422 tests for extra fields. |
| P2-R1-F3 | Port 80 gives `127.0.0.1`. |
| P2-R1-F4 | Recorded in the As-built notes as an accepted development-only exception. |
| P2-R1-F5 | All routes map the error: 503 while temporary, 409 otherwise. |
| P2-R1-F6 | Wording fixed; a test checks the instrumentor receives the exclusions. |

Each of the nineteen guards and wirings above was removed in turn and a test
failed. After the repairs, on working tree
`74454a5046409c2e70fac83c48e405e2d91d4dca`: the affected backend tests, 653
passed (the API file alone 81); lint and format passed; full mypy, no issues
in 923 files.

#### Code Review #2 Findings

Targeted recheck of working tree `74454a5046409c2e70fac83c48e405e2d91d4dca`.
The reviewer reran 718 tests across the affected files, lint, mypy on the
changed files, the boundary, licence and generated-client checks, and swept
20 guard removals. Result: pass. F1 to F6 are resolved.

| ID | Kind | Finding |
| --- | --- | --- |
| P2-R2-F1 | Optional | The WebSocket test sent `Sec-Fetch-Mode: websocket`, so the mode check refused it and the method check was not isolated. |
| P2-R2-F2 | Optional | The round-1 check line named no Git tree. |

#### Code Review #2 Revisions

Both accepted and verified by the implementing agent, as the policy allows for
a one-line test change: the WebSocket test's scope carries no fetch metadata,
and weakening the method check to `scope.get("method", "GET")` now fails both
of its cases; the check line names its tree. No further review was needed.

### Phase 3: Desktop custody

Review tier: high risk (secrets, Electron main, the packaged runtime).

Requirements: R2.1 (desktop). Threats T3 and T6. Follows D2.

Steps, tests first in `src/frontend/desktop/tests/runtime-state.test.ts`,
`src/frontend/desktop/tests/runtime-supervisor.test.ts`,
`tests/test_chatgpt_plan_store.py` and `tests/test_local_app_composition.py`:

1. `vault.ts`: an optional generated store key (32 random bytes), created on
   first need and saved with the vault's existing atomic encrypted write. It
   is part of `secrets()` for log redaction and never part of `list()` or
   `childEnvironment()`.
2. `supervisor.ts` `backendEnvironment()`: pass the key to the FastAPI child
   only, as `ANIMAMA_CHATGPT_PLAN_STORE_KEY`.
3. `server/config.py`: read and validate the key with `repr=False`, remove it
   from the process environment in the desktop composition, and give it to
   the session store. A desktop composition without the key reports sign-in
   as unavailable; it never falls back to an unencrypted file.

Checks: `pnpm desktop:test` from `src/frontend`; the backend test files;
`uv run ruff check`.

Completion: on desktop the session file is ciphertext, the key appears in no
log, child environment or status, and a profile without the vault is signed
out.

Recovery: deleting the session file signs out. Losing the vault makes the
file unreadable, which also means signed out.

Check record, results and commits: to be recorded.

#### Code Review #1 Findings

To be recorded.

#### Code Review #1 Revisions

To be recorded.

### Phase 4: Settings and setup

Review tier: standard.

Requirements: R1.1, R1.3, R1.4, R1.5, R1.6, R1.7 and the question in R4.1.

Steps, tests first in Vitest specs beside the sources:

1. Query hooks and mutations for the Phase 2 routes, beside the model
   configuration ones. The status query polls each second while an attempt
   is pending.
2. `model-configuration-state.ts`: a "ChatGPT plan" entry in the Cloud tab
   beside OpenAI, with "Signed in" and "Not signed in" status text.
3. A plan card in `src/frontend/web/src/ui/settings/models/` with these
   states: signed out (**Continue with ChatGPT**); waiting for the browser
   (cancel, open again); signed in (email, plan use, **Manage usage**, the
   background switch, sign out); plan use declined or not eligible (R1.4,
   with a way to enable it later); unavailable (R1.7 or missing secure
   storage). The card opens the authorize URL in a new browser context and
   never logs it.
4. The one-time confirmation (R1.3): "You're using your ChatGPT plan", what
   uses it, where to manage usage, and an unchecked choice for automatic
   memory updates. Confirming writes the preferences.
5. `SetupAiStep.tsx`: the same card as a setup choice (spec P8).
6. Text when sign-out could not be confirmed at OpenAI (R1.5).
7. Strings in all five locales, then `pnpm i18n:extract`.

Checks: the touched Vitest specs; from `src/frontend` `pnpm check`. Not run:
`pnpm verify`, the browser tests.

Manual check (G1, and G2 for desktop): a real sign-in in a task stack opened
on the same machine, in built and development mode, and in the desktop app.
This completes spec check C1's return test.

Completion: each card state renders from a mocked status, and a real account
signs in, stays signed in across a restart and signs out.

Recovery: the card is additive. Hiding it leaves the Models section as it is
today.

Check record, results and commits: to be recorded.

#### Code Review #1 Findings

To be recorded.

#### Code Review #1 Revisions

To be recorded.

### Phase 5: The plan connection and its model client

Review tier: high risk (catalog persistence and the seed, the API contract,
concurrency, outbound credentials).

Requirements: R3.1, R3.2 (catalog), R5.2, R5.3. Threats T4, T7 and T8.

Steps, tests first in `tests/test_chatgpt_plan_client.py`,
`tests/test_chatgpt_plan_models.py`, `tests/test_model_provider_catalog.py`,
`tests/test_model_error_categories.py` and
`tests/test_model_key_destinations.py`:

1. Connection: a `chatgpt_plan` id in `BUILTIN_CONNECTION_IDS`, a preset the
   owner cannot select, a built-in connection with no credential variable,
   the provider type (D3) and its entry in `app/chat/api_standard.py`. The
   hosted catalog policy stays as it is, which excludes the connection.
2. Seed: add the connection row, and make the deactivation statement skip
   this connection. Update the renderer and the parity test.
3. Model sync (D4, D9): at sign-in and on `POST
   /v1/chatgpt-plan/models:refresh`, list the account's models, upsert rows
   for the items whose `visibility` is `list` from the fields the Decision
   Log names, deactivate rows no longer listed, and deactivate all of them
   when the session ends. The list response is never logged. Rows accept
   only the `hidden` change. The model connection list reports the plan
   connection's credential state from the session. Add the refresh route to
   the inventory and regenerate the client with `pnpm openapi-ts`.
4. Validation: a plan row must be on the plan connection and needs a
   signed-in session, with a code the page can explain. Owner model routes
   refuse the plan connection.
5. Client: registered in `build_model_client_registry` (the mock under
   `ANIMAMA_LLM_SKIP`). The route profile sets `store` false; never sends a
   cursor, `moderation`, limits or metadata; wraps function tools in one
   namespace and maps returned names back; sends system text only as
   `instructions`; never sends `context_management` or `apply_patch`; and
   declares hosted `web_search` only for a row that supports it. Final
   items come from the terminal event when it has them and otherwise from
   the `response.output_item.done` events, and stream events the SDK does
   not type are ignored. The SDK client is key-free, has a fixed base URL,
   takes no headers from the environment and does no SDK retries. Each
   stream gets a view keyed with the session's access token.
6. Tool rounds replay by hand from the first round: each call and its
   output, without item ids. Requesting encrypted reasoning, and replaying
   each returned reasoning item with the id the SDK requires, sits behind
   a route-profile switch that is off until confirmed (Decision Log,
   2026-11-24). Tests cover both settings.
7. Errors: map the plan error codes and the bare `detail` bodies to new
   codes and categories for a limit, an ineligible account, a temporary
   outage, an unsupported request and a required sign-in. A 401 forces one
   refresh and one retry before any output. A limit sets the pause. Extend
   `sanitize_provider_error_message` for JWT shapes and the current token
   values (T3).
8. Prove the Utility path: `DirectModelPromptRunner` completes a prompt on a
   plan row.

Checks: the test files, including the acceptance test that inspects the
request built for a plan model; `tests/test_model_client_registry.py`;
`uv run ruff check`; from `src/frontend` `pnpm openapi-ts:check` and the
package-set `compare`. Not run: the full pre-push suite.

Manual check (G1): refresh lists the account's models, and one direct prompt
with a tool call succeeds on a real plan model. The probe's
`reasoning_replay` trial (D11) then runs once on each listed model, two
requests each. If a response holds a reasoning item beside the tool call
and the route accepts the follow-up, the reasoning switch turns on. If
none does, the switch stays off and Outcomes records reasoning replay as
unconfirmed.

Completion: a feature that picks its own model can use a plan model. This is
the point the content generation plan needs (D12).

Recovery: plan rows are derived data. Signing out deactivates them, and a
later sign-in restores them. The seed change is repeatable.

Check record, results and commits: to be recorded.

#### Code Review #1 Findings

To be recorded.

#### Code Review #1 Revisions

To be recorded.

### Phase 6: Chat on plan models

Review tier: standard.

Requirements: R3.2 (chat), R3.3 to R3.7, and R5.1 as chat shows it.

Steps, tests first in `tests/test_direct_chat_turn_executor.py`,
`tests/test_chat_manager.py`, `tests/test_companion_safety_chat.py` and the
Vitest specs for the composer and the failure notice:

1. Executor: a plan turn carries no moderation option and reads no cursor.
   After it, the chat row holds no cursor, so the next key-model turn
   replays history, and the reverse also works (R3.6, spec check C3). Native
   compaction is off for plan rows, so context fitting uses the row's
   window.
2. Web search per D8: hosted search where the row supports it, reported
   through the model's requestable tools so the picker's control explains
   itself (R3.5).
3. The composer shows "Using ChatGPT plan" with **Manage usage** when the
   selected model belongs to the plan connection, in chat and Quick Chat
   (R3.7).
4. Failure notices for the Phase 5 codes in `chat-failure.ts` and the
   product-ui catalogs: a limit and an ineligible account carry a **Manage
   usage** link, and a required sign-in names App Settings → Models. Add the
   codes to `userVisibleCodes.json`.
5. The chat picker groups plan models under "ChatGPT plan".

When chat image input (#904) lands, plan rows send image parts through the
shared request builder; this phase adds nothing for it.

Checks: the test files; from `src/frontend` `pnpm check`; the package-set
`compare` if a product-ui declaration changed.

Manual check (G1): on a real plan model an Anima replies with streaming, uses
a memory tool and gets a title; one turn uses hosted search and a memory
tool together; a chat started on a key model continues on the plan and
back.

Completion: spec acceptance lines for chat, the indicator and chat
continuity are met in tests, and the manual check passes.

Recovery: an Anima on a plan model can be moved to any other model, and its
chat continues there.

Check record, results and commits: to be recorded.

#### Code Review #1 Findings

To be recorded.

#### Code Review #1 Revisions

To be recorded.

### Phase 7: Roles, agreement and limits

Review tier: high risk (a background worker, the consent boundary,
concurrency).

Requirements: R3.2 (Utility, Memory Manager, Embeddings), R4.1, R4.2, R5.1.
Threat T7. Follows D5 and D6.

Steps, tests first in `tests/test_model_roles.py`,
`tests/test_memory_manager.py`, `tests/test_automatic_episode_processing.py`
and a new `tests/test_chatgpt_plan_background.py`:

1. Role pickers offer plan models for the default chat model, Utility and
   the Memory Manager, and never for Embeddings.
2. Memory Manager on a plan row: a plan mode of the Agents SDK runtime that
   streams, does not store, sends no cursor, puts its tools in a namespace,
   uses the function form of memory edits because the route refuses native
   `apply_patch`, turns tracing off, and builds its client from the
   session's token with no SDK retries. A request-capture test asserts that
   none of the rejected fields is sent. The Agents SDK replays output items
   with their ids, and reasoning items too, which Phase 0 did not try: the
   capture test records what it sends, and the manual check shows whether
   the route accepts it. If the SDK cannot meet the route's rules, stop and
   bring the options to the owner, because removing the Memory Manager from
   R3.2 changes the spec.
3. Agreement (D5, D6): `local_memory_manager_model_usable` is false for a
   plan row without agreement or while paused, with a reason the settings
   line can show. The token service enforces the same rule for the
   `background` purpose, so the check cannot be bypassed.
4. The pause (R5.1): set by a limit error, cleared when an interactive plan
   request succeeds, and shown in the status and on the card.
5. A Reflection on a plan model runs as the person's own request.

Checks: the test files; `uv run ruff check`; the touched Vitest specs. Not
run: the full pre-push suite.

Manual check (G1): with agreement, automatic episode processing runs on the
plan; without it, it does not and says why; a Reflection runs either way.

Completion: every T7 negative test passes, and the manual check matches.

Recovery: withdrawing agreement or choosing another Memory Manager model
takes effect on the next run.

Check record, results and commits: to be recorded.

#### Code Review #1 Findings

To be recorded.

#### Code Review #1 Revisions

To be recorded.

### Phase 8: Documentation and records

Review tier: light; the final integration review covers it.

1. A new ADR for sign-in credentials and the plan connection: D1 to D7, the
   sign-in return's admission rule, and the alternatives considered.
2. `GLOSSARY.md`: the Model connection entry now also covers a connection
   whose credential is a sign-in; new entries for the ChatGPT plan connection
   and account-listed models.
3. `docs/backend/model-catalog.md`,
   `docs/backend/runtime/model-client-providers.md` (the route profile and
   its errors) and `docs/backend/runtime/chat.md` (crisis detection on plan
   turns, R3.4).
4. `docs/backend/architecture/http-api.md`, `contracts/hosted-web.md` and the
   version prose in `docs/frontend/desktop/releases.md`.
5. `docs/backend/operations/local-http-components.md` and
   `docs/frontend/architecture/auth-server.md`: the return's admission rule.
6. `docs/backend/operations/development.md` (the session file and what
   backups skip), `docs/backend/operations/desktop-runtime.md` and
   `docs/frontend/desktop/overview.md` (the store key and the file).
7. `docs/frontend/features/model-settings.md`: signing in, the indicator,
   limits and the background choice.
8. Source-review entries for every new file.

Check: the documentation links resolve;
`python3 scripts/public-release/check_source.py`.

## Final integration review

One review of the combined change against the spec's acceptance criteria,
covering Phase 8 and reusing phase evidence. After its repairs and the
owner's agreement (G3), the full pre-push suite runs once on the final
candidate through the heavy slot: `python3 scripts/heavy-slot.py -- make
check-test`; from `src/frontend`, `python3 ../../scripts/heavy-slot.py --
pnpm verify`, `pnpm web:test:browser`, `pnpm prettier:check` and
`pnpm desktop:test`; and `pnpm e2e:test:fast` against a disposable built
stack. Results go in the pull request.

Gates:

- **G0.** Owner review of this plan, including D1 to D14.
- **G1.** A live account. Phase 0 and the manual checks in Phases 4 to 7 need
  an eligible ChatGPT plan and the account holder signing in themself in
  their own browser. The agent never handles the password. Plan usage is
  bounded: at most 25 small requests in Phase 0 and 10 turns in each later
  phase.
- **G2.** Desktop check on a packaged development build with a fresh profile:
  sign in, restart, chat on a plan model, sign out, then scan the profile's
  logs and files for token and code values. The agent drives the app only
  after the owner's go-ahead; otherwise the owner performs it. This is also
  where a missing module in the frozen runtime would show.
- **G3.** Owner agreement to the full pre-push run.
- **G4.** Owner checks: the button's branding (the logo asset and its terms
  under OpenAI's guidelines, or a text-only button), and whether the app's
  privacy notice covers plan use (spec check C4).

Hosted validation stays off unless the owner starts a run; the pull request
states which evidence is local.

Outside this repository: at its next repin, Animama Cloud admits the new
`local-http` major and keeps `chatgpt_plan` false. No Cloud work is part of
this plan.

## Validation and acceptance

Each spec acceptance criterion and the evidence planned for it:

| Criterion | Evidence |
| --- | --- |
| Sign-in on desktop and a same-machine stack; stays signed in; sign-out | Phase 1 and 2 tests; Phase 4 manual check; G2 |
| Tokens in no row, log, event, diagnostics, browser storage or URL | T3 tests in Phases 1, 2 and 5; G2 scan |
| The request built for a plan model | Phase 5 request test; Phase 7 capture test |
| A real plan model: streaming, a memory tool, a title; background work only after agreement | Phase 6 and 7 manual checks (G1) |
| The indicator shows on plan models only | Phase 6 composer test |
| Declined or ineligible sign-in, a limit, and no automatic switch | Phase 1, 5 and 7 tests with simulated errors |
| No plan model for Embeddings; speech unchanged | Phase 7 role tests |
| A chat continues across key and plan models | Phase 6 tests and manual check |
| Hosted exposes neither routes nor interface | Phase 2 inventory, capability and hosted-composition tests |
| Suites and documentation | Final suite (G3); Phase 8 |

## Idempotence and recovery

- No schema migration is planned. If a phase finds one is needed, it is a new
  Alembic revision with the ORM change (ADR 0035), and the owner is told.
- The seed change is repeatable, and account-listed rows are derived: a
  sign-in rebuilds them.
- The session is one directory under the data root. Deleting it signs out;
  signing in again reuses nothing that must survive.
- A sign-in attempt can be cancelled or left to expire. A failed or
  interrupted refresh keeps the previous token set.
- Every phase is a commit on the task branch and can be reverted alone in
  reverse order. Reverting Phase 5 or later after Animas chose plan models
  leaves those rows in the database; they become inactive, and each Anima
  needs another model.
- The task stack holds only test chats and can be removed with its volumes.
  The probe's credential file is removed after `sign-out`.

## Outcomes & Retrospective

To be recorded.
