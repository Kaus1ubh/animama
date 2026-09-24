# HTTP And Realtime API

Most backend routes are mounted under `/v1`. Product routes resolve a minimal
`RequestPrincipal` through the application factory's injected resolver. Local
FastAPI validates the installation's configured Host/Origin, browser metadata
and mutation marker; desktop requests also require a renderer capability cookie.
The local composition resolves the bootstrap-owned principal from server-owned
admission state. Browser identity and Authorization headers select no owner.
Tests use explicit fixture bootstrap and dependency overrides.

## Router Map

- `server/app.py`: internal `/health` and private desktop readiness.
- `server/routers/runtime_context.py`: bounded local bootstrap context, repair,
  and first-run completion.
- `server/routers/runtime_capabilities.py`: owner-protected optional feature
  availability and document-worker liveness.
- `server/routers/desktop_control.py`: private pack-removal preflight, never
  included in public OpenAPI or mounted in self-host composition.
- `server/routers/anima.py`: anima CRUD, chat-profile updates, direct chat
  SSE, and voice catalog uploads.
- `server/routers/model_provider.py`: active provider/model catalog for
  frontend model selection.
- `server/routers/chats.py`: chat CRUD and persisted chat messages.
- `server/routers/settings.py`: user settings and per-anima settings.
- `server/routers/user_profiles.py`: private local display-name reads and edits.
- `server/routers/content.py`: neutral Included/Local catalog health, Rescan,
  delete, package import/export, and registered-byte delivery.
- `server/routers/typed_content.py`: typed product List/Get/Save/Preview routes
  over the shared catalog.
- `server/routers/anima_loadouts.py`: typed Anima loadout read plus optimistic,
  idempotent family plan/commit commands.
- `server/routers/anima_runtime.py`: exact runtime issuance, lease renewal, and
  revision-scoped registered-byte streaming.
- `server/routers/avatar.py`: logical Avatar CRUD and catalog projection.
- `server/routers/user_files.py`: installation-owned file upload initialization,
  finalization, processing enqueue, debug chunk search, listing, abort, and
  delete lifecycle.
- `server/routers/memory_entries.py`: scoped markdown memory entry tree
  listing, path lookup, create, patch, move/rename, and soft-delete routes.
- `server/routers/memory_manager.py`: episodic-memory review and manual
  memory-manager run/message/approval routes.
- `server/routers/archive.py`: archive metadata/passages and embedding search.
- `server/routers/elevenlabs.py`: ElevenLabs clone, text-to-speech, sound
  effects, audio isolation, and realtime TTS session helpers.

## Health

- `GET /health`: basic service health after local bootstrap and HTTP admission.
- `GET /_desktop/health`: private supervisor readiness, excluded from OpenAPI
  and mounted only in desktop composition. A constant-time match against the per-launch
  `X-Animama-Desktop-Control` token is required; absent/invalid credentials
  return 404 and incomplete startup or failed Included reconciliation returns 503. The bounded result contains
  schema version, runtime version, build ID, Alembic head, principal ID,
  `local_http_schema_version: 1`, `process_id` and `process_start_token`.
  The latter two identify the supervisor's exact live child. The result never
  contains the control credential or renderer capability.
- `POST /_desktop/runtime:quiesce`: the same private control boundary closes new
  product admission and waits up to 15 seconds for existing work. It returns
  `200 {"schema_version":1,"state":"quiesced"}` or
  `409 {"detail":{"code":"runtime_busy"}}`. Timeout keeps admission closed
  without cancelling work; restart the unchanged owned backend to resume.

## Optional Runtime Capabilities

`GET /v1/runtime-capabilities` uses the ordinary admitted installation
`RequestPrincipal`. It returns:

```json
{
  "schema_version": 1,
  "runtime_kind": "desktop",
  "user_file_processing": {
    "enabled": false,
    "worker_state": "disabled",
    "last_heartbeat_at": null,
    "pack_id": "document-processing",
    "supported_extensions": []
  },
  "offline_speech_enabled": false,
  "offline_speech_asset_version": null
}
```

`runtime_kind` is presentation metadata (`desktop` or `self_hosted_web`), not
an authentication mode. The self-host composition returns a null document
`pack_id`; the Electron supervisor supplies pack-dependent settings. An enabled
worker is `starting` until its expected instance has a heartbeat, `ready` for
twenty seconds after that heartbeat, then `stale`. Enabled work may queue while
starting/stale. A disabled capability returns `409` with
`{"detail":{"code":"file_processing_unavailable"}}` from explicit process
requests before repository lookup or enqueue. Original-file upload/finalization
and existing indexed-file search still work. React checks fresh capability
metadata before enqueue and before creating an offline speech worker. The
asset version is an opaque cache key, never a path or credential.

`POST /_desktop/feature-packs/{pack_id}:removal-check` is a separate supervisor
contract. Only a valid per-launch `X-Animama-Desktop-Control` token reaches it;
all other requests and unknown pack IDs return 404. The bounded response has
`schema_version`, `pack_id`, nullable `source_version`/`pack_version`, `removable`,
and at most 32 `{kind, id, label}` blockers. Kinds cover Anima/loadout references,
runtime and preview leases, content operations, and live document jobs. It never
returns filesystem roots. Electron repeats preflight after draining renderers
and stopping the worker, before switching pack pointers. Catalog withdrawal
reuses the same reference checks at restart; readiness fails closed on conflict.

## Content Catalog

- `GET /v1/content/catalog` lists caller-visible Included,
  installation-shared, and owned entries with scan status, safe diagnostics,
  current revision, dependencies, and opaque file registrations.
- `GET /v1/content/items/{item_id}` reads one visible item.
- `POST /v1/content:rescan` performs an authoritative scan of registered
  Included and Local type roots and returns per-source counts plus the updated
  visible catalog. It resolves unfinished Local mutations before admission.
  Valid new files become selectable but are never equipped.
- `DELETE /v1/content/items/{item_id}` deletes one expected owned Local
  revision and purges its explicit catalog identity; Included is read-only and
  content still referenced by an Avatar or Anima loadout is rejected. File
  removal and catalog deletion share recoverable mutation ownership with an
  internal operation identity; the route does not accept a retry key.
- `GET /v1/content/files/{file_ref}` authorizes one opaque registration,
  revalidates filesystem containment, regular-file/link state, exact size, and
  SHA-256, then streams the bytes. It accepts no path or storage key. Digest
  ETags are evaluated only after authorization and integrity checks.

In embedded desktop, byte delivery uses the exact immutable Included mount
recorded with the item or preview. Unmounted/mismatched sources fail closed;
neither the renderer nor a request chooses a filesystem root. The existing
public API and ownership fields do not change for mounted sources.

Changed registered bytes return `409 content_file_changed_rescan_required`.
Unknown, unavailable, guessed, or cross-owner references all return `404
content_file_not_found`.

Package operations are:

- `POST /v1/content/items/{item_id}:export?operation_id=...`, which validates
  the current exact typed closure, canonicalizes descriptors, rewrites every
  installation-local reference, and streams a deterministic temporary
  `animama-content-package/2` archive;
- `POST /v1/content/packages:import`, which validates an untrusted archive and
  complete dependency graph in private staging, then promotes ordinary
  editable Local items through one journaled, recoverable operation using
  `cancel`, `keep_both`, or explicit `replace` collision behavior. Destination
  drift and late failure expose no partial catalog selection.

Save and Import bind an owner-scoped `operation_id` to the complete
request and its original successful response. An identical retry returns that
response before current-item or revision validation and never writes again,
including after subsequent edits or deletion. A changed request under the same
ID returns `409 operation_id_reused`; use a new ID for new work. An original
success response is historical and does not assert the item still exists.
Delete keeps its existing expected-revision contract; a repeated deletion can
return not found.

Filesystem journals and database success receipts jointly recover interrupted
mutations before startup/Rescan admission. If subsequent manual edits conflict
with restoration, `409 content_recovery_conflict` preserves both the current
files and original backups; affected admission and mutations remain blocked
until operator repair. The local bootstrap reports content repair required
through its existing bounded readiness state. Recovery evidence must not be
deleted as cache cleanup.

## Local Runtime And Profile

These accountless endpoints still require the normal request-principal
dependency; none accepts an owner ID or internal credential from the body.

- `GET /v1/runtime-context`: return schema version 1, principal ID, bounded
  bootstrap status/failed steps, first-run completion, and nullable display
  name.
- `POST /v1/runtime/bootstrap:ensure`: retry idempotent local owner bootstrap
  and return the same bounded context.
- `POST /v1/runtime/onboarding:complete`: accept only
  `{ "display_name": string }`, required and nonblank (1–80 characters);
  atomically save private personalization,
  guarded `PROFILE.md` synchronization, and write-once first-run completion.
- `GET /v1/users/me/profile`: return only nullable `display_name`.
- `PATCH /v1/users/me/profile`: require and update nonblank `display_name`
  after first run. Missing, null, blank, and overlong names return 422.

Null display names are only pending-setup placeholders. First-run completion
requires both a stored name and a timestamp; an earlier skipped setup reopens
without resetting ownership or data. `GET /v1/animas` returns owned rows in
ascending creation-time/ID order so launch falls back to Annie on fresh installs.

Local profiles provide private display-name personalization. See
[Local User Profile](../features/user-profiles-and-usernames.md).

## Typed Content, Loadouts, And Runtime

`GET /v1/avatar-catalog` is the paginated product-Library projection over
Avatar metadata joined to valid Content Catalog models and registered
portraits. It returns Included or Local origin without exposing paths.

Gestures, Reactions, Poses, Pose Clips, effects, Sounds, Idle Styles, Music Tracks,
Avatar content, Appearance, and portable voice content expose generated typed
contracts over the neutral catalog. Each family supports List/Get/Save/Preview
under its own `/v1/{typed-family}` prefix; for example:

```text
GET    /v1/gestures
GET    /v1/gestures/{item_id}
PUT    /v1/gestures/{entry_name}
POST   /v1/gestures/{item_id}:preview
```

Equivalent families are `reactions`, `poses`, `pose-clips`, `particle-effects`,
`avatar-effects`, `scene-effects`, `sound-effects`, `idle-styles`,
`music-tracks`, `avatar-content`, `appearance-content`, and `voice-content`.
The closed handler for the selected kind validates the schema-versioned
document, files, dependencies, roles, runtime projection, and portable package
references. Unknown fields and mismatched kinds are rejected. Avatar and Scene
definitions contain bounded renderer settings and registered logical resource
names; external/data/Blob URLs, scripts, shaders, and host paths are rejected.

Idle Style authoring accepts `schema_version: 2` Gesture pools, separate
emotion/intensity cells and explicit No idle/inheritance. It has no companion
motion upload or per-Anima pool override. `GET /v1/gestures/{item_id}/idle-playback`
returns exact-media finite eligibility or a safe reason for ineligibility.
Style Preview includes an `idle_playback` map keyed by its declared Gesture
reference, validated against the same frozen bytes. Gesture Preview includes
eligible finite facts for the Idle editor's candidate playback; an ordinary
ineligible Gesture can still be previewed outside idle use. Legacy Styles remain readable
only for local conversion/recovery, not supported typed selection or authoring.
Dependency `item_id` values identify caller-visible targets. Clients resolve
locator references through those identities; they must not guess a logical-key
suffix. Raw Save receipt responses may omit this optional resolution metadata.

The Pose family returns `PyPose` metadata; registered preview bytes carry the
resolved pose values. Pose Save uses the loaded catalog revision and an operation
ID, preserving the same request for ambiguous retries. Included items are read-only;
customization saves a new Local identity. Parent references are not admitted, and
there is no Pose loadout slot.

A typed `POST .../{item_id}:preview` freezes one current validated root and its
dependency-complete support closure. Exact preview bytes use
`/v1/content/previews/{preview_id}/revisions/{revision}/files/{file_ref}`.
Preview never changes an Anima.

Two bounded multi-root operations reuse the same handler validation and
dependency resolver over exactly one caller-visible catalog read:

- `POST /v1/content/evidence:resolve` accepts exact `{kind, source:
{item_id, revision_sha256}}` roots and returns per-root plus combined
  revision maps. It is metadata-only: it issues no file capability and writes
  no preview, runtime, receipt, or product row. Stale, hidden, invalid, and
  dependency failures are ordinary safe diagnostics with `complete: false`.
- `POST /v1/content/previews:prepare` accepts catalog or versioned Builtin
  roots and returns canonical typed closures. Successful roots share at most
  one owner-scoped preview lease and one deduplicated protected file list;
  failed roots may coexist with that partial lease.

Evidence cannot be upgraded to delivery with a request flag. Preview
preparation remains an ephemeral capability and never validates or creates an
Anima.

The owner-scoped loadout endpoints are:

- `GET /v1/animas/{anima_id}/loadout`;
- `POST /v1/animas/{anima_id}/gestures:plan|commit`;
- `POST /v1/animas/{anima_id}/reactions:plan|commit`;
- `POST /v1/animas/{anima_id}/idle-style:plan|commit`;
- `POST /v1/animas/{anima_id}/music-tracks:plan|commit`;
- `POST /v1/animas/{anima_id}/avatar:plan|commit`;
- `POST /v1/animas/{anima_id}/appearance:plan|commit`;
- `POST /v1/animas/{anima_id}/voice:plan|commit`.

Plan requests carry the expected loadout revision and a typed family intent.
Commit repeats that intent with the reviewed plan digest and an idempotency
key. Selections store logical catalog items; Pose Clips, Particle, Avatar, and
Scene Effects plus Sounds remain compiler-managed support dependencies of
Gesture/Reaction roots and cannot be equipped directly.

`GET /v1/animas/{anima_id}/runtime` independently compiles selected roots and
their transitive dependencies into one persisted owner-scoped exact revision.
Concurrent reads may reuse that effective revision. The snapshot pins the
complete admitted `catalog_item_id -> revision_sha256` map and persists one
immutable typed catalog body; it does not copy a row for every file. Each
member carries its canonical opaque `content_catalog_files.file_ref`. The file
route uses one read-only joined query to recheck owner, Anima, expiry, current
access, parent pin, item status/revision, and canonical file facts, then checks
containment, size, and digest before streaming bytes. It never returns a second
download URL and never renews the lease as a side effect of a GET.

The manifest GET negotiates gzip or identity and returns the complete
`PyAnimaRuntime` JSON. Gzip work runs off the event loop; Content-Length is the
encoded length, Vary includes Accept-Encoding, and ETag hashes the actual wire
body. The cache policy remains `private, no-cache`. Each request authorizes and
issues fresh lease information: If-None-Match never skips issuance with 304,
since `effective_revision` does not include the changing lease fields. An
unsupported encoding falls back to identity unless identity is explicitly
forbidden too; no acceptable representation returns the bounded 406
`runtime_encoding_not_acceptable` error. Local HTTP serving preserves this metadata and
compressed stream without recompression. Private files retain their exact
size/digest bytes, and SSE, WebSockets, uploads and range streams are unaffected.

The optional `json_bundle` manifest field advertises a version-1 URL, `file_refs`,
and total original bytes. `GET /v1/animas/{anima_id}/runtime/revisions/{revision}/json-bundle`
combines projected optional `application/json` sequences and manifests, excluding
the Avatar's essential closure and descriptor/meta files. Selection is deterministic
and server-owned: at least two, at most 256 files, 256 KiB each and 2 MiB in total.
Other content retains individual delivery. It accepts no client paths or member lists.

The bundle envelope is `{version: 1, revision, members: [{file_ref, text}]}`;
an unavailable member has `error` instead of `text`. Text preserves the original
UTF-8 bytes, including whitespace, for browser size/SHA-256 verification. After
loading the owner's issued snapshot, one joined query checks all selected members
against the live lease, current visibility and pinned revisions. Each file is then
opened and verified on disk, with bounded reads off the event loop. Physical
changes mark the catalog scan-required; independent good members remain usable.

Complete bundles use the same gzip/identity negotiation, wire ETag/length and
`Vary: Accept-Encoding` as manifests, with `private, no-cache`. Unlike issuance,
bundle GET does not change a lease, so it may return 304 **after all authorization
and physical checks**. Mixed-error responses use `no-store`, omit ETag and never
return 304. Wrong owners/revisions return 404 and expired snapshots return 409.
There is no persistent archive or server authorization cache.

Mounted clients may renew an unexpired revision and send `runtime_revision` on
every `chat:sse` request. The AI-visible Gesture vocabulary and frontend
playback catalog therefore share one fence. Missing or expired revisions return
`runtime_remount_required`; Save or Equip never silently switches an active
chat. A source edit after issuance prevents unprepared files from being served
under the old pin, while bytes already retained by a prepared browser mount
remain stable until explicit remount.

## Animas

The anima router currently owns the main user-facing backend flows:

- create, list, get, update, and delete animas
- instantiate animas from avatar rows
- update the anima chat profile default model provider
- retrieve anima payloads enriched with protected avatar/voice catalog URLs
- run the direct avatar companion chat path over SSE

`GET /v1/animas` returns a dedicated list item shape: the existing safe Anima
fields plus a required `presentation` object. Both list and detail responses
include stable `display_name`, `aggregate_revision`, and `identity_status`
(`ready` or `repair_required`). The presentation contains the same live
display name, opaque revision, and optional
`RuntimeImageReference` bounded to 256 by 256 pixels. The list loads chat
profiles, custom profile candidates, and exact primary-model portrait
candidates in set-based reads; it does not call the complete runtime resolver
for each row. A valid custom Profile Image wins. Otherwise the reference uses
the registered Appearance portrait whose metadata matches the selected Avatar
model. It remains null when neither is available.

The reference includes a normalized `presentation` object with Fill/Fit,
focal point, and zoom. These fields are revisioned presentation semantics;
saved position strings are normalized for backward compatibility.

`RuntimeImageReference.source_type` is `catalog`; its API-relative
`/v1/content/files/{file_ref}` URL is fetched with normal authentication. Both
Included and Local portraits use this protected route. The presentation
revision includes selected source and crop/focal semantics, while catalog file
integrity remains independently enforced. Detail and mutation responses retain
`PyAnimaResponse` and do not compile the list projection.

Anima rows are owner-scoped by the request principal in the retained `user_id`
column. Direct creation uses the strict command below and the caller-owned
`AnimaAggregateMaterializer`. Creation writes identity/history, definition audit, chat profile, settings,
and loadout together. Strict creation selects the
active local `ANIMAMA_DEFAULT_MODEL_PROVIDER_ID` (default
`OpenAIResponsesHTTPAgent:gpt-5.6-luna`) and persists ElevenLabs voice
`gJx1vCzNCD1EQHT212Ls` without a provider request. Reads use the Anima's stable
display name independently of mutable `avatar.name`. No runtime mount or chat/greeting is created.

`PATCH /v1/animas/{anima_id}` accepts `anima.display_name` or compatibility field
`anima.avatar_id` only with a positive body `expected_aggregate_revision`.
Missing/stale guards return `409`; missing/foreign Animas return `404`.
Names trim only outer whitespace, preserve case/internal spacing, reject
controls, and contain 1–40 Unicode code points for every new creation or
explicit rename. The existing 120-character database columns remain wider so
grandfathered names can still be read and can survive unrelated identity or
loadout edits without truncation; renaming one must choose a 1–40-character
name. A real name-only change increments aggregate revision without changing
identity/loadout versions.
An Avatar change updates the logical mapping/binding and increments aggregate
and loadout once; name plus Avatar in one PATCH still increments each once.
Direct `anima.profile_picture_url` updates return `422
use_typed_appearance_command`; use reviewed typed Appearance commands instead.
Ordinary emotional state/metadata patches do not change definition revision.

Typed loadout read/plan responses carry `aggregate_revision`. Existing
`:plan`/`:commit` bodies keep `expected_revision` for the loadout; the reviewed
digest also fences aggregate revision. A name/identity change between review
and commit returns `409 loadout_plan_stale`. Commit responses include the
resulting aggregate revision (nullable when replaying a stored receipt without that field).

### Strict private creation

These interfaces are backed by creation and starter receipt tables in the
current baseline. The [four-step creator](../../frontend/features/custom-anima-creation.md)
consumes them, and frontend-server onboarding uses the generated starter command
rather than bulk or mutable request templates.

Authenticated `GET /v1/animas/creation-options` returns versioned
Recommended Starter Pack selections/counts, nullable default Idle evidence,
limits, and diagnostics. Read-only `POST /v1/animas:validate` accepts
`AnimaSpec` and returns the normalized spec/warnings.
`POST /v1/animas` accepts that strict spec plus a body idempotency key; the
owner is never a browser field. The complete `expected_source_revisions` map
includes selected roots and all typed supports with kind/revision. New companions
start with Idle empty; `default_idle.source` is null and its revision map is empty.
Before the Review step, the browser obtains that map with one
`POST /v1/content/evidence:resolve` call containing the selected Avatar,
and Actions, then independently submits the whole spec to
`POST /v1/animas:validate`. The strict API retains typed profile/background
Appearance fields, but the current browser sends both as explicit nulls and
makes no Appearance read or Save request. This transition creates no preview
rows and makes no typed `:preview` calls.

Creation returns 201, identical replay 200, changed-input conflict 409, and
deleted-result replay 410. Successful replay precedes current source/default
checks. Stale sources are 409 with field/Action diagnostics; missing or
inaccessible sources are 404; malformed/invalid commands are 422. The creation
error envelope is `detail: {code, message, retryable, issues}`, with at most 100
safe JSON-Pointer diagnostics and no hidden-source revision or host path.
Missing/inactive configured defaults return 503. Failed precommit
attempts leave no receipt or aggregate. No provider request, first Chat row,
runtime mount, or Blueprint side effect occurs inside creation.

`POST /v1/animas/starters:ensure` accepts `{"schema_version":1,"repairs":[]}` and uses backend-owned
`StarterAnimaSpec` values, stable owner/starter receipts, explicit legacy repair,
and deletion tombstones. The local installation bootstrap invokes the same
owner-scoped ensure behavior with the generated principal and no explicit
repairs; ordinary ensure must not resurrect deleted starters.
Results list `created`, `existing`, `adopted`, `deleted`, or `repair_required`
per stable starter slot. Explicit `adopt`/`create_missing` repairs are accepted
only for recorded unresolved legacy slots; foreign adoption is 404. Each slot
commits independently. The generated OpenAPI client includes these contracts;
`animama.domain.anima_creation` and `animama.server.schemas.anima_creation` owns their exact schema and normalization
rules. See [custom Animas and content](../features/custom-animas-and-content.md)
for the source, identity and idempotency invariants.

### Current chat-profile update

The model selector write API is:

- `PATCH /v1/animas/{anima_id}/chat-profile`

The request body is `{ "default_model_provider_id": "Provider:Model" }`. The
route verifies anima ownership and an active `model_providers` row before
updating the profile.

## Chat SSE

`POST /v1/animas/{anima_id}/chat:sse` executes the supported normal avatar
companion chat turn and streams Server-Sent Events. It resolves a anima chat
profile or request-level model override, invokes an app-scoped direct model
client, derives emotion updates from the main structured response, persists
request-local side effects, and tears resources down when the stream finishes or
is closed.

The SSE stream currently emits:

- `tts.session`
- `tts.session.error`
- `tts.audio`
- `tts.done`
- `tts.error`
- `user.response`
- `emotion.update`
- `avatar.gesture.requested`
- `chat.title.updated`
- `error`
- `run.completed`

Provider adapters may consume token and lifecycle streams internally, but the
public `chat:sse` contract is domain-level rather than a raw provider-event
mirror. For normal structured turns, `user.response` is emitted after the final
model result is parsed into speech/display parts. When text
tokenization/phonemization is available, the route adds `tokenized_text` and
`phonemized_text` to speakable response or completion payloads. This makes SSE
useful for clients that need a simple request-scoped stream instead of a
persistent WebSocket.

The route accepts a `PyAnimaChatRequest` with a required non-blank `message`,
optional `chat_id`, optional `run_id`, optional `model_provider_id`, and
optional `dispatch_options`, and required `runtime_revision`. The backend
authorizes that owner's persisted runtime snapshot before provider work and
returns `409 runtime_remount_required` when it is missing or expired. The same
snapshot's Gesture inventory defines the strict model enum,
final validation, and the revision carried by `avatar.gesture.requested`.
`model_provider_id` must match an active
`model_providers.id` row that supports the requested direct-chat turn features.
When omitted, the backend requires the anima's explicit
`anima_chat_profiles` default model provider. Missing profiles fail setup
before any upstream model call.

The selected model provider also determines the chat's API standard. Missing
chat rows are created with the selected `api_standard`. Empty chat rows created
earlier through `/v1/chats` are initialized on their first `chat:sse` request.
Later requests against the same chat must use a model provider with the same
`api_standard`; otherwise setup fails before SSE opens with `409` and
structured detail:

```json
{
  "code": "chat_api_standard_mismatch",
  "chat_id": "chat-...",
  "chat_api_standard": "chat_completions",
  "requested_api_standard": "responses",
  "requested_model_provider_id": "OpenAIResponsesHTTPAgent:gpt-5-nano",
  "action": "start_new_chat"
}
```

Gemini and LiteLLM rows currently have null chat compatibility fields and are
rejected for direct chat with `400` setup detail starting
`chat_api_standard_unsupported`.
DeepSeek V4 rows use the `chat_completions` standard through `OpenAIHTTPAgent`,
so they can continue OpenAI Chat Completions chats and are blocked from
Responses-backed chats by the same mismatch response.
When `dispatch_options.tts.enabled=true` and
`dispatch_options.tts.provider="elevenlabs"`, the route resolves the
ElevenLabs realtime session concurrently with the primary model turn and emits a
TTS-specific session or session-error event. `dispatch_options.tts.transport`
is request intent only; backend config decides the actual direct vs backend
intermediary transport. `dispatch_options.tts.model_id` may request
`eleven_flash_v2_5` or `eleven_multilingual_v2` for realtime speech, or
`eleven_v3` for finalized-text speech. Realtime omitted values use the backend
configured default. Realtime selected models are returned in
`tts.session.model_id`. `eleven_v3` does not start realtime bootstrap and does
not emit `tts.session` or `tts.session.error`.
The route does not infer TTS setup from `main_structured_response`.
Before model invocation, direct chat opens cached path `IDENTITY.md` in the
active anima scope for prompt context and appends only the identity markdown
content to the single system instruction. User profile memory entries are seeded
during installation bootstrap but their content is not injected into direct chat
context yet. When memory influence is enabled, direct chat adds a request-local
`# List of memory files` developer message immediately before the latest user
message. The list includes only user-scope file entries (`anima_id IS NULL`),
uses cached paths such as `PROFILE.md`, and omits anima-scoped files and tree
formatting. `disable_memory_influence` suppresses the list while keeping
required anima identity active. Provider rows that do not support OpenAI's
`developer` message role, including DeepSeek, receive that request-local memory
map inside the system instruction instead.

## Installation Events

The events router exposes:

- `GET /v1/events:sse`

Local clients reach the stream through the same-origin local HTTP boundary.
The stream is an installation-level notification channel reserved for future
owner notifications. It currently emits heartbeat comments only and has no
Redis dependency.

Realtime notification transports should be treated as delivery signals.
Durable state remains in the database.

## Model Providers

The model provider router supports:

- `GET /v1/model-providers`: public model catalog for frontend selection

The route returns active serialized `model_providers` rows. Secret values,
provider base URLs, pricing metadata, and backend-only capability fields are not
returned by the public catalog. Anima chat-profile writes and request-level
`chat:sse` model overrides must name an active catalog row. Public catalog rows
also include nullable `model_client` and `api_standard` fields so clients can
distinguish OpenAI Chat Completions rows from OpenAI Responses rows before
sending a chat turn. Gemini and LiteLLM rows return null values for those fields
until their transcript compatibility semantics are defined.
DeepSeek V4 Flash and V4 Pro are exposed as `OpenAIHTTPAgent` rows with
`model_client="openai_chat_completions"` and
`api_standard="chat_completions"`, so clients can use the existing same-standard
restore and send-gating behavior without a DeepSeek-specific frontend rule.

## Memory

Memory APIs expose a scoped Markdown entry tree:

- `GET /v1/memory/entries?anima_id=&parent_id=&recursive=false`
- `GET /v1/memory/entries/by-path?anima_id=&path=...&type=file`
- `GET /v1/memory/entries/{entry_id}`
- `GET /v1/memory/entries/{entry_id}/versions?before_version=&limit=50`
- `GET /v1/memory/entries/{entry_id}/versions/{version}`
- `POST /v1/memory/entries`
- `POST /v1/memory/entries/{entry_id}:revert`
- `PATCH /v1/memory/entries/{entry_id}`
- `DELETE /v1/memory/entries/{entry_id}?expected_version=N&recursive=false`
- `POST /v1/memory/debug/search-memory-files`
- `GET /v1/memory/episodes?status=pending&limit=100`
- `POST /v1/memory/manager/runs`
- `POST /v1/memory/manager/runs:process-episodes`
- `GET /v1/memory/manager/runs/current`
- `GET /v1/memory/manager/runs/{run_id}`
- `POST /v1/memory/manager/runs/{run_id}:complete`
- `POST /v1/memory/manager/runs/{run_id}/messages`
- `POST /v1/memory/manager/approvals/{approval_id}:decide`
- `POST /v1/memory/manager/approvals/{approval_id}:undo`

Memory entry routes require the resolved request principal and never accept a
client-supplied owner.
Rows are scoped by nullable `anima_id`: `NULL` is installation-owner memory, and
non-null selects one anima-specific tree after validating that the anima belongs
to the current user. The virtual root is represented by `parent_id = NULL`;
files and directories share one sibling namespace, stable IDs, cached POSIX
paths, optimistic version checks, soft deletes, and immutable version snapshots.
Stale current-row versions and non-recursive directory deletes with live children
return `409`.

Entry names are stable POSIX path segments. The service rejects blank names,
traversal segments, slashes, backslashes, control characters, non-markdown file
paths, oversized paths/segments, and display-name characters such as spaces.
The one exception is `POST /v1/memory/entries` for a file with
`create_parents=true`: in that request, `name` is a validated relative POSIX
Markdown path below `parent_id`, and every missing directory is created in the
same unit of work. `expected_version=0` prevents a retry from overwriting an
existing file, and directory requests cannot enable `create_parents`.
Move/rename rejects cycles, cross-user moves, cross-anima-scope moves, and
parenting under files. Responses include optional `description`, `metadata`,
derived `scope`, entry `type`, cached `path`, and file header fields. Blank
descriptions are stored as null.

Version history is authorized through the owned current entry, including when
that entry is soft-deleted. The list route returns content-free summaries in
newest-first order and supports bounded cursor pagination with
`before_version`; the default page size is 50 and the maximum is 100. The
detail route returns one immutable snapshot and only its adjacent change:
Version N is compared with Version N-1, while Version 1 uses a virtual empty
Version 0 creation baseline. Content is represented as a unified diff and path
and description changes as structured old/new values. Generated episode logs
have readable history, but the routes are read-only and expose no arbitrary
two-version comparison.

`POST /v1/memory/entries/{entry_id}:revert` accepts positive
`target_version` and `expected_version` values. It requires an owned editable
live Markdown file at exactly the expected Version and an existing older target
Version for the same entry. The mutation copies only content and normalized
description, preserves current identity/tree/path/kind/metadata/scope/live
state, and appends a new `revert` Version with source and target-Version
provenance. Missing or foreign entries return `404`; stale current Versions
return `409`; protected/generated/directory/deleted, current/future/missing, and
no-change targets return `400`.

Anima-scoped `IDENTITY.md` reads/writes additionally return
`aggregate_revision`. Create/repair, PATCH, and Revert for that file require
`expected_aggregate_revision` alongside the memory version (`0` for creation).
Missing/stale aggregate guards return `409`. Each successful write appends one
memory version and definition audit revision in the same transaction. The
identity must be nonblank UTF-8 Markdown, with CRLF/CR normalized to LF while
preserving meaningful whitespace, and at most the smaller of 32 KiB and
`ANIMAMA_MEMORY_FILE_MAX_BYTES`. Moving, renaming, deleting, changing its kind,
or AI-undoing a required identity file is forbidden. A missing/blank identity
blocks chat until explicit repair; there is no current-Avatar fallback.

`POST /v1/memory/debug/search-memory-files` is a read-only authenticated debug
route for the direct-chat `search_memory_files` tool path. The request accepts a
trimmed non-empty `query` up to 2048 characters. The response echoes `query` and
returns `memory_results` without scores, match types, object-storage keys, URLs,
user IDs, embeddings, versions, hashes, timestamps, or metadata.

The episode and manager routes are also authenticated and current-user scoped.
The static manager `/runs/current` route returns the one `active` or
`waiting_approval` snapshot, or `null`, and is declared before the dynamic run
route. Creating a run atomically completes stale active state before insertion;
an unresolved approval instead returns `409 Conflict` without changing the
existing run.
`GET /v1/memory/episodes` lists source-of-truth episode rows for manual review,
defaulting to `status=pending`. Episode status is binary: `pending` requires
review and `processed` has been reviewed, regardless of whether curated memory
changed. There is no public manual status-mutation route; the specialized
processing workflow owns that transition.

`POST /v1/memory/manager/runs:process-episodes` accepts only
`auto_approve_diffs`. It locks open manager state, refuses to replace a run
with a pending approval, selects up to 51 oldest pending rows in
`(occurred_at, id)` order, and binds the first 50 to a new specialized run.
The extra row supplies `has_more`; a user with no pending rows receives
`409 Conflict` without losing the current active run. The public run response
contains `kind = "episode_processing"` and a safe task summary, never raw task
state, durable episode IDs, or copied episode text.

While the private task is `processing`, the runtime reloads the fixed owned
rows and presents them as `E01` through `E50`. Rows stay pending through model
execution and approval pauses. Only a completed terminal result with no pending
approval atomically marks exactly that batch processed, refreshes affected
daily files, and changes task status to `processed`. The run itself remains
`active`; later messages use general Memory Manager instructions on the same
Responses cursor. Overflow and newly captured rows are not changed. Blocked or
failed runtime results fail the run and leave the task and rows pending.

Manager messages normally run a live OpenAI Agents SDK `ApplyPatchTool`
workflow over a constrained virtual memory workspace;
`ANIMAMA_LLM_SKIP=1` switches this to the deterministic local test runtime.
Approval decisions are real commits for valid create/update patches: approved
patches write through `MemoryEntryService` and atomically store the target entry
ID and resulting `applied_version`; public previews carry separate nullable
`old_description` and `new_description` values alongside body content/diff
fields. Rejected patches do not change
memory, and stale version/path conflicts return `409 Conflict` while leaving
the approval pending. Reject requests may include normalized
`feedback` of at most 2,000 characters; nonblank feedback is invalid with
`decision = "approve"`. Persisted feedback is returned on the approval and is
included in the Agents SDK rejection message so the same processing run can
propose a corrected patch. Manager create and append bodies accept
`auto_approve_diffs` (default false). When enabled, the backend follows only the
durable approval chain attributed to that submitted message, committing and
resuming sequentially up to eight times; the frontend does not orchestrate
automatic approval calls.

Approval responses also include `undone_at`, `undo_version`, and server-computed
`can_undo`. `POST
/v1/memory/manager/approvals/{approval_id}:undo` rechecks eligibility under
locks. Only the latest approved, not-yet-undone create/update for a target can
be Undone, no approval may be pending in the same run, and the editable live
target must still be at its applied Version. Update Undo restores prior content
and description together; create Undo
soft-deletes the created file while retaining generated parents.
Both append an `undo` Version and preserve the original approval decision. A
successful retry is idempotent. Missing/foreign resources return `404` and
stale or ineligible requests return `409`.

Normal direct chat assembles the current anima identity entry content into
system instruction context. Anima identity is always required, and
`disable_memory_influence` does not remove it. Anima creation seeds
anima-scoped identity entries with
`description = "Initial identity of {anima.display_name}"`. The local
installation bootstrap creates a private user-scope `PROFILE.md` from template
version 1; first-run personalization updates only its managed preferred-name
line while the template metadata and version still match. AI memory tools are runtime-scoped to user-scope file
entries only and are executed through application services, not provider
clients.

## Chats

The preferred and currently mounted chat history API is `/v1/chats`. It exposes
product-shaped chat CRUD and message retrieval backed by `chats` and
`chat_messages`:

- `POST /v1/chats`
- `GET /v1/chats`
- `GET /v1/chats/{chat_id}`
- `PATCH /v1/chats/{chat_id}`
- `DELETE /v1/chats/{chat_id}`
- `GET /v1/chats/{chat_id}/messages`
- `POST /v1/chats/search`

Chat creation verifies the referenced anima exists and is owned by the
current user; missing or foreign animas return `404`. Chat reads, updates,
deletes, and message reads are scoped to the current user's chats. Message
responses expose `chat_id`, `run_id`, `model_provider`, `model`, and
`internal`; identifiers belong to Chats and request-local runs.
Message reads hide internal rows by default, and
`include_internal=true` includes those rows with `internal=true`. Chat responses
include nullable `api_standard`, `last_model_client`, and `last_model_id`
fields, cumulative usage totals accumulated from persisted assistant message
usage plus `active_context_tokens`, the latest normal assistant turn's
provider-reported `total_tokens` minus output reasoning tokens. Chats created
through `POST /v1/chats` can return null standard and last-model fields until
the first model-backed `chat:sse` request initializes the standard and a
successful durable turn records the last model snapshot. Non-empty
null-standard chats are treated as invalid transcript state by `chat:sse` and
should be replaced by a new chat.

Chat search runs PostgreSQL full-text search over visible current-user chat
messages. Structured assistant speech and display text are concatenated for
indexing and snippets; messages without structured response text fall back to
raw `content`. The API accepts `query`, `limit`, and `offset`, uses sanitized
prefix FTS for partial terms instead of web-search operator syntax, hides
internal rows, uses a generated `search_vector` column backed by a partial GIN
index scoped to visible user/assistant content, joins through
`chats` for ownership, and returns one result per chat. The best matching
visible message in each chat supplies the snippet and score, while the response
includes chat/anima metadata including the anima `profile_picture_url` for
result rendering.

## Settings

Settings routes manage:

- user-level settings
- anima-level settings

Anima settings include runtime preferences such as memory influence, memory
updates, emotional analysis, and presentation flags for animation or visual
effects. Dispatch option resolution combines request-level overrides, settings,
and anima defaults.

## Avatars And Uploads

`/v1/avatars` manages logical Avatar metadata and its identity template.
Playable VRM bytes are valid Included or Local `avatar` catalog items. A
private Avatar associates `catalog_item_id`; Included rows resolve their
source-controlled model to the matching catalog item.

Avatar creator Save publishes a normal `content/local/avatars/<name>.vrm` plus
an optional sidecar through `PUT /v1/avatar-content/{entry_name}`. The shared
VRM validator admits only structurally valid self-contained VRM 0.0/1.0 up to
100 MiB. Identical bytes reuse a valid caller-owned Avatar without changing
metadata; different-byte collisions require rename or revision-checked replace.
The optional form `creation_context=true` prevents replacing an in-use Avatar.

`PUT /v1/appearance-content/{entry_name}` canonicalizes bounded static
PNG/JPEG/WebP inputs (16 MiB, 8192 per side, 40 million pixels). The portrait
endpoint `PUT /v1/avatar-content/{item_id}/portrait` takes multipart `file`,
`entry_name`, `operation_id`, and `expected_avatar_revision`; a 512-square WebP
capture becomes a normal owner-scoped 256-square Appearance up to 256 KiB.
It does not modify the Avatar or any Anima. Confirmed content survives cancelled
or rejected creation. Typed previews expose `expected_source_revisions` for
the creation-compatible root/support closure, independent of preview pins.

Appearance and portrait images are typed `appearance` catalog items. Focused
`/v1/animas/{anima_id}/appearance:plan` and `:commit` commands store
profile/background selection plus crop/focal configuration.

## User Files

The user-files router manages installation-owned document uploads, processing jobs,
and backend debug search. It exposes:

- `POST /v1/files/uploads`: validate filename, allowlisted extension, and
  declared size; create a pending `user_file` row; return a private
  API-relative PUT target.
- `PUT /v1/files/{file_id}/content`: resolve the bootstrap-established owner, bound the streamed
  body, spool beneath `data/staging/uploads`, and atomically promote the exact
  bytes to `data/user-files/<user-id>/<file-id>/original`.
- `POST /v1/files/{file_id}:finalize`: verify the current user's pending row,
  opaque local locator, file existence, and exact size; mark the row
  `uploaded`.
- `POST /v1/files/{file_id}:process`: enqueue or reuse a durable processing job
  for the current user's finalized file. The API process only enqueues; parsing
  runs in the `animama-file-worker` process.
- `POST /v1/files/debug/search`: search current-user processed chunks in
  `keyword`, `semantic`, or `hybrid` mode. Keyword search uses PostgreSQL
  full-text search. Semantic search embeds the query and searches chunk
  embeddings. Hybrid search combines keyword and semantic candidate ranks with
  reciprocal rank fusion.
- `POST /v1/memory/debug/search-memory-files`: run the AI memory-tool debug
  search over user-scope markdown memory entries.
- `GET /v1/files`: list the current user's non-deleted file records newest first.
  Responses include cheap processing summaries: chunk count and latest job
  summary when available.
- `GET /v1/files/{file_id}`: return one current-user file record or `404`.
- `DELETE /v1/files/{file_id}`: best-effort delete the local original and mark the row
  `deleted` or `delete_pending`; stored chunks are removed from debug search.
- `DELETE /v1/files/uploads/{file_id}`: abort a non-finalized upload and
  best-effort delete its staged/local bytes.

Original download URLs are not exposed. Direct chat accepts validated
`attached_file_ids` and reads processed chunks through bounded tools; see
[user files](../features/user-files.md#search-and-retrieval). Supported extensions are:
`.txt`, `.md`, `.rst`, `.org`, `.json`, `.csv`, `.tsv`, `.html`, `.htm`, and
`.xml`, plus digital rich documents `.pdf`, `.docx`, `.pptx`, and `.xlsx`.
Macro-enabled Office files, executables, scripts, installers, and archives remain
blocked.

See [user files](../features/user-files.md) for the end-to-end local upload
flow, parser worker lifecycle, statuses, configuration, and debug UI behavior.

## Archives

The archive router manages anima archive metadata and passages. It supports
embedding-based passage search where the database/provider setup supports it.
Archive data is separate from the scoped Markdown memory filesystem.

## ElevenLabs

The ElevenLabs router exposes utility routes for voice clone, text-to-speech
preview, sound effects, and audio isolation. `POST /v1/animas/{anima_id}/chat:sse` owns chat TTS
bootstrap and audio delivery.

Realtime chat TTS resolves the anima voice from
`speech.elevenlabs.primary_voice`, ignores legacy saved variant maps, validates
`eleven_flash_v2_5` or `eleven_multilingual_v2`, and emits `tts.session` with a
short-lived direct ElevenLabs websocket token. `eleven_v3` finalized chat TTS
uses backend-prepared gruut `tts_text` per structured speech segment, calls
ElevenLabs' plain streaming TTS API with `output_format="pcm_24000"` and text
normalization off, then emits ordered `tts.audio` frames and one final
`tts.done` over `chat:sse`. Segment failures emit `tts.error` and stop v3 audio
synthesis without blocking the final chat completion frame. Anima does not
request or forward ElevenLabs timestamp/alignment metadata.

## Client-side speech

Frontend and desktop speech flows use client-side Parakeet STT, MicVAD,
smart-turn, Pocket TTS, and ElevenLabs TTS. The local API does not mount STT
or LiveKit session routes.
