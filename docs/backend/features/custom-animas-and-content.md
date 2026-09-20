# Custom Animas And Content

An Anima combines private identity/chat state with logical selections from the
neutral Content Catalog. Its loadout may select an Avatar, Gestures, Reactions,
an emotion-aware Idle Style, Music, and Appearance. Gesture and Reaction roots
bring their required VFX and Sound dependencies with them; users do not equip
those supports independently.

A Gesture requires a stable semantic selector and AI-facing description because
the chat model may choose it. A Reaction document carries a suggested
emotion/intensity placement, while the Anima loadout may assign that complete
Reaction Action to any canonical cell. Both can use `animaPoseClip/1.0`;
Gestures may also use VRMA. Event-only clips are valid, but a clip with neither
a pose keyframe nor an event is not.

Creator Save writes the ordinary Local source through its typed product route,
such as `PUT /v1/gestures/{entry_name}` or
`PUT /v1/reactions/{entry_name}`. The kind handler strictly validates the same
document used by scan, Preview, runtime, and packages. Typed Preview freezes
the dependency-complete current revision without changing an Anima.

Loadout mutation is a reviewed, family-specific command. The client posts an
intent and expected revision to `/v1/animas/{anima_id}/{family}:plan`, then
commits that exact plan digest with an idempotency key to the matching
`:commit` endpoint. Direct Pose Clip, VFX, and SFX equipment is invalid; those
items remain catalog content reached through a Gesture or Reaction.
The digest includes the Anima's aggregate revision as well as the loadout and
source revisions: a concurrent name or identity edit invalidates a reviewed
equipment plan. Each successful equipment edit advances aggregate and loadout
revision once; an idempotent replay advances neither.

`GET /v1/animas/{anima_id}/runtime` resolves those logical selections to one
exact internal revision. Handler-owned projectors produce the typed runtime
entries after the generic closure compiler validates graph membership and
files. The service independently omits broken optional roots while keeping
text chat available. `chat:sse` requires the issued revision. Save, filesystem
edits, Rescan, and Equip therefore take effect on the next mount rather than
mid-conversation.

## Live Anima definition

An Anima owns its stable `display_name`, positive `aggregate_revision`, and
SQL-backed virtual `IDENTITY.md` (`kind=anima_identity`). The identity body and
its append-only history remain in `memory_entries`/`memory_entry_versions`.
`anima_definition_revisions` records the name, identity entry/version pointer,
actor, reason, and timestamp without copying the identity body. Chat and
presentation use the live name and identity, never continuing Avatar fallbacks.

`AnimaAggregateMaterializer.materialize` accepts an internal `ResolvedAnimaSpec`
and authenticated owner through one caller-owned `AnimaAggregateUnitOfWork`.
It associates the logical Avatar, writes identity/history, defaults/settings,
chat profile, and exact typed selections through `AnimaLoadoutService.initialize`.
Aggregate, identity, and loadout revisions start at 1. It never commits,
contacts a provider, writes files, or issues runtime. The configured active
model row is checked locally; default ElevenLabs voice is `gJx1vCzNCD1EQHT212Ls`.
Idle starts empty, emotion is neutral, and there is
no Music/typed Voice binding, archive, chat, greeting, or relationship memory.
An explicit validated internal voice choice can replace that default.

Direct creation and backend starter provisioning use this materializer through
the strict creation service below. `/a/animas/new` uses the four-step live
creator and submits the complete reviewed spec through `POST /v1/animas`.

New creation materializes the selected identity into the Anima's own memory
entry. Missing or blank identity requires explicit repair before chat can invoke
a model. The baseline creates this schema directly and provides no
identity backfill for databases outside its supported revision graph.

Explicit identity edits/reverts require both the memory version and aggregate
revision. Name edits advance the aggregate only; Avatar/Appearance/loadout
edits advance aggregate and loadout once. Chat, emotion, relationship memory,
model selection, and unrelated settings do not advance the definition.
Required identity files cannot be renamed, moved, deleted, or AI-undone.
Avatar, Appearance, and support content with live bindings/dependency references
cannot be deleted through the content API; confirmed My Content is not deleted
when an Anima is removed. External file changes may break the next runtime
mount, but cannot change the live name or identity.

## Strict private creation

The [four-step browser creator](../../frontend/features/custom-anima-creation.md)
consumes the current [HTTP creation contract](../architecture/http-api.md#strict-private-creation).
Authenticated
`GET /v1/animas/creation-options` returns policy-derived recommendations/counts,
limits, diagnostics, and source revision evidence. The nullable `default_idle`
response contains `source: null` and an empty revision map.
`POST /v1/animas:validate` validates a whole `AnimaSpec` without writes.
`POST /v1/animas` accepts that spec plus a body `idempotency_key`; the old
Avatar-only direct request is rejected. The browser freezes and durably saves
this exact request before dispatch and restores unknown outcomes before
revalidating mutable sources.

The strict command creates one private live Anima, never a content item.
It includes a required stable display name and Markdown identity, one typed
Avatar, optional profile/background Appearance, exact Gesture selections, all
72 explicit Reaction cells, the versioned Recommended Starter Pack identity,
and `expected_source_revisions`. Every selected root and
transitive support is present in that map with kind and SHA-256 revision.
Zero Gestures/all-empty Reactions are valid with warnings. Invalid selected
content blocks creation instead of using runtime's optional-root omission.
New creation and explicit live-Anima rename accept 1–40 Unicode code points.
The wider 120-character persistence columns remain unchanged so a legacy long
name stays readable and survives unrelated edits until its owner explicitly
renames it. The browser creator does not configure Appearance: it submits
`profile: null` and `background: null`, while these strict typed fields remain
available to other reviewed backend consumers.

The owner comes from authentication. `AnimaCreationService` writes the
idempotency receipt in the same caller-owned transaction as the materialized
Anima, name/identity history, settings, chat profile, and typed loadout. Catalog
rows and the active model are locked for creation; exact membership, access,
typed semantics, budgets, revisions, and verified source bytes are rechecked
after the receipt write. Validation does not Rescan or mark catalog rows.
`IDENTITY.md` remains a SQL-backed virtual memory entry;
there is no physical identity projection. The materializer never commits
independently. Default model selection validates the configured active local
row; default ElevenLabs voice `gJx1vCzNCD1EQHT212Ls` is assigned without a
provider request. Idle and Music are empty,
emotion is neutral, and no Chat row or greeting is created.

An owner-scoped body idempotency key binds only after successful commit.
Identical replay resolves before current-source/default validation; changed
input conflicts, deleted results return 410, and precommit failure leaves no
receipt or partial aggregate. Successful receipts/deletion tombstones remain
for the owner's lifetime. Runtime issue/preparation is a separate post-commit
step, so a mount failure cannot create another Anima.

Review evidence uses a bounded number of requests without weakening those
guards. `POST /v1/content/evidence:resolve` resolves every selected root against one visible catalog snapshot and returns the
complete revision union without files or database writes. The browser rejects
partial results and still calls whole-spec validation; final creation
re-resolves and rechecks the same exact revisions authoritatively.

The separate `POST /v1/content/previews:prepare` operation is only for
playback consumers such as edited Action dependencies. It can issue one
short-lived capability for several overlapping roots, but it cannot create,
validate, equip, or mutate an Anima.

Backend-owned `StarterAnimaSpec` values `starter:annie` and `starter:caitlyn`
use the same private command through `POST /v1/animas/starters:ensure` with
`{"schema_version":1,"repairs":[]}`. Each starter commits independently, so
retry retains the first result if the second fails. Spec version is metadata,
not the stable owner/starter identity. Successful or deleted slots are never
rewritten by a later spec version.

Current defaults are Annie version 1 (`AvatarSample_A_1_New`) and Caitlyn
version 3 (`AvatarSample_R1`, the model associated with Janna), with matching
Included portraits when available. This corrects the earlier R2 selection.
Caitlyn's replacement applies only to new/missing slots explicitly created by
the service; existing Animas, identities, ownership and ready/deleted receipts
are preserved. Her historical `avt_chibi_2` adoption identifier still identifies
old data, not the current model. Desktop staging excludes both that former
Chibi 2 model and the mistaken R2 replacement, together with their derived
portraits, from both distribution partitions through the Included license
inventory. Existing development profiles that still reference either excluded
model need an explicit content replacement; preserving receipts does not ship
the removed bytes in a new bundle.

The owner also excluded downloaded voice samples, Tokyo backgrounds/thumbnails,
and BGM examples/metadata from both desktop partitions on 2026-09-02. Those
examples remain in the private development checkout, but are not mounted as
Included desktop content. Starter portraits and speech-engine assets remain
available, and Local imports still work. An existing development Anima using an
excluded example needs explicit replacement or removal of that binding before
moving to the new bundle; staging never rewrites owner data to hide missing bytes.

Accountless installation bootstrap calls the owner-scoped ensure command
without explicit repairs. Earlier account-based migration/bulk-caller behavior
is historical; it is not part of current first-run setup. Automatic
adoption requires exactly one original Avatar/profile/identity-seed-history
match; it preserves subsequent customization. Missing, partial, or ambiguous
legacy evidence returns `repair_required`, never automatic recreation. Explicit
`adopt` or `create_missing` repairs apply only to those recorded unresolved slots.
Intentional deletion remains a tombstone. Receipt tables retain owner columns
without Better Auth foreign keys and have no live-Anima foreign key, so deleted
result IDs survive.

## Confirmed Avatar and Appearance content

Typed Avatar Save and scanning use the shared strong, self-contained GLB/VRM
validator for VRM 0.0/1.0, with a 100 MiB source limit. Identical model bytes
reuse only a valid caller-owned Local Avatar, preferring the requested path
then stable item ID; existing metadata is not overwritten. Included and other
owners' entries are never reuse candidates. Different-byte name collisions
require explicit rename or revision-checked replace. `creation_context=true`
forbids replacing an Avatar used by a live Anima.

Appearance Save accepts static PNG/JPEG/WebP up to 16 MiB, 8192 pixels on either
side, and 40 million decoded pixels. It rejects animation, SVG, corrupt bytes,
and misleading MIME types, then uses the existing canonical WebP pipeline.
Profile/background framing remains explicit `fit`, focal coordinates, and zoom;
null background creates no binding. `PUT /v1/avatar-content/{item_id}/portrait`
accepts a confirmed 512-square WebP capture and the expected Avatar revision,
producing a normal owner-scoped 256-square Appearance of at most 256 KiB.
The typed portrait endpoint and Appearance management remain available outside
the Create Anima flow. That flow does not offer capture, crop, upload or
background controls; existing content and live bindings remain available.
Confirmed Saves survive cancellation and failed creation, and neither Save nor
creation calls a provider.

## Local creation boundary

Create Anima creates a live companion with editable dependencies. It never
creates, saves or synchronizes an Anima Blueprint. There is no “Save as Blueprint”
action or editable Local Blueprint; the reserved Anima content handler remains
unsupported. Discover and publishing are discontinued. Existing typed `.animama`
import/export remains independent of live Anima creation.
