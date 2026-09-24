# Share local content and complete Animas through `.zip` files

Status: Approved for full implementation on 2026-09-24.
Authoritative source: [issue #81](https://github.com/raymond-van/animama/issues/81).
This file retains its local requirements snapshot, published and read back at
`2026-09-24T13:47:40Z`. The owner approved the ExecPlan and all six phases.
2026-09-24 amendment: the owner requested ZIP-only import/export and timestamped
download filenames; this supersedes the original extension shown in the mockups.
The amendment was published to issue #81 and read back at `2026-09-24T20:59:35Z`.
Source baseline: `98220eae162651207960ffa9657aa54581a80265`.

## Problem and intended users

Animama users need to exchange their created content and companions without a
hosted publishing or content storage service. The backend already packages one
catalog item with its dependencies, but Library exposes no package workflow.
Multiple independent content selections and a complete live Anima cannot currently
be packaged. Sharing files manually loses dependencies and installation-specific
relationships.

Provide a reviewed local Import / Export workflow that produces portable
`.zip` files and installs ordinary editable Local content. A complete Anima
package creates a fresh companion from its definition and equipment, without
transferring the sender's private interactions or installation configuration.

## Goals, scope and non-goals

Scope includes Library import/export, one or multiple content selections, one
complete Anima per Anima export, automatic dependencies/images, independent
imported copies, and coordinated content-plus-Anima installation. It also includes
the agreed content simplification: retire Music/BGM and standalone catalog Pose
Clips, and make Idle Styles own Gesture-based emotion/intensity pools.

No Discover, publishing, hosted storage/distribution, cloud identity, sharing
links, synchronization, automatic updates, or installation backup/restore is
introduced. No new catalog Voice integration or Voice sharing is added; existing
TTS remains. Loose-file upload and Creator JSON import/export remain separate
from package import. No standalone Appearance picker/export, partial-package
import, replacement-import UI, continuous-idle mode, or new idle timing controls
are required. There are no old packages requiring backward compatibility.

## Required behavior

### R1. Local package boundary and ownership

Export writes a user-saveable `.zip` file. Import accepts such a file through
the installation's admitted local application boundary, without contacting a
content hosting/publishing service. Sharing the resulting file is the user's
choice outside Animama. The package is a transport artifact, not an additional
editable Library item, live Anima record, or desktop feature pack.

Accept `.zip` only (case-insensitive), and reject invalid or unrelated ZIPs through
the existing strict package validation. Complete-Anima exports use the Anima
display name plus a UTC timestamp; content exports use the installation user
display name plus the timestamp, falling back to `content` when unset. Preserve
readable names while sanitizing unsafe filename characters. The internal manifest
remains `animama-content-package/3`; this is an extension/naming change, not a
loose-file archive importer.

Imported content receives fresh installation-local identities and the receiving
installation owner. Included sources remain immutable. Package-supplied owner
IDs, local file paths or runtime capabilities grant no authority. Ordinary Local
Save, Preview, Edit, Equip and Delete rules apply after installation.

### R2. Content export and complete dependencies

The Content tab supports selecting one or more Avatars, Gestures, Reactions,
Poses, Particle/Avatar/Scene Effects, Sound Effects and Idle Styles across search,
category changes and pagination. Idle Styles must be reachable in Library and
the picker; their exact category placement is a UI design choice. Invalid, missing or
unresolved content cannot produce a seemingly successful export.

Package each selected item with its required registered files and transitive
content dependencies. Shared dependencies appear once within the package.
Distinguish selected items from additional required items in the summary. A
selected root that is also another root's dependency counts once, as selected.
Users cannot remove a dependency while retaining an item that needs it. Preserve typed
references, Action events, binding aliases and supported playback configuration.
Application-provided runtime primitives must have a checked compatibility
requirement or a portable representation; do not assume an unspecified recipient
environment will supply missing content.

Automatically include an Avatar's existing default portrait. Include an Anima's
selected profile/background images when exporting that Anima, preserving framing
and associations separately from the Avatar model. An Avatar with no portrait
does not require generating one. An explicitly associated required image that
has become unavailable is a review error, not permission to silently substitute
another image. Keep the Appearance type and storage model.

### R3. Complete Anima export and fresh creation

The Anima tab selects one existing companion and reviews its name, complete
identity/personality text, equipped content, supported configuration and required
items before export. Read its saved definition/loadout and exact content revisions;
an old mounted runtime or its best-effort omission of broken roots is insufficient.

Preserve Avatar selection, profile/background Appearance, equipped Gestures and
their configuration, all Reaction cell assignments including explicit empties,
and the selected Idle Style or explicit absence. Preserve effective starter
selections/exclusions rather than substituting the recipient's current defaults.
Include required content as in R2. Do not silently remove broken equipment.

Exclude chats, relationship memories, attachments, identity history, emotion/
conversation runtime state, credentials, sender owner IDs and device/provider
settings. Music and Voice configuration are outside the portable definition.
Only the reviewed identity text is copied from the identity domain; do not
serialize arbitrary memory/settings records. Preserve per-content attribution
and supported license metadata without treating those fields as permission checks.

Import creates a new private Anima with the reviewed definition and installed
equipment, fresh local identity/revisions and normal recipient-side defaults for
excluded runtime/provider configuration. It does not resume a conversation,
contact a model/voice provider, equip an existing Anima, or change recipient
settings. Missing local creation prerequisites are actionable failures rather
than grounds to copy the sender's settings.

### R4. Import review, independent copies and completion

Choose/drop one package, inspect it locally, then review the whole package before
installation. Show its name, size, selected roots or Anima, required content,
compatibility/validation problems and final collision-resolved names. Review of
an Anima includes its identity text. No individual-item checkboxes or silently
partial Anima installation are offered. Required images and idle Gestures count
as dependencies even when the mockup illustrates only effects and sounds.

Name collisions preserve existing items and add an automatic suffix without
parentheses. This draft uses the first available `-2`, `-3`, etc.; resolve suffixes
within existing length/path constraints and show them before installation.
Naming must remain unambiguous when several members collide in the same package.
Changing a display/file name must not break logical references or Gesture bindings.

Every import gets independent editable copies of its dependencies. Deduplicate
within that import, not against existing Local or Included items merely because
names, provenance or bytes match. For example, three imported Gestures may share
one new Sparkle effect; editing it must not alter the prior Library Sparkle or
its users. New references may not become ambiguous with Included content.

Successful content-only import adds Local items without equipping an Anima and
offers navigation to those items. Successful Anima import offers opening the
fresh companion. A later runtime preparation failure reports an installed Anima
that needs attention and retries preparation; it must not create another copy.

### R5. Review freshness, cancellation and recoverable failure

Export uses the exact definition/content reviewed. If source content changes,
either retain the verified reviewed snapshot or require refreshed review; never
substitute newer bytes silently. At import commit, recheck the reviewed package,
destination facts and receiving prerequisites. A concurrent destination change
must not replace content or silently change reviewed names.

Choosing/changing files, previewing review information, or cancelling before
commit creates no durable Library items or Anima. Temporary staging is bounded
and cleaned up when no longer needed. Repeated clicks cannot dispatch independent
installations. If commit is already in progress or its result is unknown, show
that state truthfully and resolve the same operation before offering a new import.

Publication, catalog ownership, fresh Anima creation when present, and the durable
result form one recoverable operation. Failure before successful commit exposes
no partial selectable content or partial Anima; startup recovery must distinguish
successful work from work needing compensation. Identical operation retries
return the recorded result without rewriting later edits; different input under
the same operation identity conflicts. A deliberately started new import creates
a new copy. Do not resurrect a deleted result by treating a retry as a new import.

If recovery encounters later manual edits, preserve those edits and the recovery
originals and report the conflict. Package success cannot depend on a separately
committed content import followed by a separately committed Anima creation.

### R6. Idle Style owns pools

An Idle Style contains a Default pool and distinct canonical emotion/intensity
cells, each referencing existing Gesture content. The current tracked emotion
set and intensity levels 1–3 apply. Both VRMA-backed and `animaPoseClip`-backed
Gestures can be members. Reusing a Gesture in multiple cells does not copy or
implicitly equip it for AI invocation.

Neutral uses Default. For a non-neutral state, select the strongest emotion using
the existing deterministic tie behavior and its exact intensity cell. A cell
contains a Gesture pool, inherits Default when unconfigured, or explicitly selects
No idle. No idle suppresses scheduled idle Gestures without falling back; empty
Default also produces no scheduled idle Gesture. Procedural breathing/resting
continues. Do not introduce fallback to adjacent intensities or another emotion.

An Anima equips one Style or none. Retire the separate per-Anima pool override
layer. Editing a shared Local Style affects its users on their next runtime
refresh, without changing active prepared snapshots. To customize one Anima,
duplicate/edit the Style and equip that copy; editing Included creates a Local
copy. Exporting a Style includes its pools and Gesture dependencies; an Anima
export includes its selected Style.

### R7. Idle playback preserves scheduling and Gesture behavior

Retain the existing scheduling direction: normally 180 seconds quiet, one finite
idle stint, then quiet again. Use normal procedural rest between stints. Choose
uniformly from the applicable pool while avoiding the immediately previous
Gesture when alternatives exist. An emotion change affects the next selection;
it does not abruptly replace the current finite stint. Preserve existing
interaction/explicit-Gesture priority and reset behavior.

Play the selected Gesture's supported motion, expressions, visual effects and
sound events with its authored finite playback settings. Do not strip events or
force every Gesture into the old Idle editor's ping-pong defaults. Each intended
timeline occurrence fires once, including time-zero events and intended finite
repetitions, without duplicate delivery at loop boundaries. Interruption/unmount
stops future or late asynchronous idle events and cleans up only effects/audio
owned by that playback, preserving unrelated TTS and other active playback.
Do not resume a half-finished event timeline after interruption. Effect duration
does not implicitly extend the animation's finite scheduling interval.

An eligible idle Gesture must have determinable finite playback independent of
chat/run lifetime. Validate eligibility when choosing/saving a pool; unknown or
unbounded playback receives an actionable reason rather than silently running
forever or truncating to an invented duration. Numeric clip duration alone does
not establish finite completion if looping/lifetime overrides it. The plan must
characterize both playback implementations before defining the detailed conversion.
Idle dependency availability never expands the AI-callable Gesture equipment list.

### R8. Retire Music/BGM and standalone catalog Pose Clips

Remove Music/BGM discovery/authoring, typed product availability, equipment,
autoplay/loop/gain preferences and runtime/control paths. Previously equipped
Music must stop being used after transition; hiding controls alone is insufficient.
Retain original user audio files without reclassifying them as Sound Effects.
Shared sound infrastructure must continue supporting TTS and Sound Effects.

Retire standalone Pose Clip creation/admission, catalog selection and packaging.
Preserve the `animaPoseClip` animation format and playback inside Actions, static
Pose content, and Creator JSON import/export, including raw Clip JSON download.
Existing Gestures/Reactions that reference standalone clips must keep their
playable behavior through conversion to Action-owned content, retaining necessary
effect/sound references and source originals. Shared old clips may become owned
copies in several Actions without leaving a public standalone Clip dependency.

### R9. Preserve existing local content during transition

No library/database/profile reset or automatic source-file deletion is authorized.
Handle existing retired-kind rows and historical operation-receipt decoding
before removing enum/schema support; successful retries and recovery evidence
must remain readable.
Unreferenced retired source files can remain on disk without appearing as
supported Library items; their presence must not break the remaining catalog.

Convert existing Idle Style animation lanes to Gesture references while retaining
playable configuration and ownership. Preserve existing per-Anima pool variations
as separate Styles where needed before retiring overrides. An emotion-only old
pool should retain equivalent behavior across the new intensity cells; mapping
it to all three cells is the proposed preservation strategy. Conversion must not
equip newly represented Gestures for AI use or make Included sources writable.

Conversion must be repeatable, preserve unrelated identity/history/equipment,
and retain recovery originals. If safe conversion is impossible, report the
affected item and preserve evidence rather than silently discard content or
mark an incomplete transition successful. The ExecPlan must define fixture-based
conversion and recovery evidence. There is no legacy-package migration requirement.

## Constraints

Reuse existing typed validation, catalog/reference rules and the recoverable Local
mutation authority described by [ADR 0004](../../adr/0004-filesystem-content-and-recoverable-mutations.md).
Maintain the [local-product boundary](../../adr/0001-independent-local-product-and-packaged-sharing.md)
and accountless installation admission. No private Cloud source or historical
Discover proposal is an implementation dependency.

Treat every archive and displayed field as untrusted. Preserve containment,
symlink/duplicate-member rejection, hash verification, typed-kind checks,
dependency closure/cycle checks and compressed/expanded resource limits. Baseline
ceilings are 2,048 package files, 4 GiB package bytes, 4 MiB manifest and 200:1
compression ratio; per-kind/runtime limits also apply. Define exact counting and
streaming behavior in the plan without silently relaxing current protections.
No executable code, arbitrary host paths, external-resource fetching or package
instructions may bypass admitted content handling. Error messages expose safe
item names/reasons, not host paths or private data.

Packages have an explicit supported schema/capability contract. Unsupported
formats fail clearly before installation. The old `/2` reader/writer need not
remain compatible, but this does not permit weakening validation or discarding
existing local data. Preserve supported attribution/license fields per item;
neither Local ownership nor Included source asserts redistribution permission.

Use the same-origin API and existing generated-client workflow. Desktop is the
primary UI target; retain keyboard access, visible focus, modal focus return,
labelled controls, scrollable long reviews and bounded narrow layouts. Display
validation/progress alongside the responsible operation; disable invalid or
pending final actions. Copy must describe local installation storage accurately,
including self-hosted use, rather than imply that no local-server transfer occurs.

### UI references

Use the supplied unchanged mockups as visual guidance; confirmed behavior takes
precedence over illustrative details:

- [Import / Export entry](reference-01-import-export-entry.png): Library entry,
  package drop/picker and export navigation.
- [Import review](reference-02-review-import.png): root list, required-item
  disclosure, resolved names and final action. Automatic suffixing replaces the
  illustrated collision-policy dropdown and parenthesized example.
- [Export selection](reference-03-export-selection.png): Content/Anima tabs,
  persistent selection across filtering and package summary before review.
- [Anima export](reference-04-anima-export.png): Anima selector, identity review,
  included-content summary, privacy notice and export footer. Omit the outdated
  Music row; the illustrative Edit export copy control does not add an identity
  editing requirement to this scope.

The ExecPlan must link all four files and verify remaining unillustrated review,
error and completion states. Do not carry Chat Uploads into sharing merely
because it appears in the surrounding Library screenshot. Styling must use current application
components/tokens; incidental mockup backgrounds are not a Library redesign.

### Current contracts deliberately changed

The [glossary](../../../GLOSSARY.md#pose-clip) currently permits standalone catalog
Pose Clips. [Typed content](../../backend/features/typed-content-and-marketplace.md)
currently exposes Music, excludes live-Anima packaging, and describes the old
Idle model. These are intentional changes established by discovery, not claims
that the current implementation already satisfies this spec. Update useful
current guidance and shared terminology with implementation. Preserve the
Anima-versus-Avatar, static-Pose-versus-animation-format, and readable-library
ownership boundaries; no new editable Blueprint catalog type is introduced.

## Acceptance criteria

| Requirement | Required observable evidence |
| --- | --- |
| R1–R2 | Export/import one item, multiple independent roots and overlapping dependency graphs between isolated installations. Each required item/file appears once per package; no hosting/account connection is needed. |
| R2–R3 | Avatar portrait and different Anima profile/background images retain the correct associations and framing after import. Missing selected content blocks export; absent optional portraits do not. |
| R3 | A full companion retains identity, equipment, empty cells, exclusions and Style selection. Fresh local IDs are issued; private-history/credential/sender-owner markers are absent from the archive and new aggregate. The receiving owner is assigned locally. No model/TTS request occurs during installation. |
| R4 | Colliding selected roots/dependencies receive reviewed non-parenthesized suffixes without replacing existing items. Editing an imported shared dependency affects its imported users only; content-only imports do not equip anything. |
| R5 | Source/destination drift refreshes review or fails safely. Cancellation before commit leaves no durable result. Duplicate submission, interrupted responses and restart recovery resolve one operation without duplicate copies or partial admission. Later manual edits survive recovery conflicts. |
| R5 | Inject failure between file publication, catalog reconciliation, Anima creation and final receipt; verify complete rollback/recovery. A runtime-preparation failure after commit preserves one installed companion. |
| R6–R7 | Default, each intensity, inherited cells, No idle and absent Style resolve correctly. Both Gesture implementations play authored sound/effects and finite repetitions, stop cleanly on interruption, avoid duplicate events and never become AI-callable through idle membership alone. Include rendered/native playback evidence. |
| R6–R9 | Shared Style edits affect future mounts; duplicated Styles can diverge. Fixtures with old lanes, old Action-referenced clips and Anima overrides retain behavior after repeatable conversion; originals and unrelated private data survive. |
| R8–R9 | Previously equipped Music no longer plays or appears as supported equipment. Original audio remains; TTS, SFX, static Poses, Action clips and Creator JSON round trips still work. Retired files/rows do not crash catalog reads. |
| Constraints | Malformed/traversing/oversized/hash-mismatched/cyclic packages and unsupported schemas fail without partial installation; authorization and ownership checks remain intact. |
| UI references | Desktop then narrow-layout review covers entry, content selection, Anima selection, import/export review, collisions, errors, cancellation and completion. Verify keyboard/focus behavior and correct selected-versus-required counts. |

No acceptance above is established by writing this specification. Local automated
results, rendered browser behavior, actual avatar/audio playback and native
acceptance must be recorded separately; focused tests do not prove all boundaries.

## Open questions and decisions

No unresolved product question blocks planning. The 2026-09-23 owner decisions
are summarized in the [discovery brief](discovery-brief.md); this draft consolidates
them into required behavior without reopening the interview.

Reviewable defaults made concrete here: hyphen-number suffix spelling, standalone
Idle Style availability in Library/export (placement remains a design detail),
and the precise finite idle/error behavior in R7. These preserve the agreed
direction; they were not separately chosen in the interview. Material changes
remain owner decisions.

The ExecPlan must settle implementation details with bounded research: package
schema and review/commit contracts; full Anima projection; image association
rewriting; existing data conversion and recovery; and finite playback/event
semantics for both Gesture implementations. Preserve the actual existing idle
transition behavior rather than claiming the currently disconnected Style
crossfade field works. Source inspection has not inventoried user data or tested
browser/native playback. No arbitrary timers, provider fallbacks or destructive
conversion may be invented to close a gap.

## Spec

[Issue #81](https://github.com/raymond-van/animama/issues/81) is authoritative.
This file is the dated snapshot above; discovery records remain supporting history.

## ExecPlan

The [execution plan](local-content-sharing-execplan.md) defines six phases for
Idle Styles, safe content retirement, portable export, recoverable import,
the Library frontend and combined acceptance. It links all four UI mockups as
required frontend references and records conversion, failure/recovery and
validation gates. Plan authoring does not establish implementation acceptance.

## Delivery links

Parent [#81](https://github.com/raymond-van/animama/issues/81); phase issues
[#82–#87](https://github.com/raymond-van/animama/issues/81). Implementation is
authorized on `feat/local-content-sharing`; PR and validation records will be
added to the ExecPlan. Merge requires separate exact-candidate approval.
