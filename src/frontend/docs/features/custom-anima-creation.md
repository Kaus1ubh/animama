# Anima Creation

## Current journey

`/a/animas/new` renders the four-step `ui/create-anima/CreateAnimaPage` inside
the normal app shell: Avatar → Identity → Actions → Review. It creates one
private live Anima and opens that Anima's chat surface after commit. It does
not create a Chat row, greeting, Blueprint, or publication.

The editable route is a canvas workspace rather than a card in a document
page. One inset, floating workflow panel owns the step navigation, scrollable
forms/diagnostics, and an always-visible action footer on the left; one
persistent, waist-up Avatar renderer fills the remaining warm-neutral canvas. A single display-name plate stays at
the canvas's top center on every step. There is no separate Creator hub route
header. The creator uses the app shell's adaptive-canvas geometry, so the same
flat `bg-background` surface continues beneath the collapsed sidebar rail,
behind the floating panel, and through the right viewport edge. At narrow widths
the same canvas and name input stack above the panel.

Creator-hub, sidebar, carousel, Library, preview-recovery, empty-roster, and
authentication entry points remain. The optional `avatar` search parameter
accepts only a bounded logical catalog item ID; URLs, paths, and unknown search
fields do not become creation input. The creator resolves the current admitted
Avatar and revision. An existing saved draft wins over a new URL hint; an
unavailable handoff leaves a visible error and the source picker usable.
Already-signed-in `/a/create?avatar=...` visits retain the creator hub; auth
restoration normalizes the legacy handoff to `/a/animas/new`.

Untouched Cancel exits to Creator hub (`/a/create`), not `/a/animas`, whose
empty-roster resolver returns to this route. The rejected `ui/create` page,
legacy mutation hook, voice-clone section, and temporary notice are removed.
Shared local VRM preview primitives remain for the portrait-debug route.
Onboarding now calls backend starter ensure; the template and bulk route are
removed. The older `/v1/animas/custom` workflow remains retired.

## Design and API contract

The strict public `AnimaSpec` command supports creation options, read-only
whole-spec validation, atomic idempotent creation, durable starter ensure/repair,
and typed upload admission. The backend owns stable live name/identity authority,
aggregate revisions and atomic materialization. The identity editor sends both
memory and aggregate revision guards. See the
[HTTP contract](../../../backend/docs/architecture/http-api.md#strict-private-creation)
and [data model](../../../backend/docs/architecture/data-model.md).

The owner approved the four-step interaction design on 2026-08-28 and accepted
the completed creator work on 2026-08-31. That acceptance retained the explicitly
unperformed native/accessibility checks listed below; it does not claim every
manual journey was repeated. The current canvas-and-panel design supersedes the
older card-layout mockups. Its durable layout and interaction contract is recorded
here, without depending on archived mockup files. The app uses the actual shell
and semantic theme tokens; a provisional preview is not Saved to My Content,
and privacy is scoped to the configured installation, which may be remote.

### Four-step interaction contract

| Step     | Required behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Avatar   | Included and My Content remain the two source tabs. The separate Upload VRM button and empty-canvas circular Upload button both open the native file picker directly, without an intermediate upload panel. A chosen file must pass the browser's 100 MiB binary VRM checks before the explicit authoritative My Content Save form appears. The selected radio card is sufficient; no duplicate “Selected” summary, profile/background image control, or existing Anima is required.                                                                        |
| Identity | One required plain Markdown document, initially seeded with `# [NAME]` followed by Personality, Speaking style, Values, Background, and Boundaries headings/instructions. The generated heading follows the trimmed display name while it remains uncustomized. Write/Preview and explicit Avatar suggestion remain; formatting/prompt-chip toolbars, secondary tagline, and editor help/count copy do not.                                                                                                                                                 |
| Actions  | Seed only the versioned Recommended Starter Pack. Compact management-style Gesture rows show every matching semantic key by default and select one source per key without separate semantic-key/None summary bars; clicking `Selected` clears that choice. All Reaction emotions share one joined disclosure list, with Admiration open initially and one continuous selected left border through its header and intensity rows, and edit all 24×3 cells. The tabs omit redundant assignment instructions. Preview never selects and selection never plays. |
| Review   | Global display name, selected Avatar name, full identity rendered directly, Action counts, linked diagnostics, nonblocking warnings, and one Create Anima action after whole-spec validation. It omits Avatar/privacy/defaults cards, Starter Pack/revision disclosure, Review reel, validation status, and manual recheck controls; exact validation and source evidence remain controller/backend state.                                                                                                                                                  |

The saved-draft recovery surface uses the same flat `bg-background` as the
editable creator rather than introducing a muted page backdrop. Before an
Avatar is selected, the canvas shows only the circular Upload button and
`Upload a VRM (<100 MB) or choose an Avatar to see them here.`

Back, visited steps, and Review Edit preserve the draft. Missing required fields
focus a linked error list without a redundant heading. The progress rail marks an invalid section with a
red label and underline without adding a second status line; completed sections
use a light-blue checked circle and adjoining blue underline, so consecutive
completed steps form one continuous rail. The larger display-name plate also shows a visible
“Enter a name to continue” message when its trimmed value is missing. Name
validation begins on Avatar, so a missing name blocks the first forward move;
errors focus that persistent plate and do not leave an already-fixed step marked stale. Selecting a new
Avatar retains identity/Actions and revalidates compatibility. Search/filtering
never changes hidden selections. The pinned panel footer contains only the
Back/Cancel and Continue/Create actions; normal privacy and “Draft saved” copy
is omitted, while actionable storage failures remain visible in the scrollable
body. Cancelling
an untouched draft goes to the Creator hub; edited drafts offer keep editing,
save and leave, or discard and leave. Do not exit through the empty-roster
Animas resolver. The leave dialog uses a wider responsive layout so all three
actions stay inside the modal.

The Reaction editor presents every emotion in one joined bordered list matching
the existing-Anima right panel. Admiration is expanded initially; each emotion
can then be opened or closed independently. An expanded emotion's primary left
border runs continuously through its header and all three intensity rows. It
names emotion and intensity for every cell. Change opens a single-choice dialog
for that cell with all compatible Reactions and Empty; Apply changes only that
cell and returns focus. The same Reaction can occupy several cells regardless of
its suggested placement. Counts describe occupied cells, not unique Reaction
items. Narrow layouts stack three labelled cells per emotion. Reset Actions to
Starter Pack confirms replacing all Action edits, including filtered choices,
without changing the other steps.

### Source and identity boundaries

The implemented backend `AnimaSpec` contains a required live display name and one
Markdown identity document, an admitted typed Avatar, explicit null profile and
background Appearance choices from this browser, exact
Gesture selections and all 72 explicit Reaction cells, a versioned Recommended
Starter Pack, and a complete `expected_source_revisions` map. That map covers
roots, hidden default Idle, and all supports; it is operation evidence, not an
active runtime mount. Empty Gesture/all-empty Reaction choices are allowed
with warnings. Invalid selected content must be repaired or explicitly removed.

Advancing Actions to Review resolves every unique selected root plus the fixed
Idle Style through one read-only evidence request, then performs the existing
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
after reload. Phase 5's static-image and portrait APIs still support other
Appearance management, but Create Anima performs no Appearance list, upload,
crop, capture, or Save request. It always submits `profile: null` and
`background: null`, which means application appearance defaults. There is no
Voice, Music, or Idle wizard step.

Identity uses the existing Markdown editor/renderer primitives with one string,
LF normalization, and the server's effective UTF-8 byte limit. A new draft is
seeded once with literal first line `# [NAME]`, followed by editable plain
Markdown for Personality, Speaking style, Values, Background, and Boundaries;
the seed alone is not a meaningful edit. An editable saved draft that still has
the exact previous untouched template gains the heading safely; customized
identity text and frozen submissions are not rewritten.
Write and Preview retain one editor instance and undo history. Tab leaves the
editor instead of inserting indentation. New creation and explicit rename use
a 1–40 Unicode-code-point name limit read from creation options. Existing
41–120-character live names remain readable until explicitly renamed. The
stage summary is a
bounded derived excerpt, not another persisted field or a model response.
Creator Markdown preview does not load remote images.

### Draft, retry, and first-chat boundaries

Drafts are scoped to the runtime owner and installation, with explicit
schema routing and an unsaved-VRM reselection marker. Editable schema v2 has no
Appearance selection state. Safe v1 null-appearance drafts migrate
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

No motion/audio auto-plays. The canvas has no persistent story/status card or
camera, zoom, and audio controls. Loading, preparation, and errors use transient
status, while individual Action rows own preview controls;
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
[Create Anima browser journeys](../testing/browser-journeys.md#create-anima-journeys)
provide regression coverage.

The 2026-08-31 owner acceptance closed implementation review while retaining
unperformed checks as residual coverage. Recorded browser evidence includes
Actions-to-Review, request-count optimization, and saved-draft recovery at desktop
and narrow widths. It is not evidence of complete Electron/native-picker,
physical input, assistive-technology or all first-chat journeys. Those checks
remain required when accepting a release that changes this surface. Record the
exact build, scenarios, results and remaining limits in the release review;
available test scripts do not establish that a journey was performed.

### Future publishing remains separate

Create Anima never creates a Blueprint, package, publication, or synchronization
relationship. There is no “Save as Blueprint” action. A separate future Publish
workflow will show the exact portable projection of a selected live Anima and
create an immutable Anima Blueprint/publication version only after confirmation.
Discover UI and all publication/acquisition infrastructure are deferred.
