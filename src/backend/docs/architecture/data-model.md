# Data Model

## Neutral Content Catalog

Gesture, Reaction, Particle Effect, Avatar Effect, Scene Effect, Sound Effect,
Idle Style, Music Track, Avatar, Appearance, voice, and pose clip content share
one readable Content Catalog. The legacy `anima` kind is reserved/rejecting;
live Animas are private aggregates. Included and Local are filesystem sources,
not parallel domain models. Concrete validators and runtime players remain
type-specific; ordinary creator Save updates an editable catalog item instead
of creating an immutable release.

The backend uses SQLAlchemy 2.0 async models under `orm/`. Domain objects live
under `domain/`, and repository adapters map between ORM rows and domain
dataclasses. Routers should generally avoid leaking ORM rows into application
logic.

## Database Engine

`local/database.py` builds the local async engine. Each local app owns its
database resources; requests and chat streams obtain their session factory from
the app. Tests or another local composition can inject `session_factory` into
`create_local_app`. Explicit app settings take priority for the database URL
and pool values. Otherwise the URL comes from `ANIMAMA_DATABASE_URL` when set.
If that is absent, PostgreSQL environment
variables are used. Development defaults point to a local asyncpg PostgreSQL
database.

The engine normalizes common PostgreSQL URL variants, including `sslmode`
conversion for asyncpg. Tests use pytest/testcontainers with a pgvector-enabled
PostgreSQL image, so regular test runs do not need a developer-managed database.

The installation settings model lives in `local/installation_model.py` and is
registered explicitly by local Alembic and bootstrap. Shared ORM imports do not
register installation state or create an engine. Local CLI compatibility
helpers retain their own cached engine, separate from app-owned resources.

The async engine passes explicit pool sizing to SQLAlchemy instead of relying on
implicit defaults. Configure these values with:

- `ANIMAMA_DATABASE_POOL_SIZE` default `10`
- `ANIMAMA_DATABASE_MAX_OVERFLOW` default `20`
- `ANIMAMA_DATABASE_POOL_TIMEOUT_SECONDS` default `30`
- `ANIMAMA_DATABASE_POOL_RECYCLE_SECONDS` default `-1`
- `ANIMAMA_DATABASE_POOL_PRE_PING` default `true`

For deployment sizing, budget approximately
`backend_processes * (ANIMAMA_DATABASE_POOL_SIZE + ANIMAMA_DATABASE_MAX_OVERFLOW)`
possible backend connections, plus worker processes and other services that use
the same Postgres instance. Keep that total below the database's
`max_connections` with headroom for migrations, admin tools, and maintenance
workers.

## Migrations

Alembic revision `baseline_20260908` creates the complete current accountless
local schema from frozen `alembic/versions/0001_baseline.sql`. It replaces the
13 unreleased revisions in one intentional development reset boundary. The SQL
creates the final tables, constraints, indexes, runtime-worker heartbeats and
content mutation receipts directly, without creating retired transition tables.
It must not import live ORM metadata or be regenerated as models change; future
schema changes use forward revisions.

The baseline creates and seeds the singleton installation settings row with a
new UUIDv4 principal in the same migration transaction. The principal is not a
fixed seed identity. Alembic ensures extensions before product DDL. The data-only
SQL seeds in `alembic/seeds/` run after migrations through the shared database
bootstrap service used by Compose reset and desktop. Catalog seeds and
application owner/default/starter bootstrap
retain their separate responsibilities and idempotence.

Databases stamped with any removed revision cannot upgrade through this graph.
Retain the matching old checkout to read or restore those databases/backups, or
explicitly recreate a disposable development database. Do not stamp an old
schema as the new baseline. This change does not reset any existing installation
automatically, and ordinary restarts do not clear data. A full database reset
loses database-owned content and creates a new owner; retained Local files and
private upload bytes need separate recovery consideration. See
[Database operations](../operations/development.md#database).

The local graph contains no hosted identity tables and is not used by the
future hosted Animama Cloud database. Fresh databases contain only the neutral
catalog, loadout, runtime snapshot and other active product tables. Package
manifests are generated at import/export time rather than persisted as everyday
Local content.

## Core Entities

### Installation Settings

`ORMInstallationSettings` maps the singleton `installation_settings` row. Its
small-integer primary key is constrained to `1`.
`installation_principal_id` is non-null and unique; the baseline generates
its canonical UUIDv4 once in the same transaction that creates the row.
`first_run_completed_at` is nullable and write-once. Ordinary restarts and
gateway-token rotation preserve this row and therefore preserve ownership. A
full database purge creates a new principal. A missing singleton or malformed
principal is a fatal local configuration error.

### Readable Content Catalog

`ORMContentCatalogItem` maps `content_catalog_items`. It stores one
logical identity reconciled from an Included or Local entry: source,
authorization scope, optional owner, typed kind, human-readable relative
locator, optional descriptor/logical key, display name, scan status, revision
SHA-256, provenance, metadata, diagnostics, and scan timestamps. Desktop
Included items also carry a `source_mount_id` such as `core@<build-id>`; it is
an immutable-source selector, not an owner or path. Absolute paths
are forbidden by architecture and never persisted.

`ORMContentCatalogFile` maps opaque `file_ref` values to exact item-local
regular files, roles, media types, sizes, and SHA-256 digests. The protected
delivery route joins back to the item for scope/owner/status authorization,
then uses the item's exact mounted source plus the stored relative path. Missing
items lose usable file registrations.

`ORMContentCatalogDependency` stores ordered declared references and the
resolved target item when unambiguous. Authoritative reconciliation marks
unresolved, ambiguous, or cyclic roots invalid. It never substitutes a similar
entry.

`ORMContentMutationReceipt` stores successful Save, Delete, and Import results
in the same database transaction as their catalog, owner, and provenance
changes. An existing operation result is immutable: identical requests replay
it, while a different digest conflicts. Receipts are retained across item
deletion and are not runtime leases or filesystem recovery journals. Filesystem
journals retain original bytes until this committed database decision is known;
startup and Rescan resolve them before admitting Local content.

A same-path edit preserves the item and opaque file reference while updating
digests. Explicit logical keys and an otherwise unique content revision allow
safe rename reconciliation. Ambiguous renames leave the old row missing and
create a new identity.

Mounted Included reconciliation scopes identity matching to the stable source
ID. Replacing one source version can retain its item IDs, but identical files
from another mount cannot adopt them. An absent optional mount is withdrawn
atomically only after Avatar, loadout, dependency, active-preview, and runtime
pin checks. It is not misclassified as a missing core file.

`ORMContentPreview` and `ORMContentPreviewFile` freeze the owner,
catalog revision, expiry, and exact file facts for one ephemeral typed preview.
Each preview file also retains its exact `source_mount_id`; issuing a preview
rechecks the current locked item/revision/mount before publishing the lease.
Typed documents themselves are framework-neutral domain values and are parsed
by the closed kind-handler registry; the catalog's bounded metadata projection
is not the application semantic model.

### Local User Profile

`ORMUserProfile` stores private installation personalization in
`user_profiles`. Its primary key is the installation principal in the retained
`user_id` ownership column. The only mutable field is nullable
`display_name VARCHAR(80)`; null is allowed only for the pending-setup
placeholder. Saving personalization requires a nonblank name. Creation and update
timestamps complete the row. The local schema contains no username, biography,
visibility, alias, cooldown, claim, or creator-resolution state.

`LocalInstallationBootstrapService` creates the missing profile through the
neutral `OwnerProfileBootstrapPort`. First-run completion updates the profile,
the guarded bootstrap-managed `profile.md` version, and
`installation_settings.first_run_completed_at` in one transaction. A direct
user edit to `profile.md` disables later automatic synchronization.

The application path is:

```text
User Profile router schema -> UserProfileService -> UserProfileRepository -> SQLAlchemyUserProfileRepository -> ORM
```

See [Local User Profile](../features/user-profiles-and-usernames.md) for the
current API and privacy rules.

### Content Catalog And Anima Loadouts

Each valid catalog item owns its current readable revision, registered files,
and resolved dependencies. Creator Save atomically updates the Local source and
reconciles this state. Included entries are read-only. There is no
`ORMContentItem`, `ORMContentRelease`, `ORMContentBlob`, staged creator upload,
or release-dependency model in the current baseline.

`content_mutation_receipts` retains original Local mutation results under the
composite key `(owner_user_id, operation_id)`. Each row stores the request digest,
JSON success result and creation timestamp. It has no item foreign key: later
edits or hard deletion must not erase original-success replay.

Avatar and Scene Effect catalog metadata stores closed, bounded renderer
definitions and logical local resource names. The catalog never stores a
signed URL, external media URL, or absolute path. Gesture and Reaction
dependency rows point at the exact catalog targets selected by their
descriptors.

`ORMAnimaLoadout` maps `anima_loadouts` and owns the optimistic revision plus
Starter exclusions and the intentionally-empty Idle state.
`ORMAnimaContentBinding` stores typed logical catalog selections and their
family-specific configuration. Gesture semantic-key and Reaction-cell
uniqueness are enforced by the service while Music duplicate/autoplay rules
also have partial unique indexes. Effects, Sounds, and Pose Clips reached
through an action are compiler-managed dependencies rather than peer loadout
rows. `ORMAnimaLoadoutMutationReceipt` makes lost-response retries idempotent;
`ORMAnimaLoadoutDiagnostic` preserves visible warnings for rejected legacy or
externally invalid equipment without deleting its catalog item.

Runtime compilation persists one `anima_runtime_snapshots` row for each exact
owner/Anima/effective revision. Its bounded `admitted_item_revisions` JSON
object pins every admitted catalog item to the revision used by the typed
projection; canonical file facts remain registered once in
`content_catalog_files`. The snapshot also stores the immutable typed catalog
body and its digest, while response URLs and the current lease expiry are
overlaid when it is read. There is no per-runtime file-membership table.

Chat turn setup authorizes the issued snapshot and consumes its persisted
Gesture/Reaction inventory instead of rebuilding against mutable catalog
state. Runtime file delivery joins the snapshot, requested canonical file, and
parent item in one read-only query. It permits delivery only when the parent is
still accessible, valid, and at the pinned revision, then rechecks the actual
filesystem size and digest before streaming.

The development schema contains only the catalog, dependency, preview,
per-Anima binding, and exact runtime tables described above. A database reset
creates no parallel generic package, release, or raw-binding model.

### Anima

`ORMAnima` stores the user-owned anima aggregate:

- `user_id`: explicit owner principal (the installation principal locally)
- `display_name`: stable owner-edited name, independent of Avatar metadata
- `aggregate_revision`: positive definition revision, initially 1
- `identity_status`: `ready` or `repair_required`
- optional archive and avatar foreign keys
- optional profile picture URL
- emotional state JSON
- user-controlled metadata
- relationships to chat profile rows and chats

New anima writes do not synthesize runtime graph JSON, `chat_runtime`
metadata, anima descriptions, anima personality JSON, direct chat instruction
metadata, or backing `agent` rows. Display names belong to Anima, not the joined
Avatar. The Avatar FK is `RESTRICT`; ORM back-reference handling cannot silently
clear it when an equipped Avatar is deleted.

New writes also create the typed loadout described above. That association is
the authoritative source for the live canvas and direct-chat runtime; the
Avatar aggregate supplies its selected catalog model and optional portrait.

The current [live creation model](../features/custom-animas-and-content.md)
includes stable Anima name/revision and compact `anima_definition_revisions` records
keyed by `(anima_id, aggregate_revision)`, with display name, identity entry and
version pointer, actor, reason, and timestamp. Identity stays in the existing
Anima-scoped `memory_entries`/`memory_entry_versions` SQL virtual filesystem,
with no physical `identity.md` projection. New aggregate, identity, and loadout
revisions start at 1. Name changes advance aggregate revision; identity writes
and Revert advance aggregate and memory version; equipment changes advance
aggregate and loadout revision once. Runtime state, chats, and ordinary settings
do not advance definition history. The materializer writes all children through
one caller-owned session and leaves commit/rollback to the caller.

New Animas receive identity through the materializer. The retired migration's
one-time legacy identity adoption is available only in the old checkout; the
current baseline does not migrate or backfill old Anima rows.

The baseline includes owner-scoped
`anima_creation_receipts` and stable `anima_starter_receipts`.
Creation uniqueness is `(owner_user_id, operation, idempotency_key)`, with a
normalized-spec SHA-256 and compact original result, never the submitted
identity/spec. Transaction-scoped locks serialize first attempts and retries.
Successful creation receipts and deletion tombstones
are retained for owner lifetime, not the loadout mutation receipt's expiry.
Starter uniqueness is owner plus `starter:annie`/`starter:caitlyn`, independent
of specification version. The baseline neither reads an account table nor
pre-populates account-derived receipts. The local installation bootstrap creates missing
Starter receipts for the generated principal through the normal idempotent
service. Intentional deletion is preserved. The receipt owner columns have no
account foreign key; the original Anima ID survives as a tombstone. Receipt and aggregate writes share one
caller-owned unit of work; first runtime issuance happens after commit.
No Blueprint/publication/package table is introduced by this live-creation plan.

### Anima Chat Profile

`ORMAnimaChatProfile` stores product-level chat configuration for one anima.
Its current source-of-truth field is `default_model_provider_id`, a foreign-key
style catalog ID such as `OpenAIHTTPAgent:gpt-5-nano`. Normal
`chat:sse` uses this row when a request does not pass an explicit
`model_provider_id`, and the frontend model selector updates it through
`PATCH /v1/animas/{anima_id}/chat-profile`.

### Model Providers

`ORMModelProvider` stores the durable supported provider/model catalog in
`model_providers`. Each row represents one supported adapter/model pair, such as
`OpenAIHTTPAgent:gpt-5-nano`, and has a unique `(provider_type, model)`
pair for chat-message model snapshots and anima chat-profile defaults.

Rows include public selection metadata, runtime capability metadata such as
`supports_developer_role` and the backend-internal
`structured_output_transport`, lifecycle fields (`active` and
`deprecated_at`), provider base URL, and backend-internal pricing/source
metadata. The deterministic post-schema seed is generated from `MODEL_CATALOG`;
public `/v1/model-providers` responses omit pricing fields and
`structured_output_transport`.
Application cost helpers consume these rows together with `Usage` counters to
produce Decimal token-cost estimates, but account billing and quota enforcement
are not implemented in this table.

### Memory

The anima-owned `ORMMemory` and `ORMBlock` tables, domain objects, repository,
service, and public API were retired on 2026-06-19. Fresh metadata for this
rework does not register the block-memory ORM models, and animas no longer
carry a `memory_id` foreign key.

The current schema stores scoped markdown memory as a hybrid tree plus cached
path index:

- `ORMMemoryEntry` maps to `memory_entries`, the current live or soft-deleted
  row for one filesystem entry. Rows are scoped by `user_id` plus nullable
  `anima_id`: `NULL` is account-wide user memory, and non-null selects one
  anima-specific tree. Fields include nullable `parent_id`, `type` (`file` or
  `directory`), `name`, `normalized_name`, cached `path`,
  `normalized_path`, file-only `content`, `content_sha256`, `size_bytes`,
  current `version`, optional `kind`, optional `description`, metadata JSON,
  timestamps, `deleted_at`, and a generated PostgreSQL `search_vector` over
  path, description, and content for direct memory tool full-text search.
- `ORMMemoryEntryVersion` maps to `memory_entry_versions`, an internal
  append-only audit table. Each successful create, update, move, delete, Undo,
  or Revert appends a row keyed by entry ID plus version. Version rows snapshot scope,
  parent/name/path, entry type, file content fields where applicable, entry
  metadata, deletion state, separate change provenance, operation, and
  timestamp.
- `ORMMemoryEpisodeItem` maps to `memory_episode_items`, the source-of-truth
  table for raw episodic-memory notes captured after successful non-incognito
  `chat:sse` turns. Rows store user ownership, optional chat/run/message
  provenance, `occurred_at`, `local_date`, generated `episode_path`, text,
  binary status (`pending` or `processed`), processing metadata, and source
  metadata JSON. `processed` means reviewed, whether or not the review changed
  curated memory. Generated daily markdown files under `episodes/**` are
  projections of this table.
- `ORMMemoryManagerRun`, `ORMMemoryManagerMessage`, and
  `ORMMemoryManagerApproval` map to `memory_manager_runs`,
  `memory_manager_messages`, and `memory_manager_approvals`. Runs persist a
  constrained `kind` (`general` or `episode_processing`) and an optional
  versioned private `task_state`. An episode-processing task stores the fixed
  ordered episode IDs, run-local aliases `E01` through `E50`, batch size,
  `has_more`, timestamps, and `processing` or `processed` status; episode text
  is reloaded from its source rows rather than copied into the run. Runs also
  store the internal nullable `openai_previous_response_id` Responses cursor
  and serialized Agents SDK state while an approval is paused. Visible
  messages form the UI/audit transcript. Approval rows contain target path,
  operation, expected version, old/new content, nullable old/new description,
  unified diff preview, decision status, optional rejection-only
  `decision_feedback`, decision timestamps, the positive `applied_version`
  committed by approval, and a consistent nullable
  `undone_at`/positive `undo_version` pair. Constraints
  prevent non-positive application/Undo Versions and incomplete Undo audit
  pairs. The partial unique index
  `uq_memory_manager_runs_user_open` enforces at most one run per user whose
  status is `active` or `waiting_approval`. Superseded active runs retain their
  transcript and durable runtime state and record
  `metadata.completion_reason = "superseded_by_new_run"`.

Neither the Responses cursor nor private task state is projected through the
public manager API. The API exposes only run kind and a safe task summary with
status, batch size, `has_more`, `started_at`, and `processed_at`. Visible
messages remain the UI/audit transcript, while the cursor is the live
model-context chain. Serialized agent state is separate: it stores an exact
paused Apply Patch interruption and is cleared after the SDK resumes without
another interruption.

These manager columns follow the current reset-era schema posture. Fresh
metadata/bootstrap databases include them automatically; an existing database
must be reset or receive explicit columns for run kind, task state, the
Responses cursor, approval decision feedback, old/new approval descriptions,
applied Version, and Undo audit fields before running this backend version.

Undo and Revert preserve the append-only model. An approved Memory Manager
patch records the exact entry and Version it produced. Undo appends a new
`operation = "undo"` snapshot and records source approval/run/applied-Version
provenance in `change_metadata`; update Undo restores the approval's old body
and old description together and does not rewrite the approved decision.
Revert appends `operation = "revert"` and records source-entry plus selected
target-Version provenance. In both cases `change_metadata` explains why the
version exists for audit purposes and remains separate from the entry's own
metadata snapshot. The inverse mutation, appended Version, and approval audit
fields share one transaction.

The native Apply Patch harness uses a synthetic description header only while
the model reads and diffs a virtual file. Strict parsing separates the result
before persistence: `memory_entries.content`, `content_sha256`, `size_bytes`,
search vectors, and every `memory_entry_versions.content` snapshot contain only
the Markdown body, while `description` remains the first-class metadata field.
One accepted native patch updates both fields and appends one Version.

Public entry routes validate any non-null `anima_id` against the current Better
Auth user before resolving or creating entries in an anima scope.
Partial unique indexes enforce one live namespace for files and directories:
root user entries, root anima entries, non-root siblings, user-scope cached
paths, and anima-scope cached paths all ignore rows with `deleted_at IS NOT
NULL`. A virtual root is used instead of a persisted root row; `parent_id = NULL`
means the top level of the selected scope.

The frozen baseline includes the memory-manager open-run index. The one-time
pre-release reset boundary applies to old schemas; subsequent changes to this
invariant require a forward migration.

The application path is:

```text
memory entry router schema -> MemoryEntryService -> MemoryEntryRepository -> SQLAlchemyMemoryEntryRepository -> ORM
memory manager router schema -> MemoryManagerService -> MemoryManagerRepository -> SQLAlchemyMemoryManagerRepository -> ORM
```

`MemoryEntryService` owns name/path normalization, type-specific validation,
byte limits, SHA-256 calculation, description trimming and blank-to-null
normalization, optimistic version checks, version increments, descendant path
cache updates for moves, soft deletes, audit-row writes, and ownership-scoped
version-history reads.

`memory_entry_versions` is append-only and keyed by stable entry ID plus a
positive monotonically increasing version. History list queries are content-free,
newest first, and paginated by `before_version`. Exact detail reads load Version
N and its immediate Version N-1 predecessor; Version 1 alone uses a virtual
empty Version 0 baseline. The service returns a unified content diff plus
structured path and description changes without mutating current state. History
authorization loads the owned current entry even when soft-deleted, and
generated episode-log snapshots are readable through the same interface.

Source/provenance details for seeded files belong in memory-entry `metadata`
instead of dedicated columns. Materialization seeds an anima-scoped `identity.md`
entry with `kind = "anima_identity"` and
`description = "Initial identity of {anima.display_name}"`. The temporary
legacy creation adapter additionally stores
`metadata.anima_id`, `metadata.source.type = "avatar_identity_seed"`,
`metadata.source.avatar_id`, and `metadata.source.avatar_name`.

Normal direct chat fetches cached path `identity.md` in the active anima scope
at turn setup as required anima configuration and inserts only the identity
markdown content into the system instruction. Installation bootstrap creates a
user-scope `profile.md` entry for new users with `kind = "user_profile"` and
`description = "Initial profile of {name}"`, where `{name}` resolves from Better
Auth name, email, then user ID.

Direct chat also renders a request-local `# List of memory files` developer
message immediately before the latest user message when memory influence is
enabled. The list contains only user-scope file entries (`anima_id IS NULL`),
uses cached paths such as `profile.md`, and omits anima-scoped files and tree
formatting. Each entry contains only `path` and `description`.
The list is not persisted as a chat message or memory-entry version; persisted
`metadata.memory_context.opened_files` keeps the `(anima_id, path)` scoped
version/SHA fingerprints used for backend refresh checks. When
`disable_memory_influence` is true, direct chat omits the list but still keeps
required anima identity. AI memory tools can list/read/search/write user-scope
file entries only; they cannot access anima-scoped identity entries.

The Memory Manager commits an approved create or update through
`MemoryEntryService` and resumes the paused Agents SDK state. Specialized
episode-processing runs bind at most 50 pending rows to one private task. A
successful terminal runtime result with no pending approval atomically marks
that exact batch processed, regenerates every affected daily episode file,
changes task state to `processed`, and leaves the run `active` for ordinary
follow-up conversation. Blocked or failed execution leaves task state
`processing` and the fixed rows pending.

The frozen Alembic baseline creates these tables on fresh installations;
application startup does not create them from live ORM metadata.

### Chats And Messages

The product-facing backend boundary treats a user thread as a `Chat`: one
resolved owner principal chatting with one anima/avatar. The public durable API uses
`/v1/chats` and `chat_id`. `/v1/conversations` is not mounted, and
`chat:sse` accepts `chat_id` rather than legacy conversation identifiers.

`ORMChat` stores chat metadata in `chats`:

- `id`
- `user_id`
- `anima_id`
- title
- `api_standard`, nullable. This is the chat transcript compatibility key.
  Current reset-era values are `chat_completions` and `responses`.
- `last_model_client`, nullable. This records the model-client profile from the
  latest successful durable `chat:sse` turn, currently
  `openai_chat_completions` or `openai_responses`.
- `last_model_id`, nullable. This records the catalog model slug from the
  latest successful durable `chat:sse` turn.
- metadata JSON
- `metadata.memory_context`, a direct-chat manifest recording the latest opened
  memory file fingerprints for the chat. The manifest includes opened `path`,
  nullable `anima_id`, status (`opened`, `current`, or `refreshed`), version,
  SHA-256, kind, the
  `disable_memory_influence` flag, run metadata, and the message turns
  persisted for the run. These fingerprints are persisted metadata used for
  freshness and diagnostics, not prompt instruction text.
- `openai_previous_response_id`, the latest OpenAI Responses API cursor for
  providers that continue chat state with `previous_response_id`; normal
  `OpenAIResponsesHTTPAgent` turns advance this from the final assistant
  message's compact `message_data.openai.response_id`
- created/updated timestamps
- cumulative usage counters: `cum_input_tokens`, `cum_output_tokens`,
  `cum_total_tokens`, `cum_cached_input_tokens`, and
  `cum_output_reasoning_tokens`
- `active_context_tokens`, copied from the latest normal assistant message usage
  `total_tokens` minus output reasoning tokens for active-context trigger
  decisions
- `next_turn`, the next per-chat `chat_messages.turn` value to reserve

The compatibility columns remain nullable because `/v1/chats` may create an
empty chat before a model provider is selected. `ChatManager` writes
`api_standard` when `chat:sse` creates a missing chat row, initializes it on an
empty pre-created row, allows later model switches only when the stored
`api_standard` matches the selected provider's `api_standard`, and rejects
non-empty null-standard chats as invalid reset-era state. Successful
non-incognito turns update `last_model_client` and `last_model_id` together
with usage totals and turn reservation. The frozen baseline includes these
columns; it does not backfill legacy databases.

`ORMChatMessage` stores persisted messages in `chat_messages`:

- required `chat_id` foreign key to `chats.id`
- `run_id`
- `message_type`
- role/content/message data. Normal visible roles are `user` and `assistant`;
  internal direct-memory tool result rows use role `tool`. Direct-chat
  assistant `content` stores the raw structured model response JSON, while
  public history routes project it back to display or speech text.
- nullable `raw_provider_message`, the Chat Completions-style message object
  used for next-turn replay. User rows store user messages, final assistant
  rows store raw assistant content, internal assistant rows store `tool_calls`,
  and internal tool rows store `tool_call_id` plus tool output.
- optional `model_provider` and `model` snapshot for provider-generated rows;
  when both are set, they reference `model_providers(provider_type, model)`.
  User messages and non-provider rows intentionally keep these fields null.
- `message_data.structured`, the parsed direct-chat structured response used by
  history readers, search, emotion updates, gesture requests, and TTS
- `message_data.model_client`, the provider-neutral metadata envelope for the
  visible assistant row. It records the provider type, selected
  `model_provider_id`, and JSON-safe `raw_provider_metadata` from the final
  model-client result.
- `message_data.model_client.raw_provider_metadata.stream_event_summary`, when
  present, stores compact sanitized model-client stream observations: event
  counts, finish reasons, usage visibility, terminal events, assistant phases,
  output item summaries, native hosted tool summaries, unknown-event counts, and
  warnings. Raw provider stream event payloads are not stored here.
- `message_data.openai`, present for OpenAI Responses assistant rows with a
  final response ID, stores compact continuation and replay metadata such as
  provider, API, model, `response_id`, request `previous_response_id`, output
  item IDs, assistant `phase`/`phase_counts`, `message_phases`, annotations,
  native tool summaries, unknown output item types, and
  `stream_event_summary`.
- legacy/debug paths may contain `message_data.raw_response`; normal
  chat-history responses remove raw-provider details before returning messages
  to clients
- per-message usage counters
- optional `turn`, populated by normal chat persistence as a per-chat message
  ordinal starting at `1`
- `internal`, used for backend-only rows such as compaction context and direct
  memory tool call/result records
- `created_at`

Chat message search stores a generated `search_vector` column computed from
structured speech and display text concatenated together, falling back to raw
`content` when neither structured field is available. Search-result snippets
use the same combined user-facing text. This keeps search user-facing even
though raw assistant content is durable JSON. A partial PostgreSQL GIN index
covers that vector only for visible user/assistant rows with non-null content.
The search API builds a
sanitized prefix `to_tsquery` from alphanumeric terms, so partial terms such as
`Reac` can match `React` without interpreting web-search operators such as
quoted phrases, `OR`, or negation. The API joins messages through `chats` and
`anima`, so result rows remain scoped to the current request principal and can
include anima display
metadata such as `profile_picture_url`. Matching messages are collapsed to one
result per chat; the best matching visible message supplies the snippet and
score.

`ORMChatCompaction` stores hidden continuity summaries in `chat_compactions`.
Rows are separate from the visible transcript and include:

- `chat_id`, `user_id`, and `anima_id`
- status (`active`, `superseded`, or `failed`)
- `summary_text`
- covered turn boundaries (`start_turn` and `end_turn`)
- `source_message_count`
- compaction model/provider/prompt fields
- actual compaction model usage counters when available
- metadata JSON for threshold, preserved-message count, and trigger token count

The active compaction row is hidden continuity context for the next direct chat
turn. It is selected by `ChatManager` and injected before recent exact messages;
it is not exposed as a normal chat message.

`chat_messages` does not require `session_id`, and normal avatar chat does not
create `agent_sessions` rows. The ORM package import registers `chats`,
`chat_messages`, and `chat_compactions` in fresh metadata and does not register
the legacy `conversations`, `agent_sessions`, `agent_messages`, or `agent`
tables.

`ChatManager` is the normal direct-chat persistence service. It verifies or
creates the owned chat for the current user/anima, fetches visible chat
history plus any active compaction summary for each turn, records user and
assistant messages with incrementing per-chat `turn` values, and increments chat
usage totals in the same unit of work as message persistence. Non-incognito
direct-chat turns also merge the latest memory-context manifest into chat
metadata in that transaction. Incognito turns skip durable message writes, chat
usage updates, and chat metadata updates.
Providers return text, usage, tool-call metadata, and structured data; they
should not create chats or write messages directly.

When a provider returns multiple assistant rows for one turn,
`ChatManager` persists them in reserved turn order. For
`OpenAIResponsesHTTPAgent`, only the final payload that should advance the
OpenAI cursor is authoritative for `chats.openai_previous_response_id`; voice
split display rows should not duplicate full raw provider payloads.

Internal or backend-maintenance output is represented as
`chat_messages.internal = true`. `/v1/chats/{chat_id}/messages` hides internal
rows by default and exposes them only with `include_internal=true`.

### Settings

Settings models store user-level settings and anima-level settings. Anima
settings affect dispatch behavior, including memory influence, memory updates,
emotional analysis, and presentation flags for animation or visual effects.

### Avatar And Uploads

`ORMAvatar` stores Avatar metadata, catalog association, and the shared markdown
`identity` template used as optional creation assistance or a one-time legacy
seed. Avatar `name` remains globally unique but is not a live Anima's display
name. Avatars can be
public catalog avatars or private user avatars.

`catalog_item_id` associates a private Avatar with one validated Local model.
Included Avatar `file_path` values are matched to the corresponding Included
catalog locator. Anima Avatar/loadout choices resolve through catalog items;
there is no Avatar release pin.

Profile/background Appearance choices and Included Avatar portraits are normal
Appearance catalog entries. `ORMAnimaContentBinding` stores their logical
selection and crop/focal configuration. These bindings and the Avatar catalog
model contribute to exact runtime snapshots; presentation changes advance the
Avatar presentation revision without creating a content release.

`ORMAvatarUpload` is the retained staging record for non-content workflows such
as:

- `avatar_vrm`
- `pocket_voice_catalog`

Upload rows include owner, status, opaque local storage locator, file metadata, expiration, and
cleanup state. Valid statuses include `pending`, `finalized`, `aborted`,
`expired`, and `cleanup_pending`.

### User File

`ORMUserFile` stores owner-scoped original file upload metadata for the local
private-file lifecycle. Rows are scoped by the retained `user_id` ownership column and use
backend-generated opaque locators of the form
`user-files/{user_id}/{file_id}/original`, resolved only beneath `data/`.

Fields include:

- opaque local storage locator and display-only original filename
- normalized extension
- declared and detected content type
- declared and stored byte size
- optional SHA-256 placeholder for later processing
- status, upload expiration, processing timestamp, last error, and metadata JSON

Valid statuses are `pending_upload`, `uploaded`, `processing`, `ready`,
`ready_keyword_only`, `aborted`, `failed`, `delete_pending`, and `deleted`.
Current APIs list only non-`deleted` files for the resolved request principal.

`ORMUserFileProcessingJob` is the durable Postgres-backed processing queue. Jobs
store `file_id`, `user_id`, `queued`/`running`/terminal status, attempts,
`run_after`, lease fields, timestamps, last error, and metadata. Parser workers
claim jobs with row leases and retry failed conversions up to the configured max
attempts.

`ORMUserFileChunk` stores searchable chunks extracted from uploaded files.
Chunks denormalize `user_id`, keep deterministic `chunk_index` per file, store
text, optional pgvector embedding, character/token estimates, metadata, and
timestamps. A unique `(file_id, chunk_index)` constraint makes reprocessing
replacement idempotent. Keyword search uses PostgreSQL full-text search over
chunk text; semantic search uses chunk embeddings when available.

For Docling-parsed formats, chunk metadata is compacted before persistence.
Stable metadata keys are `parser`, `chunker`, `headings`, `captions`, `origin`,
`doc_items`, `doc_item_count`, and `token_count`. `doc_items` stores a bounded
summary of source item refs/labels/text/page hints, while `doc_item_count`
records the original Docling item count. Docling's contextualized embedding
text is transient worker data; it is not stored in `ORMUserFileChunk`.

The original-file, chunk, and queue tables are part of the accountless Alembic
baseline. Disabling or removing the desktop document pack retains those rows.
Queued work resumes when a worker returns; live running leases block removal.

`ORMRuntimeWorkerHeartbeat` stores one row per worker kind, with `instance_id`
and UTC `heartbeat_at`. The document worker upserts its liveness every five
seconds and renews only running jobs with its own `locked_by`. Shutdown clears
only its own instance's heartbeat, so an older worker cannot erase replacement
liveness. No provider key, process path, or local account is stored here.
The public capability endpoint compares the expected instance and uses a
twenty-second freshness threshold; queue leases retain their separate timeout.

### Archive

Archive models store anima archive metadata and passages. Passage search can
use embeddings when the database/provider stack is configured for it. Archive
data is distinct from the retired block memory system and from the planned
memory filesystem.

## Repository And Mapper Pattern

Adapters under `adapters/repositories/` implement repository ports using
SQLAlchemy sessions. Mappers under `adapters/mappers/` convert between ORM rows,
domain dataclasses, and API schemas.

New persistence behavior should usually follow this path:

```text
router schema -> app service -> repository port -> SQLAlchemy adapter -> ORM
```

Use direct ORM access only when maintaining an existing legacy route path and the
change is intentionally local.

## Session And Transaction Scope

HTTP routes that depend on `get_async_session()` get a request-scoped
`AsyncSession`. Application services commit through `SQLAlchemyUnitOfWork` when
they complete a unit of work. Direct chat keeps its database session
request-local and closes it when the SSE stream completes, is cancelled, or
fails. Shared model clients must not retain request sessions.

Background workers create their own engines/session factories and open a fresh
database session per job instead of retaining FastAPI request sessions.

## Ownership And Access

Most owner-scoped rows include `user_id` and should be filtered by the current
`RequestPrincipal`. Avatar rows can be built-in catalog entries or private typed
Avatars. Catalog access uses explicit Included, owner, or installation-shared
scope. Staged uploads must be checked against row ownership, configured root
containment, exact size, and digest before promotion.

## JSON Metadata

Several models store flexible metadata JSON. Use named constants and mappers
where available instead of scattering string keys through route handlers.
Content metadata may contain portable type-specific configuration and safe
provenance; it must not contain absolute paths or delivery capabilities.
Normal `chat:sse` does not read legacy `runtime_graph`, `chat_runtime`, or
`metadata.direct_chat` metadata.
