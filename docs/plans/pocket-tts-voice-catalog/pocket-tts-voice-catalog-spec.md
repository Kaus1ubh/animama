# PocketTTS voice catalog with a grouped selector

Snapshot of [raymond-van/animama#142](https://github.com/raymond-van/animama/issues/142),
captured 2026-09-26T18:06:06Z. The issue is authoritative; refresh this file
from it before resuming.

Status: Agreed
Owner decision: 2026-09-26, the owner agreed the discovery decisions recorded
below: a curated core plus an optional downloadable catalog, candidate sources,
screening, set sizes and gender balance, hosting, a shared backend asset
downloader, selector shape and failure handling. The owner accepted this spec
by requesting the ExecPlan on 2026-09-26.

## Problem and intended users

PocketTTS, the local alternative to ElevenLabs, ships four built-in voices:
`eve` (default), `azelma`, `mary` and `jane`. They are Kyutai precomputed
`english_2026-04` voice states from VCTK recordings (CC BY 4.0), chosen in
[raymond-van/animama#130](https://github.com/raymond-van/animama/issues/130).

This creates two problems:

- The installation owner, as a user, has too few voices to find one that suits
  an Anima. The selector in Anima settings is a flat list with no gender,
  accent or recommendation cues.
- The installation owner, as maintainer, has no reproducible way to screen,
  curate and ship a larger set of voices that permit commercial use.

Both matter equally. The outcome is a small curated set in the core
distribution, a larger curated set users can sample and download one voice at
a time, and a selector that makes a good choice easy.

Downloading on demand is not specific to voices. The owner also wants it for
other model assets (the Parakeet models, the PocketTTS models and the WebGPU
encoder in [raymond-van/animama#144](https://github.com/raymond-van/animama/issues/144)),
all hosted on R2 in `animama-releases`. Desktop feature packs already download
large bundles, but activating one closes the app windows, which is unsuitable
for a 7 MB voice fetched during a chat. Web/self-host has no runtime download
at all. Optional voices are therefore the first consumer of a shared,
backend-owned asset downloader that later work can adopt.

## Goals, scope and non-goals

Included:

- **Candidate inventory and screening** of two sources:
  - the Kyutai `english_2026-04` precomputed states in
    `kyutai/pocket-tts-without-voice-cloning` (pinned revision
    `4e1e0a3e611c51c0b4ed8174fc10f32a54644303`): the four shipped voices plus
    the 17 licensed voices among the other 23;
  - the remaining VCTK speakers (CC BY 4.0), encoded by us.
- **Owner curation** on a developer listening page: a core set of about 15–20
  voices and an optional catalog of about 40–50, about 75% female in each, with
  recommended voices per gender.
- **Reproducible self-encoded voice states** from pinned source audio, published
  as pinned hosted artifacts.
- **Shared asset downloader**: a backend-owned service that downloads pinned,
  hash-verified assets from R2 into a writable installation store and serves
  them, on desktop and web/self-host. Optional voices are its only consumer in
  this work.
- **Optional voice catalog**: prerendered samples, one-voice downloads and
  removal, on desktop and on web/self-host.
- **Grouped selector** with voice metadata.
- Updated acquisition, runtime inventory, licence notices and docs.

Non-goals:

- `kyutai/tts-voices` volunteer donations, CML-TTS and Voice-Zero (LibriVox).
  The owner excluded the donations on 2026-09-26.
- Any NC-licensed or unknown-licence voice, including Kyutai's `cosette` and
  `jean` (CC BY-NC), `giovanni` and `lola` (unconfirmed Common Voice) and
  `juergen` and `rafael` (no documented source).
- A user-facing preview or attribution page. The listening page is for
  development only.
- Migrating saved preferences for the removed January voices (`cosette`,
  `jean`, `fantine`). The product has no users and the database will be reset;
  code references are already gone.
- Anima-specific emotion voice catalogs, voice-cloning UX changes and changing
  the model checkpoint.
- A remotely updated catalog. New optional voices ship with an app release.
- Moving existing assets to the shared downloader: the Parakeet feature pack,
  host acquisition of the core browser speech store, and the #144 encoder.
  They keep their current delivery until separate work adopts the downloader.
- Changing the release policy's noncommercial distribution basis
  (`distribution_basis.commercial: false`). That remains a separate owner
  decision.

## Required behavior

### Inventory and curation

- **R1.** Each candidate voice is recorded with its source dataset, speaker or
  file ID, licence, exact source revision and SHA-256, gender label, accent
  (from VCTK metadata where available) and screening results. Voices with an
  NC or unknown licence are excluded before screening.
- **R2.** An automated pre-screen renders fixed texts for each candidate with
  the shipped runtime (temperature 0.3, fixed seeds). It scores intelligibility
  with Parakeet word error rate and flags clipping, noise and silence problems.
  The results rank candidates per gender.
- **R3.** A developer-only listening page plays the top-ranked candidates per
  gender with their metadata and scores. From it the owner selects:
  - a core set of about 15–20 voices;
  - an optional catalog of about 40–50 voices;
  - the recommended voices in each group.

  Both sets are about 75% female. Voices not selected are dropped; the catalog
  is a curated subset, not every passing voice. If too few candidates of one
  gender pass screening, the owner decides whether to accept smaller sets or a
  different balance.
- **R4.** The default voice stays `eve` unless the owner changes it during
  curation.

### Self-encoded voice states

- **R5.** A checked-in, reproducible script produces each self-encoded state
  from pinned source audio: resample to 24 kHz, trim, run the FP32 Mimi
  encoder, prepend the BOS row, run the voice-conditioning pass through the
  shipped INT8 `flow_lm_main` graph, and write the resulting per-layer cache and
  offset in the same `.safetensors` state format as Kyutai's precomputed voices. Re-running it from the same inputs yields
  states that match the recorded hashes, or the plan records a justified
  tolerance.
- **R6.** Self-encoded states are published as pinned, hash-recorded hosted
  artifacts. Acquisition and the running app only download and verify them;
  they never run the encoder.

### Core set

- **R7.** Core voices ship in the core distribution and are acquired and
  verified like today's built-in voices, with their hashes and licences in the
  browser speech manifest.

### Shared asset downloader

- **R8.** A backend-owned downloader installs assets described by a pinned
  manifest entry (asset ID, R2 URL, size and SHA-256). It works the same way on
  desktop, whose app runs the installation's FastAPI, and on web/self-host.
- **R9.** It writes to a writable installation store that is separate from the
  read-only, host-acquired model store. An asset becomes visible only after its
  size and SHA-256 are verified, and it is installed atomically. A failed,
  cancelled or mismatched download leaves no partial asset. Installed assets
  persist across restarts and are served to the browser through FastAPI.
- **R10.** It reports install state per asset (not installed, downloading with
  progress, installed or failed with a reason) and supports removal.
- **R11.** It downloads only URLs from the pinned manifest in the running
  release, never a URL supplied by a request. Installing or removing an asset
  needs no app restart and does not close windows.
- **R12.** Its interface is general enough for later assets (Parakeet models,
  PocketTTS models and the #144 encoder) to adopt, but no existing asset moves
  to it in this work.

### Optional voice catalog

- **R13.** Each app release carries a hash-pinned catalog manifest. For each
  optional voice it lists the metadata (display name, gender, accent tags,
  recommended flag, licence, attribution), the voice-state asset and a
  prerendered sample with its URL and hash. The states and samples are hosted
  in the `animama-releases` R2 bucket.
- **R14.** From the selector, the user can play an optional voice's
  prerendered sample without downloading its voice state.
- **R15.** The user can download a single optional voice through the shared
  downloader. The voice becomes selectable only once it is installed. A failure
  reports a clear, retryable error.
- **R16.** If the resolved voice (an Anima settings override or the
  installation-wide Pocket voice preference) is an optional voice that is not
  installed, the app downloads it automatically and uses it once it is
  installed. Until then, speech uses the default voice.
- **R17.** If the automatic download cannot complete (offline, network error or
  verification failure), speech continues with the default voice. The app
  shows one notice per session, not one per reply, and retries quietly on a
  later reply or when connectivity returns. The saved selection is kept.
- **R18.** The user can remove a downloaded voice from the selector. Removal is
  refused, with the reason and the Animas that use it, while the voice is the
  installation-wide Pocket voice preference or any Anima's override. Otherwise
  the automatic download would immediately fetch it again.

### Selector

- **R19.** The Pocket voice selector in Anima settings groups voices into Male
  and Female. Recommended voices come first in each group.
- **R20.** Each voice shows its accent or other tags where known.
- **R21.** Within the selector, installed voices (core and downloaded) are
  visually distinct from voices available to download. Downloadable voices
  offer sample playback and download; downloaded voices offer removal.
- **R22.** The "Anima default" and custom (cloned) voice options keep their
  current behavior.

### Notices and inventory

- **R23.** Licence notices credit every shipped core voice. Every downloaded
  CC BY voice is credited in the app's notices, which therefore update when a
  voice is downloaded or removed. There is no per-voice credit in the selector.
- **R24.** Every hosted optional voice and sample has a licence record in the
  repository's third-party inventory. An automated check rejects a catalog
  manifest entry without a record, or with an NC or unknown licence.
- **R25.** Downloaded voices are outside the desktop core runtime inventory and
  core size caps; the pinned catalog manifest is part of the core inventory.
  Acquisition, the runtime inventory, licence records and docs cover the new
  core voices, the catalog manifest, the downloader and the encoding pipeline.
  The size impact of the core set is recorded against the desktop core caps.

## Constraints

- **Licensing:** only voices whose licence permits commercial use ship or are
  hosted: CC BY 4.0 for VCTK, and the documented licences of the Kyutai
  voices. CC BY sources need attribution. Kyutai's model-card prohibited-use
  terms still apply.
- **Size:** voice states are about 6–8 MB each. The desktop hard caps are
  750 MiB compressed core and 1.5 GiB installed core. The last stage measured
  430 MB download and 1.03 GB installed. A 15–20 voice core adds about
  110–150 MB installed (compression of the states is not yet measured), and
  must stay under the caps without a size exception.
- **Pinned inputs:** source audio, Kyutai states, self-encoded states, samples
  and the catalog manifest are pinned by revision and SHA-256. There are no
  moving branches or unverified bytes.
- **Runtime downloads are new for web/self-host.** Today the browser speech
  store is acquired on the host, verified offline and mounted read-only; the
  backend and browser never download models at runtime. The downloader adds
  backend egress to R2 and a writable store. It must not modify the read-only
  store, and it must keep the loopback and private-service boundaries. The
  browser still never downloads models directly.
- **Desktop feature packs** remain the delivery for large, versioned bundles
  that need a service switch (such as `parakeet-stt`). The downloader handles
  data assets that can be installed without a restart. The plan must document
  this boundary, and reuse the packs' verification code where practical rather
  than duplicate it.
- **Offline:** core voices must keep working offline. Optional voices degrade
  as in R17.

## Acceptance criteria

- [ ] A documented inventory covers every candidate with source, licence,
      revision, hash, gender, accent and screening result. No NC or
      unknown-licence voice ships or is hosted. (R1, R2, R24) Evidence: the
      inventory file, a review of it, and the automated manifest licence check.
- [ ] The encoding script reproduces the published states from pinned inputs.
      (R5, R6) Evidence: a re-run matching recorded hashes or the tolerance.
- [ ] Owner listening acceptance of the core set, the catalog, the gender
      balance and the recommended flags on the developer page. (R3, R4)
      Evidence: a dated owner decision in the plan.
- [ ] The downloader verifies, installs, serves, reports and removes an asset;
      a corrupted, interrupted or cancelled download leaves nothing installed;
      a URL outside the pinned manifest is refused. (R8–R11) Evidence:
      automated backend tests.
- [ ] The selector shows Male and Female groups with recommended voices first,
      accent tags, and installed and downloadable voices distinguished. (R19–R22)
      Evidence: browser verification at desktop size, then a narrow layout.
- [ ] On desktop and web/self-host, a user plays an optional voice's sample,
      downloads it and speaks with it without a restart. After a restart it is
      still installed. (R14, R15) Evidence: manual verification on both
      surfaces.
- [ ] With a selected optional voice not installed, speech uses the default,
      the voice downloads automatically, and later replies use it. Offline, one
      notice appears per session and speech continues with the default. (R16,
      R17) Evidence: automated tests plus a manual offline check.
- [ ] Removing an unused downloaded voice succeeds; removing one in use is
      refused and names its users. (R18) Evidence: automated tests.
- [ ] Notices credit core voices and each downloaded CC BY voice. (R23)
      Evidence: rendered notices before and after a download.
- [ ] Acquisition, the runtime inventory, licence records and docs are updated,
      and the core size impact is recorded under the caps. (R7, R25) Evidence:
      `browser_speech.py acquire`/`verify`, the runtime stage and audit, and
      docs review.

## Open questions and decisions

Agreed on 2026-09-26:

- Audience: end users and the owner equally.
- A curated core set of about 15–20 voices and a curated optional catalog of
  about 40–50, each about 75% female. No user-facing preview page.
- Candidate sources: the licensed Kyutai voices and the remaining VCTK
  speakers. The `kyutai/tts-voices` donations, CML-TTS and Voice-Zero are
  excluded.
- An automated pre-screen, then owner listening on a developer page.
- Self-encoded states are pinned hosted artifacts, not generated at acquire time.
- Hosting in the `animama-releases` R2 bucket, one-voice downloads and a
  manifest pinned per release.
- A shared, backend-owned asset downloader for desktop and web/self-host, with
  optional voices as its first and only consumer in this work.
- A missing selected voice is downloaded automatically; offline or on failure,
  speech uses the default voice with one notice per session and a quiet retry.
- Attribution appears in notices only.
- No migration for the removed January voices.
- Delegated to the agent by the owner: downloaded voices can be removed unless
  in use (R18); downloaded voices are outside the core inventory and caps,
  while the catalog manifest and licence records are checked (R24, R25).

Open, non-blocking; the plan or curation resolves them:

- Pre-screen thresholds and the number of candidates per gender shown for
  listening.
- The R2 URL layout for voice states and samples.
- Gender labels for any candidate without dataset metadata.
- The writable store's location on each surface, and whether the downloader
  shares code with the feature pack downloader.

## Spec

[raymond-van/animama#142](https://github.com/raymond-van/animama/issues/142) (authoritative).

## ExecPlan

Required: the work spans curation, a hosted artifact pipeline, a new shared
downloader on two surfaces and the selector. Draft:
[pocket-tts-voice-catalog-execplan.md](pocket-tts-voice-catalog-execplan.md).

## Delivery links

Phase issues: #150 (P1), #151 (P2), #152 (P3), #153 (P4), #154 (P5).
