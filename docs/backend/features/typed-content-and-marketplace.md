# Typed Content and Local Packages

Animama models runtime media as concrete product types: Avatars, Gestures,
Reactions, Particle Effects, Avatar Effects, Scene Effects, Sound Effects, Idle
Styles, Music Tracks, Appearance Images, voices, Poses, and Pose Clips. All types
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
are files, not separate catalog dependencies. Only intentionally reusable Pose
Clips remain under `pose-clips/`. Action documents can declare exact logical
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

## Product APIs

The infrastructure surface remains neutral:

```text
GET    /v1/content/catalog
GET    /v1/content/items/{item_id}
POST   /v1/content:rescan
DELETE /v1/content/items/{item_id}
POST   /v1/content/items/{item_id}:export
POST   /v1/content/packages:import
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
`PyGesture`, `PyReaction`, `PyPose`, `PyParticleEffect`, `PyIdleStyle`, or
`PyMusicTrack`, not a semantic `metadata` dictionary. Typed routers delegate
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
and `intensity`. Idle
Style is singular with bounded pools, Music has no duplicate item and at most
one autoplay track, and Avatar, Appearance, and voice keep focused selection
rules. Effects, Sounds, and Pose Clips remain
compiler-managed dependencies rather than independent Anima equipment.

`GET /v1/animas/{anima_id}/runtime` compiles current selections into an exact
internal runtime revision with a complete bounded map of admitted catalog-item
revisions and canonical catalog file descriptors. Chat requests carry that
revision so AI-visible Gesture selectors and frontend playback cannot drift
during one mount. Runtime delivery authorizes each canonical file through its
pinned parent item without per-snapshot file rows. A later Save or Equip is
adopted only after remount.

## Local package boundary

Export validates the current exact root and closure, canonicalizes typed
documents through their handlers, rewrites installation-local references, and
generates a deterministic version-2 package only at that boundary. Import
validates every member and dependency before reserving destinations and
promoting the closure as one journaled, recoverable operation. A collision
drift or late failure exposes no partial Local item. Package manifests do not
clutter everyday Local folders.

Packages use `animama-content-package/2` in `.animama` files. Import/export runs
locally and supports catalog content only;
[live Animas](custom-animas-and-content.md#strict-private-creation) cannot be packaged.
