# Anima Creation

## Current journey

`/a/animas/new` renders the five-step `ui/create-anima/CreateAnimaPage` inside
the normal app shell: Avatar → Voice → Identity → Actions → Review. It creates one
private live Anima and opens that Anima's chat surface after commit. It does
not create a Chat row, greeting, Blueprint, or publication.

One persistent Avatar preview accompanies the five-step form. The display name
remains editable throughout the journey.

Creator-hub, sidebar, carousel, Library, preview-recovery and empty-roster
entry points open the same creator. The optional `avatar` search parameter
accepts only a bounded logical catalog item ID; URLs, paths, and unknown search
fields do not become creation input. The creator resolves the current admitted
Avatar and revision. An existing saved draft wins over a new URL hint; an
unavailable handoff leaves a visible error and the source picker usable.

Untouched Cancel exits to Creator hub (`/a/create`), not `/a/animas`, whose
empty-roster resolver returns to this route. Shared local VRM preview primitives
also serve the portrait-debug route. Onboarding calls backend starter ensure.

## Design and API contract

The strict public `AnimaSpec` command supports creation options, read-only
whole-spec validation, atomic idempotent creation, durable starter ensure/repair,
and typed upload admission. The backend owns stable live name/identity authority,
aggregate revisions and atomic materialization. The identity editor sends both
memory and aggregate revision guards. See the
[HTTP contract](../../backend/architecture/http-api.md#strict-private-creation)
and [data model](../../backend/architecture/data-model.md).

### Five-step interaction contract

| Step     | Behavior                                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Avatar   | Select Included or Local content, or upload and explicitly save a validated VRM.                                                |
| Voice | Choose PocketTTS or ElevenLabs, select a preset or shared named clone, or enter a voice ID. Save new clones with the same library controls as Loadout. |
| Identity | Edit the required Markdown identity; preview or request an Avatar suggestion.                                                   |
| Actions  | Start from the Recommended Starter Pack, select Gestures and edit all 72 Reaction cells. Preview and selection are independent. |
| Review   | Inspect name, Avatar, voice, identity, Action counts and linked diagnostics before Create Anima.                                       |

A name is required before leaving Avatar. Back, visited steps and Review Edit
preserve the draft. Changing Avatar retains identity and Actions while
revalidating compatibility; filtering never changes hidden selections.
Edited drafts offer keep editing, save and leave, or discard and leave.

Each Reaction cell accepts any compatible Reaction or Empty. The same Reaction
can fill several cells; counts represent occupied cells. Reset Actions to Starter
Pack requires confirmation and replaces all Action edits, including hidden ones.

### Source and identity boundaries

The implemented backend `AnimaSpec` contains a required live display name and one
Markdown identity document, an admitted typed Avatar, explicit null profile and
background Appearance choices from this browser, explicit voice choices, exact
Gesture selections and all 72 explicit Reaction cells, a versioned Recommended
Starter Pack, and a complete `expected_source_revisions` map. That map covers
selected roots and all supports; it is operation evidence, not an
active runtime mount. Empty Gesture/all-empty Reaction choices are allowed
with warnings. Invalid selected content must be repaired or explicitly removed.

New companions start with Idle empty; an optional Local Idle Style can be
equipped afterward. Advancing Actions to Review resolves every unique selected
root through one read-only evidence request, then performs the existing
whole-spec validation. This transition does not request typed previews, fetch
bytes, or create `content_previews` rows. A stale root or changed support keeps
the draft unchanged and links every affected selection to repair. Explicit
stage playback and “review updated source” repair still use deliberate
one-item previews.

Upload VRM opens the native picker directly. Before a selected file becomes a
browser-local preview, the client checks the `.vrm` name, 100 MiB maximum,
binary GLB container and length, supported VRM 0.x/1.0 document, and absence of
external resources. The server remains authoritative when the user confirms
the typed Local Save. An uploaded VRM is only browser-local preview until that Save.
Confirmed content survives cancel; unsaved browser files must be selected again
after reload. Creation submits `profile: null` and `background: null` for default
appearance; use [Appearance management](avatar-releases-and-appearance.md) afterward.

Identity uses the existing Markdown editor/renderer primitives with one string,
LF normalization, and the server's effective UTF-8 byte limit. A new draft is
seeded once with literal first line `# [NAME]`, followed by one hint line under
each of Essence, Personality, Speaking style, Appearance and presence,
Background, Interests, Values, With the user, and Boundaries; the seed alone is
not a meaningful edit. An editable saved draft whose body is still the exact
previous untouched template receives the current template, keeping its heading;
customized identity text and frozen submissions are not rewritten.
Write and Preview retain one editor instance and undo history. Tab leaves the
editor instead of inserting indentation. New creation and explicit rename use
a 1–40 Unicode-code-point name limit read from creation options. Existing
41–120-character live names remain readable until explicitly renamed. The
stage summary is a
bounded derived excerpt, not another persisted field or a model response.
Creator Markdown preview does not load remote images.

### Draft, retry, and first-chat boundaries

Drafts are scoped to the runtime owner and installation, with explicit
schema routing and an unsaved-VRM reselection marker. Editable schema v3 adds
explicit provider and voice choices and has no Appearance selection state. Safe v1 null-appearance drafts migrate
automatically; v1 drafts with an image choice/pending marker require explicit
“Continue without images” confirmation, while confirmed uploads remain in My
Content. Frozen v1 requests are replayed exactly and migrate only after a known
non-commit. Unknown/corrupt schemas
are preserved until explicit Start over; raw files and Blob/delivery URLs are
never persisted. Ordinary Resume requires source revalidation before Create,
without silently updating revisions. Save failures and
competing-tab conflicts are visible; a frozen retry snapshot must be durably
saved before creation dispatch. Steps, search filters, and preview/camera state
are not semantic edits and do not rotate submission keys.

The browser freezes a normalized `AnimaSpec` and body idempotency key. A known
rejection allows edits; only a changed normalized command rotates the next
submission's key. An unchanged retry keeps its key. A lost response
has an **unknown outcome**, not proof of failure: lock edits/Start over and
offer Check creation result with the exact same payload/key **before** current
source/default validation. This recovers committed success even when content
has since changed. Key conflicts are not silently retried with a new key; a
deleted result returns gone and is never recreated automatically.

Backend success precedes runtime preparation. Replace the editing record with
a minimal committed-Anima marker before clearing draft text/selections. Reload
then resumes opening that ID. Dispose the creator actor, prepare one fresh
runtime session, and transfer it to the route without a second preparation.
A failed mount offers mount-only retry or opening the existing Anima through
the normal degraded route; it cannot create another Anima, Chat, or greeting.

Backend-owned `StarterAnimaSpec` values and ensure/repair receipts drive
idempotent installation bootstrap. Existing customization and intentional
deletion remain protected; the browser never submits explicit legacy repairs or
uses roster size as a provisioning decision.

### Stage, accessibility, and implementation handoff

`CreateAnimaStage` reuses `AvatarPreviewSurface`, protected typed preparation,
and Action playback with `creator` ownership. It must resolve the selected
Avatar directly: the existing `useContentCreatorModelPreview` and Library dock
choose an already-owned Anima and are not suitable creation entry points.
At steady state there is one renderer, Avatar, and prepared catalog session;
the floating preview dock stays unclaimed.

Motion and audio play only through explicit Action previews;
source/step changes, document hiding, and exit stop and dispose playback as
appropriate. WebGL failure leaves the form operable.

Use two columns only with enough page content width; below that, retain the same
stage and single name plate above the full-width panel. The app shell still
owns its sidebar breakpoint. Keep step labels, dialogs,
error links, and in-flow navigation usable at 320px, 200% zoom, and with a
software keyboard. Respect reduced motion, visible focus, live-region status,
keyboard-only navigation, and non-canvas descriptions.

The feature lives in `web/src/ui/create-anima/`, with separate
draft/reducer/storage/submission modules and `query/hooks/useAnimaCreation.ts`
adapters around the generated SDK. Shared metadata requests use the query's
own cancellation signal; a disposed stage consumer cannot cancel another
consumer's cached metadata read. Verified bytes and Blob URLs remain owned by
the consumer. Creation metadata and submission requests have bounded timeouts;
a submission timeout retains the frozen unknown-outcome command.

`CreateAnimaCompletion` prepares the first runtime only after success.
`creationRuntimeHandoff` transfers that exact prepared mount to
`AnimaRouteProviders`, with owner/revision checks, a bounded unclaimed lifetime,
and StrictMode-safe disposal. Opening retries never dispatch creation.

### Acceptance and regression coverage

Acceptance must cover source/upload, identity, exact Actions, stale dependencies,
cancellation, owner isolation, unknown-result replay, first chat, preview disposal,
accessibility, responsive behavior and Electron. Focused feature tests and the
[Create Anima browser journeys](../testing/browser-journeys.md)
provide regression coverage.

Complete Electron/native-picker, physical input, assistive-technology and all
first-chat journeys remain required for release acceptance. Record the
exact build, scenarios, results and remaining limits in the release review;
available test scripts do not establish that a journey was performed.

### Local creation boundary

Create Anima never creates a Blueprint, package, publication or synchronization
relationship. There is no “Save as Blueprint” action. Discover and hosted
publication/acquisition are discontinued. Existing typed `.animama` package
import/export does not introduce live Anima export.


### Voice choices

Voice precedes Identity and reuses Loadout's searchable PocketTTS picker, samples,
downloads and named Voice Cloning library. Initial choices come from application
preferences; unsupported or temporary Pocket voices use Eve. Each provider keeps
its draft configuration when switching. An ElevenLabs choice requires a voice ID.
Review shows the selected provider and voice. The application speech on/off setting
continues to control whether the Anima speaks.

New commands include `voice`: a provider, Pocket preset ID or exact shared clone
reference, and an optional ElevenLabs ID. These choices are stored in the same
creation transaction. A saved clone belongs to the shared local library and is
retained when creation is cancelled; selecting it binds only the eventual Anima.
Clones are revalidated against owner-visible catalog revisions before creation.

Older four-step drafts migrate their step indices and retain their edits. Pending
requests keep the original frozen body and key, including omission of `voice`.
Only editable drafts acquire the new voice choice; recovery never sends a new
creation command automatically.
