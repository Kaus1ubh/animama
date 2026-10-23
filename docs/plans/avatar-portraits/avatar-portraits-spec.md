# Avatar portraits that match the chat canvas

Status: Agreed
Owner decision: 2026-10-22 — 512 px portraits in the chat canvas's enhanced
look and capture wired into Create Anima; spec and plan accepted the same day
with the proposed answers to Q1–Q7.
Snapshot of https://github.com/raymond-van/animama/issues/658 as published
2026-10-22; the issue is authoritative.

## Problem and intended users

The installation owner sees Avatar portraits in the Library Avatar rows and as
the Anima portrait fallback (Anima list, carousel, chat search, Anima details)
when no custom Profile image is bound.

Today:

- An uploaded (Local) Avatar never gets a portrait. `preview_url` is null and
  the Library shows a generic icon. Its Animas fall back to initials.
- The capture code (`captureAvatarPortrait`, `AvatarPortraitGenerationCoordinator`)
  and the save endpoint `PUT /v1/avatar-content/{item_id}/portrait` exist, but
  only a development harness calls them.
- The Included portraits are 256² WebP rendered with portrait-only lights and
  no tone mapping or antialiasing. They look darker and harsher than the same
  Avatar on the chat canvas: mean RGB difference 12–19/255 against a chat
  render with the same framing.
- The Anima presentation join (`anima_presentation_repo.py`) only finds
  Included portraits, by model file stem. A Local portrait would not reach
  Anima presentation even if one were saved.

A prototype (retained by maintainers) renders the portrait through the chat
canvas's lights, tone mapping, 4x MSAA and canvas grade, at 1024² stored as
512². Its portraits are 1.1–1.6/255 from the chat reference. On an Apple M5 a
capture takes about 0.1–0.17 s on a warm stage (about 0.8 s from VRM bytes);
the backend's WebP encode adds about 2.5 s at `method=6`.

## Goals, scope and non-goals

In scope:

- The enhanced 512² portrait for every new capture.
- Automatic, non-blocking capture of a missing portrait for a Local Avatar in
  Create Anima.
- One current portrait per Local Avatar, visible wherever Included portraits
  appear today.
- A regenerated Included portrait for Annie (`AvatarSample_A_1_New`), and for
  Andrew once his replacement model is on `main` (R13), with updated metadata
  and licence records.

Non-goals:

- Re-encoding the starter VRM files (a separate plan on
  `perf/starter-vrm-optimization`).
- Regenerating existing Local portraits when the renderer version changes. The
  stored versions make that possible later.
- Capturing portraits outside Create Anima (Library, Anima details, import).
- Removing a portrait when its Local Avatar is deleted (see Q6).
- Publishing a new content pack or repinning hosted starter content in Animama
  Cloud. Cloud adopts the new Included portraits through its own reviewed
  repin.
- Changing the development `/avatar-portrait-debug` harness beyond what the
  shared capture changes require.

## Required behavior

### Portrait image

- **R1 Look.** A capture renders the Avatar with the chat canvas's scene
  lights, tone mapping and exposure, 4x MSAA, sRGB output and canvas grade, on
  a transparent background with no backdrop glow. Framing and the happy
  expression are unchanged. The live stage is restored exactly afterwards
  (render target, viewport, scissor, clear colour, tone mapping, colour space,
  visibility, lights). The capture records renderer version 2 and capture
  preset version 3.
- **R2 Size.** The browser captures 1024². The save endpoint admits exactly a
  1024² static WebP and stores a 512² WebP of at most 256 KiB. A 512² source
  is rejected with `avatar_portrait_dimensions`. The existing transparency,
  blank and opaque-background checks still apply.
- **R3 Presentation bound.** Anima presentation images
  (`PyRuntimeImageReference`) accept 512² portraits, so the Anima list and
  detail responses still validate in the browser. Today both the backend model
  and the generated zod schema cap width and height at 256; the Pydantic list
  route bypasses that cap, but the browser rejects the response.

### Saving one portrait per Avatar

- **R4 Upsert.** A Local Avatar has at most one portrait. Saving a portrait for
  an Avatar that already has one replaces it in place (same Appearance item,
  new revision). Repeating a save with the same `operation_id` is idempotent,
  as today. A stale `expected_avatar_revision` still returns
  `409 catalog_revision_conflict` and changes nothing. Saving still never
  changes the Avatar or any Anima.
- **R5 Portrait field.** Avatar content responses (`PyAvatarContent`) say
  whether the Avatar has a portrait: its URL, the Avatar revision it was
  captured from, and its renderer and capture preset versions, or null.
  Included Avatars report their shipped portrait. The Avatar catalog's
  `preview_url` keeps its current meaning.

### Create Anima capture

- **R6 When.** When the Create Anima stage reports ready for a Local Avatar
  whose portrait is missing or was captured from a different Avatar revision,
  the browser captures and saves a portrait in the background. This covers an
  Avatar just saved from an upload (the stage reloads it as a Local Avatar) and
  a Local Avatar chosen from the list. It never runs for Included Avatars or for
  an unsaved VRM file preview.
- **R7 Non-blocking.** Capture and save never block or delay step navigation,
  draft saving or Anima submission, and show no toast or spinner. The attempt is
  abandoned after about 15 s, when the stage source changes or unmounts, or when
  the page is hidden. A failure is logged for diagnosis and not retried for that
  Avatar revision during the page session; the next visit may try again. A late
  save still completes on the server if the browser already sent it.
- **R8 No visible disturbance.** The stage shows no flash, pose change or
  dropped interaction while capturing. At most one capture per Avatar revision
  runs at a time.

### Where portraits appear

- **R9 Anima presentation.** An Anima whose Avatar is a Local Avatar with a
  portrait shows that portrait wherever the Included portrait fallback shows
  today, unless a custom Profile image is bound. The exact Avatar match wins
  over the Included stem match. Included Animas are unchanged.
- **R10 Library.** The Library Avatar row shows the Local portrait (already the
  case once one exists, through `preview_url`).
- **R11 Appearance lists (Q5).** Generated portraits do not appear
  among the Local images offered for an Anima's Profile or Background.
- **R12 Sharing.** Export and import keep carrying an Avatar's exact portrait,
  as today.

### Included portraits

- **R13 Regenerated.** Annie's Included portrait is replaced by a 512² capture
  in the new look. Andrew's is regenerated only from the replacement Andrew
  model that the starter VRM plan (`perf/starter-vrm-optimization`) ships,
  never from the current `Andrew.vrm`: if that plan is on `main` first, this
  work captures the new Andrew; otherwise Andrew keeps his current 256²
  portrait here, and that plan captures him with this generator. A regenerated
  portrait's `.meta.json` records width and height 512, renderer version 2 and
  capture preset version 3. File stems, content IDs and names do not change, so
  Anima and Avatar links are unaffected.
- **R14 Licence records.** `content/included/licenses/inventory.json`,
  `licenses/source-review.json` and `licenses/third-party/art-vroid-review.json`
  describe the new renderer output and record the new hashes.

## Constraints

- **Compatibility.** During development the baseline SQL may change directly;
  no Alembic revision. Existing 256² Local or Included portraits remain valid
  catalog items and keep displaying until replaced. The public HTTP contract
  changes (R3, R5) regenerate the SDK through `pnpm openapi-ts`.
- **Ownership.** Saves go through the existing owner-scoped content mutation
  path; the Avatar must be a current visible Avatar of the caller.
- **Performance.** Capture adds no work to the chat canvas's frame loop. The
  Create Anima stage frame that captures may take up to about 200 ms on the
  reference machine; ordinary frames are unaffected.
- **Rendering support.** Desktop (Electron, Chromium) is the delivery target.
  The capture must not fail where half-float colour buffers or the canvas
  `filter` property are unavailable; it may then produce a lower-fidelity
  image (see Q4).
- **Privacy.** Portraits are local derivatives of the owner's Avatar; nothing
  is sent to a provider.
- **Licensing.** Included portraits follow their model's terms; release and
  redistribution approval stay separate.

## Acceptance criteria

- [ ] R1: unit tests cover lights, tone mapping, MSAA target, grade and state
  restoration. A browser render of both Included Avatars is within 3/255 mean
  RGB of a chat-canvas render with the same framing (enhanced rendering on).
- [ ] R2: backend tests accept 1024² and store 512² ≤ 256 KiB, and reject 512².
- [ ] R3: an Anima list response with a 512² portrait parses with the
  generated client (test), and the Anima list renders it in the browser.
- [ ] R4–R5: API tests show a second save replaces the first portrait (one
  Appearance item, new revision), idempotent replay, stale-revision `409`, and
  the portrait field on Local and Included Avatars.
- [ ] R6–R8: frontend tests show capture runs once for a Local Avatar without a
  current portrait, never for Included or unsaved files, never blocks
  navigation or submission, and times out or aborts cleanly. A browser check on
  a local stack: upload a VRM, save it, and see its portrait in the Library and
  on the new Anima without reloading the page.
- [ ] R9: repository test for the Local exact-match join and its precedence.
- [ ] R11: test per Q5's decision.
- [ ] R12: existing export/import portrait tests pass.
- [ ] R13–R14: content and licence checks pass; the owner looks at the new
  Included portraits in the Library and Anima carousel (light and dark theme).
- [ ] Owner visual check: a newly captured Local portrait matches the chat
  canvas look.

## Open questions and decisions

Agreed (2026-10-22, owner): 512² stored portraits in the chat canvas's
enhanced look; capture in Create Anima is acceptable because it is quick; this
work regenerates the Included portraits. Later the same day the owner decided
Andrew is replaced by a new VRoid export shipped through the starter VRM plan;
Andrew's portrait is not regenerated from the current model (R13).

Decided 2026-10-22 (owner accepted each proposal):

- **Q1 WebP encoder effort.** The shared encoder uses `method=6` with lossless
  alpha: about 2.5 s for a 512² portrait inside the save. `method=5` takes about
  0.02 s for files under 2% larger. Decision: use `method=5` for all Appearance
  image encodes.
- **Q2 Enhanced regardless of setting.** The capture uses the live stage
  Avatar, whose materials were chosen by the enhanced-rendering setting when it
  loaded. Decision: follow the setting (on by default), so the portrait matches
  what the owner sees in chat. Always forcing the enhanced look would need a
  second, offscreen Avatar load for owners with the setting off.
- **Q3 Embedded VRM thumbnail fallback.** Decision: no. Capture finishes about
  a second after the stage is ready, many VRMs carry no or unrelated
  thumbnails, and their look would differ from every other portrait.
- **Q4 Safari and hosted web.** Half-float render targets need a float colour
  buffer extension, and Safari's support for the 2D canvas `filter` property is
  unverified. Decision: apply the grade (brightness, contrast, saturation) in
  the output shader instead of a canvas filter, and fall back to an 8-bit scene
  target when float colour buffers are unavailable. Verify with Playwright
  WebKit where practical; real Safari remains an unperformed check.
- **Q5 Appearance lists.** Decision: hide generated portraits from the Local
  images offered for Profile and Background, since the portrait is already the
  fallback and auto-generated items would otherwise accumulate there.
- **Q6 Avatar deletion.** A deleted Local Avatar leaves its portrait behind.
  Decision: defer to a follow-up issue.
- **Q7 Effect Library thumbnails.** The effect review renderer
  (`scripts/effect-render`) also calls `captureAvatarPortrait` for Library
  thumbnails, so new thumbnails would get the chat look while committed ones
  keep the old one. Decision: one capture pipeline for both; re-rendering the
  committed effect thumbnails is a follow-up.

## Spec

https://github.com/raymond-van/animama/issues/658

## ExecPlan

[avatar-portraits-execplan.md](avatar-portraits-execplan.md), reviewed at `795134e5`.

## Delivery links

None yet.
