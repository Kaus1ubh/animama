# API Reference

This is a compact current-route reference. The generated OpenAPI document is
the source of truth for schema details.

## Animas

- `POST /v1/animas`
  - Accepts strict `AnimaSpec` plus an owner-scoped body idempotency key and
    atomically creates one complete private Anima with initial revisions of 1.
  - Creates SQL-backed `identity.md`/history, exact typed loadout, settings,
    neutral emotion, the configured active model, and the default local voice.
    No provider request, Chat row, greeting, or runtime mount is created.
  - Returns 201 on creation, 200 for identical replay, 409 for key conflict or
    stale sources, and 410 when the committed result was deleted.
- `GET /v1/animas/creation-options`
  - Returns versioned Recommended Starter Pack selections/counts, defaults,
    source revision evidence, limits, and diagnostics.
- `POST /v1/animas:validate`
  - Validates and normalizes a complete `AnimaSpec` without creating state.
- `POST /v1/animas/starters:ensure`
  - Ensures backend-defined Annie/Caitlyn slots with stable receipts, preserving
    customization/deletion and requiring explicit repair for uncertain legacy slots.
- `GET /v1/animas`
  - Lists animas owned by the current user.
- `GET /v1/animas/{anima_id}`
  - Returns one owned anima, including chat profile and presentation URLs when
    available.
- `PATCH /v1/animas/{anima_id}/chat-profile`
  - Updates `chat_profile.default_model_provider_id` after validating the
    selected active `model_providers` row.
- `PATCH /v1/animas/{anima_id}`
  - Updates a live display name or Avatar with `expected_aggregate_revision`;
    ordinary emotion/metadata updates do not advance definition revisions.
    Profile URLs are not a supported write; use typed Appearance commands.
- `PUT /v1/animas/{anima_id}/emotional-state`
  - Replaces persisted emotional state.
- `POST /v1/animas/{anima_id}/chat:sse`
  - Runs one request-local direct chat turn through a shared model client and
    streams SSE frames such as `user.response`, `emotion.update`,
    `avatar.gesture.requested`, `chat.title.updated`, `error`, and
    `run.completed`.

The old graph, agent membership, `/v1/agents`, `/v1/animas/custom`,
`/v1/animas/bulk`, and anima profile-edit APIs are retired.

## Model Providers

- `GET /v1/model-providers`
  - Returns active public provider/model catalog rows for frontend model
    selection. Pricing, provider base URLs, and secrets are omitted.

## Chats

- `POST /v1/chats`
- `GET /v1/chats`
- `GET /v1/chats/{chat_id}`
- `PATCH /v1/chats/{chat_id}`
- `DELETE /v1/chats/{chat_id}`
  - Authenticated, owner-scoped chat thread APIs.
- `GET /v1/chats/{chat_id}/messages`
  - Returns persisted chat messages. Internal rows are hidden unless
    `include_internal=true`.
- `POST /v1/chats/search`
  - Searches visible current-user chat messages.

## Memory

Anima-owned memory containers and ordered block APIs are retired. The backend
does not mount `/v1/memories...` or `/v1/blocks...`; those paths return normal
`404` responses.

- `GET /v1/memory/entries?anima_id=&parent_id=&recursive=false`
- `GET /v1/memory/entries/by-path?anima_id=&path=...&type=file`
- `GET /v1/memory/entries/{entry_id}`
- `GET /v1/memory/entries/{entry_id}/versions?before_version=&limit=50`
- `GET /v1/memory/entries/{entry_id}/versions/{version}`
- `POST /v1/memory/entries`
- `PATCH /v1/memory/entries/{entry_id}`
- `DELETE /v1/memory/entries/{entry_id}?expected_version=N&recursive=false`
- `POST /v1/memory/debug/search-memory-files`
  - Authenticated, current-user markdown memory entry APIs. Entries are files
    or directories in either user scope (`anima_id = null`) or one anima scope.
    Writes and deletes use optimistic `expected_version` checks. Deletes are
    soft deletes; non-recursive directory deletes with live children return
    `409`.
  - Version lists are content-free, newest first, and cursor-paginated. Exact
    version reads show only the adjacent Version N-1-to-N change; Version 1
    uses an empty creation baseline. History is read-only.
  - The debug search route is read-only and returns the same compact
    user-scope markdown memory hits used by `search_memory_files`. Uploaded-file
    diagnostics use `POST /v1/files/debug/search`.

The old `/v1/memory/files` routes are not mounted.

## Avatars And Typed Content

- Logical Avatar registration, updates, deletion, and catalog selection live in
  `server/routers/avatar.py`, backed by Included or Local catalog items.
- `server/routers/content.py` owns neutral catalog listing, import/export,
  Rescan, deletion, and registered-byte delivery.
- `server/routers/typed_content.py` installs family-specific List/Get/Save/Preview
  routes, including Avatar and Appearance content and Avatar portrait Save.
- `server/routers/anima_loadouts.py` owns family-specific loadout plan/commit
  commands; `server/routers/anima_runtime.py` resolves the exact runtime closure.
- See the [HTTP API guide](../../../../docs/backend/architecture/http-api.md) for the current
  route contract. Immutable Avatar-release APIs are retired.
- User-file upload, finalize, process, list, search, abort, and delete routes
  live in `server/routers/user_files.py`.

## Voice

- ElevenLabs clone, TTS, sound effect, audio isolation, and realtime session
  helpers live under `/v1/elevenlabs...` routes.

## Events And Health

- `GET /health`
- `GET /v1/health`
- `GET /v1/health/whoami`
- `GET /v1/events:sse`
  - Authenticated account-level notification stream. Currently emits heartbeat
    comments only.

Runs are request-scoped identifiers used by `chat:sse` events and logs. The
backend no longer exposes legacy session, graph dispatch, or direct-agent run
routes.
