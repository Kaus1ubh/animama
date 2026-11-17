# Final desktop release before distribution ends

Status: Agreed
Owner decision: agreed by the owner on 2026-11-04 with the recommended answers
to the open decisions. It refines decision D5 of the
[open-source readiness plan](../open-source-readiness/open-source-readiness-execplan.md).
Authority: [#837](https://github.com/raymond-van/animama/issues/837). This file
is a snapshot of that issue captured 2026-11-04T17:24:54Z; change the issue,
not this file.

## Problem and intended users

Before 2027-01-01 the owner stops serving `downloads.animama.ai`: the desktop
installers, the update feed, feature packs and the model files that the app
downloads at runtime (D5, 2026-11-02). Today every build from this source
assumes that host exists:

- A packaged desktop app checks the feed 15 seconds after it starts and again
  when the person chooses **Check for updates**. Signed macOS preview builds
  0.1.0, 0.1.1 and 0.1.2 are published under `downloads.animama.ai/desktop/`;
  no stable feed has been published, so their checks fail quietly today.
- Settings, first-run setup, the voice picker and voice cloning offer downloads
  of the offline speech recognition sets (Parakeet, SenseVoice-Small and their
  GPU add-ons), 35 Pocket voices and the voice-cloning encoder. The backend
  fetches them from `downloads.animama.ai/models/` on desktop, built self-host
  and development stacks. After the cut-off these controls would offer
  downloads that can only fail.
- `parakeet.py acquire` and `sensevoice.py acquire` download from
  `downloads.animama.ai` unless `--source upstream` is given.
- The packaged notices lag the licence records: neither the desktop nor the
  hosted notice bundle carries the adapted UI-code and Hey API notices
  (`licenses/third-party/adapted-code.md`), the packed `runtime-contracts`
  package ships only the AGPL `LICENSE` although it contains Hey API's MIT
  client runtime, and `included-content-attribution.txt` credits LeLu's Noise
  Pack, which is excluded and ships nowhere.

People who installed a desktop build need a last version that keeps working
without Animama's servers and says plainly what has ended. Self-hosters and
people running from source need defaults that do not depend on the host. The
owner needs a release that meets the licence records and a written plan for
the transition and the disconnection.

## Goals, scope and non-goals

In scope: requirements R1 to R7, their tests and documentation. This source
becomes the final desktop release; building, reviewing and publishing it stay
owner-run.

Out of scope:

- Hosting new releases or model files anywhere else, and any change to what
  Animama Cloud serves. Cloud keeps a copy of `included-content-attribution.txt`
  and references `downloads.animama.ai` in its landing links, privacy terms and
  operator dashboard; those are Cloud follow-ups listed in the plan.
- An import path that lets an installed app take model files from disk. D5
  mentions explaining "how to supply model files"; #837 narrowed this to
  explaining what still works (see open decision 6).
- Removing the update, feature-pack, model-download or R2 publishing code.
  It stays, unused by this source, for tests and for modified builds that
  publish to their own hosts.
- #838's hardening. It coordinates with this work but is delivered there.
- The landing page's adapted `text-shimmer.tsx` credit, which belongs to the
  landing notices rather than the desktop or hosted bundle (follow-up).

## Required behavior

### R1: Builds from this source never check for updates

- **R1.1** The desktop release policy records that updates have ended. Staging
  seals that into the runtime's update policy, which the signed app verifies
  like the rest of its resources. Nothing read at run time (the feed, an
  environment variable, a setting) can turn update checks back on.
- **R1.2** A packaged app whose sealed policy says updates have ended makes no
  request to its distribution: no feed check at startup or on request, no
  updater network session. Its update status is `unavailable`, so the Settings
  row and the update notice disappear as they do for an unpackaged app. A
  download or restart request is refused as it is when updates are not
  configured.
- **R1.3** Staging refuses an active feature pack when updates have ended, so
  the final build's pack catalog is empty and the app never downloads a pack.
  (No pack has ever been released; both are deferred.)
- **R1.4** The release tooling still publishes the final release and its stable
  feed to the selected distribution, so earlier builds can update to it.
- **R1.5** The installed-artifact smoke expects the ended state: it records that
  the exact signed app reports `unavailable` for updates, instead of requiring
  a verified publisher through the update check.

### R2: Model downloads have ended

- **R2.1** In every local composition (packaged desktop, built self-host and
  development) the model-asset service no longer downloads. Installing an
  asset that is not installed is refused with the stable code
  `model_downloads_ended` before any network request or staging. An installed
  asset is returned as installed.
- **R2.2** Installed assets keep working: verification, activation, leases,
  content serving and removal are unchanged, and removal still frees the space.
- **R2.3** The model-asset list states that downloads are not offered, so the
  interface can explain it before anyone presses a button.
- **R2.4** The hosted composition is unchanged: its operator-managed responses
  and the shared catalog parser keep their behavior, so Cloud needs no change
  for correctness.

### R3: Download controls explain what has ended and what still works

Wherever the app offered a model download, it shows in its place that Animama
no longer offers downloads and that anything already downloaded keeps working;
chat, Avatars and the built-in voices need no downloads.

- **R3.1** Offline speech recognition, in first-run setup and in Settings: no
  Download or Retry button and no download size for a set that is not
  installed; installed sets keep their Remove action. Notices that told the
  person to download a speech model say instead that it can no longer be
  downloaded.
- **R3.2** Pocket voices: a downloadable voice that is not installed is shown as
  not available and cannot be chosen or downloaded; installed voices and the
  three built-in voices work as before. Choosing a voice never starts a
  download, and a reply that would have installed a missing voice speaks with
  the default voice, with a notice that the voice can no longer be downloaded.
- **R3.3** Voice cloning: when the encoder is not installed, the cloning status
  and dialog explain that it can no longer be downloaded instead of offering
  the download; an installed encoder keeps cloning and Remove.
- **R3.4** Document uploads on desktop no longer tell the person to install the
  document-processing pack in Settings; they say document processing is not
  available in this app.
- **R3.5** The wording exists in every UI locale (English plus the beta
  locales Japanese, Korean, Simplified and Traditional Chinese), using the term
  list. The hosted operator-managed wording and the development note about
  host speech models are unchanged.

### R4: Source scripts default to the original publishers

- **R4.1** `parakeet.py acquire` and `sensevoice.py acquire` download from
  their pinned Hugging Face sources by default (`--source upstream`).
  `--source animama` stays available until the host is disconnected, and its
  help says so. Hash and size verification are unchanged.
- **R4.2** Scripts that already use upstream sources are unchanged. The 24
  Pocket voices that Animama encoded have no upstream; `pocket_voices.py`
  keeps its sources and its documentation says it stops working after the
  cut-off unless the set is imported from disk.

### R5: Packaged notices match the licence records

- **R5.1** The desktop notice bundle (`THIRD_PARTY_NOTICES.txt` and its
  inventory) includes `adapted-code.md` and the upstream licence texts it
  links for code that ships in the app: shadcn/ui, Magic UI, Motion
  Primitives, ElevenLabs UI, Vercel AI Elements with the Apache License 2.0,
  Lucide, Letta, the OpenAI Agents SDK and Hey API. The texts come from
  `licenses/third-party/`, not from copies.
- **R5.2** The hosted web build's `notices/` carries the same files.
- **R5.3** The packed `runtime-contracts` tarball contains a notice with Hey
  API's MIT licence beside its AGPL `LICENSE`, and the packed `product-ui`
  tarball one for its adapted UI code; the packed-artifact check fails if
  either is missing.
- **R5.4** `included-content-attribution.txt` no longer credits LeLu's Noise
  Pack, and no longer says the Kenney and Brackeys licence files are packaged
  (only derivatives ship; both packs are CC0).
- **R5.5** Every new or changed file has its `licenses/source-review.json`
  entry, and `check_source.py` passes.

### R6: Current documentation describes the final release

- **R6.1** `docs/frontend/desktop/installation.md` no longer says no signed
  public release exists; it describes the published previews, the final
  release's behavior and the end of downloads.
- **R6.2** The README's distribution and connection paragraphs, the crisis
  protocol's list of desktop connections (all five translations) and the
  release, model-asset and script documentation match R1 to R4.

### R7: Transition and disconnection plan

- **R7.1** The release documentation contains an owner runbook for the final
  release (version, gates, fresh per-target redistribution reviews, stable
  publication), the transition (the feed stays up so earlier builds update) and
  the cut-off: disconnect `downloads.animama.ai` from the R2 bucket, verify
  from outside that nothing is served, keep `animama.ai` registered and never
  reuse the `downloads` host name, because installs that never take the final
  release keep contacting it. It names the rollback (reconnect the domain
  while the bucket exists) and the Cloud follow-ups.
- **R7.2** The final release is 0.1.3 for macOS, newer than every published
  preview; published version folders are immutable. No Windows build is
  released.

## Constraints

- **Security.** The ended state is part of the signed build, never fetched.
  Fewer outbound requests only; no new request, origin or IPC surface.
- **Compatibility.** Existing installations keep their data, installed model
  assets and settings. The update-policy schema change applies only to builds
  from this source; each build reads its own sealed policy. Hosted responses
  keep their shape; any shared-contract change is additive and optional.
- **Packaging.** Notice changes and #845's lockfile changes invalidate both
  stored redistribution receipts. The owner restages each target and records
  fresh receipts at release time; agents never write them.
- **Coordination.** #838 edits `main.ts`, the smoke journey and the release
  documentation; whichever merges second resolves the overlap. The final
  release should be built after the #838 fixes the owner wants shipped,
  because no later desktop build will carry fixes.
- **Accessibility.** Explanations replace controls as text with the same
  semantics as the existing notes (no disabled button left without a reason).
- **Cost.** No paid provider calls are needed.

## Acceptance criteria

- [ ] With a sealed policy whose updates have ended, the main process creates
  no updater and reports `unavailable`; unit tests cover policy validation,
  the main-process decision and staging's refusal of an active pack. On the
  signed final candidate, the smoke records the ended state and the native
  network check shows no request to `downloads.animama.ai` (owner-run release
  evidence).
- [ ] Backend tests show the local service refuses installs with
  `model_downloads_ended` without fetching, keeps installed assets working and
  removable, and lists downloads as not offered; existing download tests still
  pass with downloads offered.
- [ ] Vitest covers each control in R3 in the ended state; a stack check shows
  setup, Settings → Voice, the voice picker and voice cloning with the ended
  wording at desktop width; `pnpm i18n:check` passes and every beta catalog has
  the new keys.
- [ ] Script tests show `acquire` defaults to upstream sources.
- [ ] A development stage of the macOS runtime contains the adapted-code and Hey
  API notices and no LeLu credit; `pnpm web:build:hosted` output contains the
  same notices; the packed `runtime-contracts` tarball contains its notice;
  `check_source.py` passes.
- [ ] The documents in R6 and the runbook in R7 match the delivered behavior.
- [ ] The full pre-push suite and the fast browser journeys pass on the final
  candidate.

## Open questions and decisions

Settled (2026-11-02, D5): a final release, then the domain cut-off; the
switch is built into the release, not read from the feed; `animama.ai` and the
download host stay registered under the owner's control.

Decided by the owner on 2026-11-04, with this spec and its ExecPlan:

1. **Release timing and version.** 0.1.3, built after the #838 fixes the owner
   wants in the last desktop build have merged. Agents noted that #838's R5
   (update-download checks) protects no one once the final build never
   updates, because earlier builds that take the final update run their own
   older updater; whether to drop it is #838's decision.
2. **Targets.** macOS only. No Windows build has been published, and none will
   be.
3. **Transition length.** About four weeks after stable publication, ending no
   later than 2026-12-31.
4. **Where model downloads end.** In every local composition (packaged
   desktop, built self-host and development) from this merge.
5. **`product-ui` notice.** The packed `product-ui` package gets the same
   treatment as `runtime-contracts`: a notice for its adapted shadcn/ui, Magic
   UI, Motion Primitives, ElevenLabs UI and AI Elements code (R5.3).
6. **Supplying model files.** Installed apps get no import path; source users
   acquire speech sets with the scripts.
7. **After the cut-off.** Keep the R2 bucket and its retention locks, so the
   domain can be reconnected.

## Spec

This document until agreed; then
[#837](https://github.com/raymond-van/animama/issues/837).

## ExecPlan

[final-desktop-release-execplan.md](final-desktop-release-execplan.md).

## Delivery links

Pending.
