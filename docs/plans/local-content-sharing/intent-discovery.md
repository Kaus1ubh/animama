# Local content sharing: discovery notes

Status: discovery complete, 2026-09-23. Temporary decision/evidence record for
the future specification and ExecPlan; not an approved specification or
authorization to implement product changes. The consolidated handoff is
[discovery-brief.md](discovery-brief.md). Keep accepted decisions separate from
implementation proposals when authoring the specification.

The [specification draft](local-content-sharing-spec.md) consolidates this record.
Use it for subsequent requirement review; retain these notes as decision history.

Research baseline: `98220eae162651207960ffa9657aa54581a80265`.
Task branch: `feat/local-content-sharing`, created at the assigned worktree's
existing clean, detached HEAD. No stack was started or application data inspected.

## Problem and intended outcome

Animama users should exchange local `.animama` files containing one content item,
multiple content items, or one complete Anima with its required content. All
implementation belongs to Animama. Hosted publishing, discovery, accounts,
content distribution services and hosted content storage are outside this work.
The retired Discover proposal is historical context only.

## Agreed scope from the owner's 2026-09-23 request

- Use Import and Export labels, reuse existing package infrastructure, and
  automatically include required dependencies.
- Import the whole reviewed package. Do not offer selection of individual roots
  or partial Anima installation in this version.
- The owner reports there are no old packages to preserve. Backward package
  compatibility and legacy-package conversion are not required. This does not
  waive preservation of existing local Gestures/Reactions or source files.
- On import name collisions, keep existing items and automatically suffix the
  new names without parentheses. Use `arms-crossed-2`, `arms-crossed-3`, etc.
  as the proposed concrete spelling; the owner selected suffixes without
  parentheses, not a specific separator. Show resolved names before import.
- Each import creates independent editable dependency copies, deduplicated
  within that import. Do not silently reuse matching mutable items from an
  existing library. Shared dependencies within the imported set remain shared.
- Remove Music/BGM playback, equipment and controls and retire its supported
  content type. The owner accepted removal in response to the proposal to keep
  existing audio source files untouched on disk. Do not automatically delete
  those files or relabel them as SFX. No database/profile reset is authorized.
- Defer Voice integration: do not expand catalog Voice support or include Voice
  integration in this work. Existing TTS functionality remains.
- Remove standalone Pose Clips as a catalog type. Preserve the `animaPoseClip`
  animation format, Action-owned clips inside Gestures/Reactions, and Creator
  JSON import/export. Downloading raw Clip JSON remains a separate operation.
  Preserve existing Gestures/Reactions that depend on standalone clips by
  converting their referenced clips into Action-owned content, including their
  sound/effect dependencies. Original files are retained; precise local-content
  conversion must be defined without discarding required content.
- Bundle an Avatar's default portrait when sharing the Avatar. Bundle an Anima's
  selected profile/background images when sharing the Anima; these remain
  independent of the Avatar model. Image storage and the Appearance catalog type
  are not slated for removal or redesign. Images travel only by automatic
  bundling in this sharing UI; no standalone Appearance selection/export is
  added. Existing image management remains intact.
- Define an Idle Style as pools of existing Gestures mapped to separate
  emotion/intensity cells. Both VRMA-backed and `animaPoseClip`-backed Gesture
  implementations are supported. Idle membership does not equip a Gesture for
  AI invocation.
- The Idle Style owns all its pools and emotion/intensity assignments. An Anima
  equips a Style, without a separate per-Anima pool override layer. Shared Style
  edits affect its users on the next runtime refresh. For an individual variation,
  duplicate/customize the Style and equip the copy. Preserve existing overridden
  configurations through conversion rather than silently discard them.
- Neutral uses the Default idle pool. Unconfigured emotion/intensity cells
  inherit Default; each cell can explicitly choose No idle. Empty Default means
  no scheduled idle Gesture. Procedural breathing/resting remains unaffected.
- Idle use retains the Gesture's authored sound and visual-effect events. The
  owner confirmed complete Gesture behavior in interview round 2; authors can
  select quiet animations for idle pools.
- Preserve the supplied UI mockups and use them as reference in the future spec
  and ExecPlan. Screenshots are visual reference material, not an independent
  source of behavioral requirements or instructions.

## Confirmed complete-Anima boundary

A complete Anima import creates a fresh companion from reviewed name,
identity/personality text, equipment and supported configuration. It excludes
private chats, relationship memories, attachments, credentials, identity history
and source installation identity. Provider/device settings and Voice integration
do not travel. This is sharing, not a full installation backup.
The owner explicitly confirmed this boundary in interview round 1.

## UI reference files

The original user-supplied PNGs were copied without modification and checked
against their source SHA-256 values. Keep these direct files beside the plans;
nested evidence directories are ignored by repository policy.

- [Entry modal](reference-01-import-export-entry.png): combined Library
  Import / Export entry, file drop/picker, and content/Anima export choices.
- [Import review](reference-02-review-import.png): selected roots, expandable
  required items, collision explanation and final import action.
- [Export selection](reference-03-export-selection.png): Content/Anima tabs,
  searchable selection list and package summary with automatic dependencies.

Future `local-content-sharing-spec.md` and
`local-content-sharing-execplan.md` must link these files explicitly. The images
do not decide unresolved idle semantics, missing content categories, Anima
review details or compatibility behavior. The owner has since selected automatic
keep-both naming without parentheses; the screenshot's parenthesized example
must follow that decision instead. A collision-policy dropdown is not required
by the current agreement.

## Current source evidence

- `ContentPackageService` exports one root and its dependency closure using
  `animama-content-package/2`; it rejects live Anima roots. Multi-root packages
  and Anima materialization require deliberate contract changes.
- `LocalContentMutations` coordinates file journals, catalog publication and
  durable retry receipts. New package installation should retain this authority.
- Live Animas are separate private aggregates with logical content bindings.
  Their portable definition must not be a database dump or an unmodified
  serialization of the installation-local creation request.
- Current Library has no package controls or content selection. It omits several
  catalog families and contains private Chat Uploads, which are not catalog
  content and must not enter sharing selections.
- Package license validation checks bounded metadata structure, not sharing
  entitlement. Preserve per-item attribution/provenance; final review behavior
  still needs specification.

Source entrypoints:

- `src/backend/animama/app/services/content_package_service.py`
- `src/backend/animama/app/services/local_content_mutations.py`
- `src/backend/animama/domain/anima_creation.py`
- `src/backend/animama/domain/anima_loadout.py`
- `src/frontend/web/src/ui/library/LibraryPage.tsx`
- `docs/backend/features/typed-content-and-marketplace.md`
- `docs/frontend/features/library.md`
- `docs/architecture/discover-contract-ownership.md`

### Removal findings

Music spans the typed catalog/API, loadout bindings, runtime projection, browser
BGM playback, controls and persisted preferences. Hiding its UI would not stop
previously equipped tracks from playing. BGM, SFX and TTS share sound machinery;
removal must retain the SFX/TTS paths.

Standalone `pose_clip` dependencies are currently allowed for Gestures, Reactions
and Idle Styles. They can themselves reference effects/sounds. Removing the enum
and scanner without compatibility handling can break parent content and decoding
of existing database rows. Action-owned `animaPoseClip` payloads and standalone
static Poses are separate and remain supported.

Owner selected removal of Music functionality with source files retained, and
preservation of Actions using standalone clips. Conversion must retain playable
content and sound/effect dependencies; retaining a permanent public standalone
Pose Clip type is not the target. Later clarification establishes there are no
old packages to support; local-content preservation remains required. New-format
packages must still validate their full declared contents before installation.

Evidence:

- `src/backend/animama/server/routers/typed_content.py:338`
- `src/backend/animama/app/services/anima_loadout_service.py:537`
- `src/backend/animama/app/services/typed_runtime_projection.py:331`
- `src/backend/animama/app/services/content_kind_registry.py:209`
- `src/backend/animama/adapters/repositories/sqlalchemy/content_catalog_repo.py:230`
- `src/frontend/web/src/lib/sound/SoundController.ts:215`

### Idle findings

The current authoring UI uses owned VRMA lanes and Default/emotion pools, without
separate intensity-cell selection. The runtime picks the dominant emotion's pool
or Default, samples with previous-clip avoidance, and schedules finite stints
after a quiet interval (currently 180 seconds). Gesture-backed cell pools and
Pose Clip/SFX/VFX execution therefore require a runtime change, not just a picker.
The typed registry already permits Gesture dependencies for Idle Styles, but
this does not establish the requested end-to-end playback behavior.

Current idle candidates require VRMA and a finite duration. The editor supplies
ping-pong playback with two repetitions; an idle-style redesign must not silently
apply that behavior to every reused Gesture. A running idle stint currently
finishes across emotion changes but yields to interaction/explicit Gesture
activity. Pose Clip events already have a playback path for Gestures, but idle
event ownership and cancellation need coverage when that path is reused.

The current style crossfade field is stored and projected but is not carried
through to idle scheduling; the planner instead uses fixed transition durations.
Per-Anima pool overrides also exist. Timing, transitions and override ownership
must be specified as intended behavior rather than assumed from those fields.

Preserve the separation between idle dependencies and AI-callable equipment.
Chat derives callable Gesture IDs from the equipped runtime `gestures` list;
adding idle dependencies to that list would violate the agreed scope.

Evidence:

- `docs/frontend/runtime/avatar-animation.md:45`
- `src/frontend/web/src/lib/avatar/planner/AvatarPlanner.ts`
- `src/frontend/web/src/lib/runtime-content/AnimaRuntimeCatalog.ts`
- `src/backend/animama/server/routers/chat/turn_setup.py:126`

### Appearance findings

Avatar portraits are separate Appearance items discovered by model association:
Included portraits use `avatar_model`, and captured portraits use
`presentation.avatar_item_id`. The Avatar kind currently allows no catalog
dependencies. Exporting the Avatar's ordinary dependency closure therefore does
not automatically include its portrait. The package projection must collect and
rewrite that association explicitly. This does not require eliminating the
Appearance type or combining Anima-specific images with the Avatar model.

Evidence:

- `src/backend/animama/server/routers/avatar.py:218`
- `src/backend/animama/app/services/content_save_service.py:196`
- `src/backend/animama/app/services/content_kind_registry.py:209`

## Interview round 1: owner answers

1. Confirmed the fresh-companion boundary and exclusions above.
2. Confirmed Default for neutral/unconfigured cells, explicit No idle per cell,
   and no scheduled idle Gesture when Default is empty. Procedural rest remains.
3. Owner expects animations deliberately chosen for idling and tentatively
   prefers preserving existing behavior; the rhythm alternatives were unclear.

Working direction for point 3: preserve existing scheduling rather than add a
new rhythm mode or new timing controls. Explain the current sequence: about
180 seconds of quiet, one finite idle-animation stint using its playback
settings, then quiet again. Existing procedural breathing/resting continues
between stints. Preserve interaction/explicit-Gesture priority, previous-choice
avoidance when alternatives exist, and applying emotion changes at the next
selection rather than abruptly replacing a running stint. The owner's wording
was tentative; do not turn it into approval of newly invented timing behavior.

Source was rechecked in `AvatarPlanner.ts` (quiet default and active/quiet
transitions) and `animationManifest.ts` (finite duration/repetition handling).
How Gesture-authored playback settings map into an idle occurrence still needs
to be made explicit; in particular, do not silently force ping-pong or allow
unbounded repeats because current idle scheduling requires finite durations.

## Interview round 2: owner answer

Confirmed: idle Gestures retain their authored sound and visual-effect events.
Motion/expressions-only stripping was not selected. Finite playback settings,
loop-event semantics and cancellation cleanup must be made explicit when
specifying the shared Gesture playback path.

## Interview round 3: owner answers

1. Matching names: automatically suffix imported names without parentheses.
   Keep existing content unchanged. The working spelling is `arms-crossed-2`.
   Replacement UI is not requested; this does not authorize removing the
   existing backend replace contract without compatibility consideration.
2. Dependency isolation: explicitly confirmed the recommendation. Each import
   gets new editable dependency copies; three imported Gestures can share one
   newly imported Sparkle while existing Gestures keep their previous Sparkle.
   Additional storage is the accepted tradeoff for independent editing.

Current-source check: `content_package_service.py:651` can reuse an exact
non-root dependency before processing the keep-both collision mode. The proposed
isolation guarantee therefore requires a deliberate implementation change.

## Interview round 4: owner answers

1. Music/BGM: accepted removal. The question explicitly retained original audio
   files on disk; the answer does not request deleting files or resetting data.
2. Standalone Pose Clips: preserve existing dependent Gestures/Reactions instead
   of requiring their recreation. The proposed path copies their clip content
   into Action-owned files with necessary effects/sounds. The compatibility
   implementation must preserve existing behavior and retain source originals.

## Interview round 5: owner answers

1. Whole-package import confirmed. All selected/exported roots and their required
   dependencies are reviewed and imported together; no partial-selection UI.
2. Automatic image bundling confirmed. Avatar portraits and selected Anima
   profile/background images accompany their parent export. No standalone image
   picker is added to Library/package export; Appearance storage and existing
   image management remain unchanged.

Proposed picker scope: Idle Styles can be exported as standalone content with
their required Gestures and supports. The mockup's categories need a place for
them; exact placement is a UI design detail to resolve in the spec. Do not expose
deferred Voice, removed Music, standalone Pose Clips, or private Chat Uploads.

## Interview round 6: owner answers and clarification

1. Owner explicitly confirmed the clarified Style-owned model: the Style owns
   Default and the separate emotion/intensity pools; an Anima equips a Style.
   Retire the separate per-Anima pool override layer. To vary one Anima's pools,
   duplicate/customize a Style and equip that copy. Editing a shared Style
   affects its users on the next runtime refresh. Preserve any existing
   customizations through conversion.
2. Owner reports there are no old packages to worry about. Remove legacy-package
   compatibility/conversion from required scope. Existing local-content
   preservation, archive validation and recoverable installation still apply.

Source check for point 1: `anima_loadout_service.py:299` resolves stored
`pool_overrides`, and `:515` validates per-Anima pool reconfiguration.

## Proposed specification defaults for final review

These follow the agreed scope or preserve existing behavior; they are not
separate owner approvals and must remain visible in the discovery brief/spec:

- Keep existing finite idle scheduling, interaction priority and repeat avoidance;
  do not introduce continuous-idle modes or new timing controls. Respect finite
  Gesture playback rather than automatically forcing ping-pong on all Gestures.
  Unbounded animation playback needs a finite idle configuration before it can
  be used in a pool, consistent with current eligibility rules.
- Preserve existing Idle Styles when converting owned animation lanes into
  Gesture references. Map each legacy emotion pool to all three intensity cells
  to retain its previous intensity-independent behavior; preserve Default,
  effective configuration and playable bytes. With per-Anima overrides retired,
  preserve an existing customized configuration in a separate Style rather than
  discard it. This needs source-based local conversion design; it must not
  accidentally equip converted Gestures for AI. Legacy package conversion is
  excluded following the owner's round-6 clarification.
- Follow the supplied combined Import / Export modal and Content/Anima export
  tabs. Review before any durable install/export, including full Anima identity
  and bundled dependencies. Successful content import offers Library navigation;
  successful Anima import offers opening the fresh companion.
- Retry a pending operation without creating duplicate results. A deliberate
  new import creates a new detached copy with the agreed suffix rules; no
  subscription or update relationship is introduced.
- Keep attribution and existing license metadata per bundled item; do not claim
  metadata validation determines sharing rights or introduce hosted review.

## Discovery outcome and follow-up

No remaining product question blocks specification. The Style-owned model is
confirmed and old-package compatibility is unnecessary. Keep the retained idle
scheduling direction explicit; it does not authorize new timing behavior.
Detailed local-content conversion, portrait associations, package schema,
recovery and validation belong to the specification/ExecPlan's implementation
design and bounded research. The discovery brief identifies these limits and
observable success criteria without treating unperformed checks as evidence.

## Evidence limits and next step

Research is source inspection, not a reproduced browser/native playback test.
No implementation, data migration, content deletion, tests, commit, push or
publication has been performed. Mockup copies and their links were verified.
Discovery is ready for `to-spec`, followed by an ExecPlan with explicit local
conversion, recovery, round-trip and desktop/browser verification milestones.
