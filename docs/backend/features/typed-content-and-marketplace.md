# Typed Content and Local Packages

Animama models runtime media as concrete product types: Avatars, Gestures,
Reactions, Particle Effects, Avatar Effects, Scene Effects, Sound Effects, Idle
Styles, Appearance Images, voices, and static Poses. All types
share one neutral Content Catalog while keeping strict versioned documents,
handlers, APIs, and runtime projectors. The `anima` catalog kind is
reserved and rejecting; live Animas are private application aggregates, not
catalog items. Blueprint is not an admitted catalog kind.

## Editable catalog model

Included and Local files are indexed by `content_catalog_items`,
`content_catalog_files`, and `content_catalog_dependencies`. `source` is
`included` or `local`; access scope is a separate field. Creator Save edits an
ordinary Local file or entry-named descriptor directly and records a new
catalog revision. It does not create an immutable release.

Simple leaf entries may stand alone, such as `.vrm`, audio, or self-describing
JSON. Gesture and Reaction creator output always uses an Action folder:
`<entry>.meta.json` is the typed product document and `<entry>.json` or
`<entry>.vrma` is the playable Pose Clip or animation. Action-owned Pose Clips
are files, not separate catalog dependencies. Action documents can declare exact logical
dependencies on independently reusable Particle, Avatar, and Scene Effects
plus Sounds. The runtime compiler resolves the complete closure and rejects
missing, wrong-kind, ambiguous, cyclic, or over-budget roots.

The catalog persists generic identity, file/digest registrations, normalized
dependency edges, status, provenance, and a bounded search projection. Product
meaning is parsed into framework-neutral `*DocumentV1` values by the closed
typed-handler registry; application services do not interpret arbitrary
catalog metadata dictionaries. Scan, Save, manual admission, Preview, runtime,
export, and import all call the same handler for a kind.

Included content follows the same catalog contract but is read-only and
ownerless. There is no separate code-shipped runtime catalog for playable
bytes. Browser-engine/application resources remain outside typed content where
appropriate. When an application update removes an Included item, reconciliation
retains an internal missing tombstone for stable identity but does not expose it
as a user-repairable Library item or content-health issue.

Music and standalone catalog Pose Clips are retained only for local recovery.
Startup and Rescan convert referenced clips into Action-owned files and remove
active Music bindings, retaining source originals and prior binding evidence
under private operation storage. Retired rows cannot be selected, previewed,
newly saved, packaged or admitted to runtime. Exact completed Save/import and Music equipment-commit retries
replay their stored result; no legacy package migration is supported. Static
Poses, Action clip JSON and TTS/SFX remain supported.

## Product APIs

The infrastructure surface remains neutral:

```text
GET    /v1/content/catalog
GET    /v1/content/items/{item_id}
POST   /v1/content:rescan
DELETE /v1/content/items/{item_id}
GET    /v1/content/files/{file_ref}
```

Product List/Get/Save/Preview uses one typed route family for each admitted
kind:

```text
GET    /v1/{typed-family}
GET    /v1/{typed-family}/{item_id}
PUT    /v1/{typed-family}/{entry_name}
POST   /v1/{typed-family}/{item_id}:preview
```

The family response is a generated discriminated contract such as
`PyGesture`, `PyReaction`, `PyPose`, `PyParticleEffect`, or `PyIdleStyle`,
not a semantic `metadata` dictionary. Typed routers delegate
safe paths, optimistic catalog revisions, atomic replacement, reconciliation,
and preview freezing to shared catalog services; they do not own parallel
release/upload persistence. Browser history and request bodies never carry
host paths or delivery capabilities.

Typed Preview file descriptors carry two deliberately different identities:
an opaque `file_ref` authorizes delivery, while `logical_path` is the portable,
item-relative name used inside manifests and effect definitions (for example
`textures/heart.png`). The API never exposes the host path. A preview closure
keeps both values for every root and support file so the frontend can resolve
nested VFX/SFX resources without guessing from closure-wide ordinals or
duplicate basenames.

Avatar and Scene Effect definitions contain bounded renderer configuration and
logical local filenames only. External/data/Blob URLs, scripts, shaders, and
arbitrary model selectors are rejected. A parent action's reference map binds
local event aliases to resolved support items so similarly named resources
cannot be substituted globally.

## Anima loadout and runtime

`GET /v1/animas/{anima_id}/loadout` returns the typed aggregate. Each family
changes through `POST /v1/animas/{anima_id}/{family}:plan` and its matching
`:commit`, with an expected revision, reviewed plan digest, and idempotency
key. Gesture semantic keys are unique. Each Reaction binding occupies one
canonical emotion/intensity cell, but any Reaction Action may be assigned to
any cell. A Reaction descriptor may omit `placement_hint`; when present, it must
supply both a tracked emotion and intensity 1, 2, or 3. This is only a suggested
default: saving, previewing and packaging do not require it, while equipping
still requires a canonical cell. Unplaced typed responses have null `emotion`
and `intensity`. Idle Style is singular with bounded pools; Avatar, Appearance,
and voice keep focused selection rules. Effects and Sounds remain
compiler-managed dependencies rather than independent Anima equipment.

`GET /v1/animas/{anima_id}/runtime` compiles current selections into an exact
internal runtime revision with a complete bounded map of admitted catalog-item
revisions and canonical catalog file descriptors. Chat requests carry that
revision so AI-visible Gesture selectors and frontend playback cannot drift
during one mount. Runtime delivery authorizes each canonical file through its
pinned parent item without per-snapshot file rows. A later Save or Equip is
adopted only after remount.

## Local package boundary

Packages use the strict `animama-content-package/3` manifest in local `.zip`
files. Content export accepts one or more Avatars, Gestures, Reactions, Idle
Styles, static Poses, effects or Sounds and includes their complete required
closure. Avatar portraits and selected Anima profile/background images travel
as associated Appearance content; Appearance is not a standalone export root.
Music and standalone catalog Clips are not package types. Voice is allowed only
as the active saved PocketTTS clone referenced by a complete Anima.

An Anima export reads the saved name, full identity, Avatar, effective Gesture
selections and semantic keys, all 72 Reaction cells (including empty cells),
nullable Idle Style, and profile/background images with framing. Supported
binding configuration and effective starter choices are preserved. Missing
selected content or unsupported configuration fails export rather than silently
changing the definition. Conversations, identity history, other memories,
private uploads, model/provider settings and voice preferences are excluded.
Import creates a new private Anima using the receiver's defaults for those settings.
The exception is an active saved PocketTTS clone: its encoded neutral catalog is
bundled without the original recording, installed as an independent Local Voice
and selected with fresh PocketTTS preferences. Presets, inactive clones and
ElevenLabs IDs do not travel. The `animama/pocket-voice/1` capability requires
validated binary contents; standalone Voice entries and raw recordings reject.
A Gesture or Reaction clip requires the capability named by its schema,
`animaPoseClip/1.0` or `animaPoseClip/2.0`, plus each built-in Pose it
references (a 2.0 clip references only its base pose). A reader without a
required capability rejects the package.
Effective provider changes invalidate a pending export review.

Export summary resolves source revisions and saved facts; preparation requires
the returned digest and rechecks them before sealing the reviewed archive.
The writer and reader share strict manifest, capability, typed-content and
runtime-budget validation. Portable entry references carry no owner, catalog,
file-delivery or host-path authority.

Import reviews the whole package and allocates fresh identities for every entry,
including dependencies already present with identical bytes. Names use automatic
`-2`, `-3` suffixes when needed, including collisions with Included content.
Commit rechecks the sealed bytes, destinations and receiver prerequisites,
then installs all files, catalog rows and any Anima aggregate in one recoverable
operation. A changed destination requires a fresh review; import never replaces
an existing item or installs only part of the package. License and provenance
facts accompany the independent editable copies.

Resource filenames inside a content directory stay unchanged so embedded image
and texture references remain valid when the containing item receives a collision
suffix. Avatar imports also register the logical model used by Library and Anima
creation, even for content-only packages. Deleting an unused Local model removes
that mapping; an Anima using the model still blocks deletion.

See the [package HTTP contract](../architecture/http-api.md#package-sharing) for
routes, limits and receipt recovery, and [Library sharing](../../frontend/features/library.md#import--export)
for the user workflow. Package manifests exist only at the sharing boundary,
not in everyday Local folders.
