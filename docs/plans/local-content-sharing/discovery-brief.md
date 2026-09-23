# Local content sharing: discovery brief

Discovery completed 2026-09-23 at source
`98220eae162651207960ffa9657aa54581a80265`, branch
`feat/local-content-sharing`. This is input to specification, not an approved
implementation plan. [Interview decisions and source evidence](intent-discovery.md)
remain available for clarification.

The [specification draft](local-content-sharing-spec.md) now consolidates these
inputs. Keep this brief as discovery history; revise requirements in the spec
instead of maintaining competing versions here.

## Problem, audience and outcome

Animama users need to exchange one content item, multiple items or a complete
Anima through local `.animama` files. The application packages required content
automatically and imports editable local copies. No hosted publishing, Discover,
accounts, content distribution or hosted storage service is involved.

## Agreed sharing behavior

- Use Import and Export labels. Reuse the existing package infrastructure.
- Export selected content with all required dependencies, deduplicated inside
  the package. Idle Styles are part of the proposed content-picker scope, with
  their referenced Gestures and supports; exact category placement is a UI detail.
- Import the entire reviewed package. No partial-content or partial-Anima
  selection flow in this version.
- Resolve collisions by keeping existing content and automatically suffixing new
  names without parentheses. Proposed spelling: `arms-crossed-2`.
- An import creates independent editable dependencies. Several imported items
  may share one imported dependency, but do not silently reuse mutable items
  from the existing library. Retry of one operation must not create more copies.
- A complete Anima import creates a fresh companion with reviewed name,
  identity/personality text, equipment and supported configuration. Exclude
  private chats, relationship memories, attachments, credentials, identity
  history, source owner identity and device/provider configuration.
- Automatically bundle the Avatar's default portrait and an Anima's selected
  profile/background images. Anima-specific images remain independent of the
  Avatar model. Preserve Appearance storage/type and existing image management;
  do not add standalone image selection/export to this UI.
- Old-package compatibility is unnecessary: the owner reports there are no
  existing packages to preserve. Existing local-content preservation is separate.

## Agreed content changes

- Remove Music/BGM as a supported feature: content type, equipment, runtime
  playback, controls and settings paths. Retain source audio files on disk;
  do not relabel them as Sound Effects or reset user data.
- Defer catalog Voice integration. Preserve existing TTS and Sound Effects.
- Remove standalone Pose Clips as a catalog type. Preserve the `animaPoseClip`
  format, Action-owned clips, static Pose content and Creator JSON import/export.
  Existing Gestures/Reactions using standalone clips must continue working
  through conversion to Action-owned content, including effects/sounds, while
  original source files are retained. Raw Clip JSON download remains separate.

## Agreed Idle Style model

An Idle Style owns a Default pool and separate emotion/intensity pools of
existing Gestures. Both VRMA and `animaPoseClip` Gesture implementations are
supported, including their authored sound and visual-effect events. Idle
membership alone never makes a Gesture available for AI invocation.

Neutral and unconfigured cells use Default. Each cell can explicitly select
No idle. Empty Default means no scheduled idle Gesture; procedural
breathing/resting remains.

An Anima equips a Style without separate pool overrides. A shared Style edit
affects its users on the next runtime refresh. For a variation, duplicate/edit
the Style and equip the copy. Preserve existing per-Anima customizations through
conversion rather than discard them.

Working direction is to retain current idle scheduling: about 180 seconds quiet,
one finite playback stint, then quiet again; higher-priority interaction/Gestures
interrupt, and immediate repeats are avoided when alternatives exist. No new
continuous-idle modes or timing controls were requested. The spec must define
finite Gesture playback and event cleanup consistently with this retained
behavior, rather than force the old editor's ping-pong defaults onto all Gestures.

## UI references

Use the original, unchanged user mockups as visual guidance:

- [Import / Export entry](reference-01-import-export-entry.png)
- [Import review](reference-02-review-import.png)
- [Export selection](reference-03-export-selection.png)

Both the future spec and ExecPlan must link these files. Follow the combined
Library entry and Content/Anima modal structure; confirmed behavior overrides
illustrative copy. Replace the parenthesized collision example with suffix
naming; no collision-policy dropdown is required. Chat Uploads, removed Music,
standalone Pose Clips and deferred Voice stay outside the sharing picker.

## Source findings and implementation design still needed

Current source supports one catalog root plus dependencies in package format
`/2`; live Animas and unrelated multiple roots are not admitted. Reuse its typed
validators, reference rewriting and `LocalContentMutations` journal/receipt
authority. Complete-Anima installation needs content publication and fresh Anima
materialization coordinated together, not two independently committed operations.

Avatar portraits are separate Appearance records found through model association,
not ordinary Avatar dependency edges. The new export projection must capture and
rewrite those associations explicitly.

Current idle playback only admits finite VRMA candidates; both Gesture
implementations and full event lifecycles need integration. Keep idle dependencies
separate from AI-callable equipment. Design local conversion of old Idle Style
animation lanes/pools and per-Anima overrides; mapping an old emotion pool to all
three intensity cells is a proposed preservation strategy, not a new product mode.

Music and retired catalog rows require safe decoding/conversion before enum or
schema removal. Source inspection has not established what content exists in any
user installation. No user data was inspected or altered.

Specify the package version, staged review/commit contract, exact revision
checks, archive limits, cancellation/retry behavior, and rollback/recovery. Retain
per-item attribution/license metadata; its validation does not establish sharing
rights. No new hosted licensing/review service belongs in scope.

## Observable success and evidence limits

- Transfer one item, multiple items and a complete Anima between clean local
  installations with required content and image associations intact.
- Preserve selected configuration and identity while excluding private data.
- Demonstrate deterministic collision names and independent editing of imported
  dependencies without altering existing content.
- Exercise Default/cell/No idle behavior, both Gesture implementations, sound/
  effect playback and interruption, and absence from AI equipment unless selected.
- Verify existing Action content and customized idle behavior survive conversion;
  Music no longer plays, while source files, TTS, SFX and Creator JSON remain.
- Reject malformed or incomplete packages before partial admission; demonstrate
  safe retry and recovery for interrupted content-plus-Anima installation.
- Check the modal flow at desktop viewport sizes, then narrow layouts. Actual
  avatar/audio behavior needs manual evidence beyond schema/unit tests.

No product code, migrations or runtime behavior changed during discovery. No
tests, browser/native playback checks, commits or remote writes were performed.
The three image copies matched their source hashes and their local links resolve.
No remaining product blocker prevents authoring the specification and ExecPlan.
