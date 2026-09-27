# Expanded PocketTTS voices with a grouped selector and on-demand downloads

Snapshot of [raymond-van/animama#142](https://github.com/raymond-van/animama/issues/142),
captured 2026-09-27T02:52:43Z. The issue is authoritative; refresh this file from it
before resuming.

Status: Agreed (revised 2026-09-26 at gate G1 and 2026-09-27 for downloads)
Owner decision:
- **2026-09-26 (discovery):** the owner agreed the candidate sources,
  screening, gender balance, hosting, selector shape and failure handling, and
  accepted the spec by requesting the ExecPlan.
- **2026-09-26 (gate G1):** after listening, the owner selected 38 voices and
  made all of them core, with no optional downloadable catalog. `eve` stays
  the default. The two donation voices `javert` and `marius` are restored as
  recommended voices. The shared asset downloader built for the catalog moved
  to its own issue
  ([raymond-van/animama#151](https://github.com/raymond-van/animama/issues/151),
  draft PR [raymond-van/animama#162](https://github.com/raymond-van/animama/pull/162)),
  to merge with its first consumer.
- **2026-09-27 (size):** the owner judged the extra core size of 38 voices
  (about 230 MB) unacceptable.
  - **Split:** `eve` and the 14 recommended voices stay core. The other 23
    download on demand through the shared downloader merged in
    [raymond-van/animama#180](https://github.com/raymond-van/animama/pull/180).
  - **Surfaces:** it works on desktop and self-host alike.
  - **Picking:** choosing a voice that isn't installed saves it and downloads
    it automatically, with a subtle progress icon.
  - **Hosting:** all Animama-hosted voice states use #180's immutable
    `models/<model-id>/<sha256>/<file>` layout.
  - **Publishing:** the agent runs publication with a bucket-scoped token from
    an owner-only env file.

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

The outcome is 38 curated voices: 15 in core and 23 downloaded on demand, with
a selector that makes a good choice easy.

## Goals, scope and non-goals

Included:

- **Candidate inventory and screening** of two sources:
  - the Kyutai `english_2026-04` precomputed states in
    `kyutai/pocket-tts-without-voice-cloning` (pinned revision
    `4e1e0a3e611c51c0b4ed8174fc10f32a54644303`);
  - the remaining VCTK speakers (CC BY 4.0), encoded by us.
- **Owner curation** on a developer listening page.
- **Reproducible self-encoded voice states** from pinned source audio, published
  as pinned hosted artifacts.
- **38 voices** (27 female, 11 male), 14 of them recommended.
  - **Core (15):** `eve` and the 14 recommended voices.
  - **Downloadable (23):** the rest, installed on demand through the shared
    backend downloader (#180) on desktop and self-host.
- **Grouped selector** with voice metadata and download state.
- Updated acquisition, runtime inventory, licence notices and docs.

Non-goals:

- **Excluded sources:** `kyutai/tts-voices` volunteer donations (except the
  owner-restored Kyutai states `javert` and `marius`), CML-TTS, and encoding
  new voices from Voice-Zero. Kyutai's precomputed Voice-Zero states are
  candidates.
- **Excluded licences:** any NC-licensed or unknown-licence voice, including
  Kyutai's `cosette` and `jean` (CC BY-NC), `giovanni` and `lola`
  (unconfirmed Common Voice), and `juergen`, `rafael` and `daan` (no
  documented source).
- **Download extras:** prerendered samples before download, and a UI for
  removing downloaded voices. The downloader's DELETE route exists, but
  nothing in the picker uses it yet.
- **The downloader itself:** it was delivered in #180 and is reused unchanged
  apart from voice catalog entries.
- **Preview and attribution UI:** a user-facing preview or attribution page.
  The listening page is for development only.
- **Old preferences:** migrating saved preferences for the removed January
  voices (`cosette`, `jean`, `fantine`). The product has no users and the
  database will be reset.
- **Other voice work:** Anima-specific emotion voice catalogs, voice-cloning
  UX changes and changing the model checkpoint.
- **Release policy:** changing the noncommercial distribution basis
  (`distribution_basis.commercial: false`) remains a separate owner decision.

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
- **R3.** A developer-only listening page plays every screened candidate with
  its metadata and scores. The owner selects the shipped set and the
  recommended voices from it. At G1 the owner chose 38 voices (27 female,
  11 male) and 14 recommended; voices not selected are dropped. On 2026-09-27
  the owner set core to `eve` plus the recommended voices.
- **R4.** The default voice stays `eve`.

### Self-encoded voice states

- **R5.** A checked-in, reproducible script produces each self-encoded state
  from pinned source audio. It resamples to 24 kHz, runs the FP32 Mimi
  encoder and prepends the BOS row. It then runs the voice-conditioning pass
  through the shipped INT8 `flow_lm_main` graph and writes the resulting
  per-layer cache and offset in the same `.safetensors` state format as
  Kyutai's precomputed voices.

  Re-running it from the same inputs yields states that match the recorded
  hashes. The recipe reproduces Kyutai's own VCTK states within a recorded
  tolerance.
- **R6.** Animama-hosted voice states are published to the `animama-releases`
  R2 bucket under `models/pocket-tts-voices/<sha256>/<id>.safetensors`. That
  covers the self-encoded core states and every downloadable state, Kyutai's
  included. Publication uses the repository's staged, scanned, create-only
  model publication, and the objects are immutable. Acquisition and the
  downloader verify the bytes; neither runs the encoder.

### Core set

- **R7.** The 15 core voices ship in the core distribution and are acquired
  and verified like today's built-in voices, with their hashes and licences in
  the browser speech manifest. Kyutai core states keep their Hugging Face
  pins; self-encoded core states come from the release host.
- **R8–R18. Withdrawn at G1 (2026-09-26).** The downloader is delivered by #180.
  Downloadable voices are specified afresh in R26–R30.

### Selector

- **R19.** The Pocket voice selector in Anima settings groups voices into
  Female and Male. Recommended voices come first in each group.
- **R20.** Each voice shows its display name and an accent tag where known.
- **R21.** Every voice is listed and selectable. A downloadable voice that is
  not installed shows a subtle download indicator. While it downloads, a
  subtle progress icon replaces the indicator.
- **R22.** The "Use application default" and custom (cloned) voice options
  keep their current behavior. A saved voice that is not in the list falls
  back to the default voice. The user sees one notice per session, not one per
  reply.

### Notices and inventory

- **R23.** Licence notices credit every shipped voice with its source
  recording, as the current Pocket attribution notice does for the four
  voices.
- **R24.** Every shipped voice has a licence record in the repository's
  third-party inventory. An automated check rejects a shipped voice without a
  record, or with an NC or unknown licence.
- **R25.** Acquisition, the runtime inventory, licence records and docs cover
  the new core voices and the encoding pipeline. The size impact is recorded
  against the desktop core caps.

### Downloadable voices

- **R26.** Each downloadable voice has a pinned entry in the packaged asset
  catalog (`model-assets.v1.json`): ID, `downloads.animama.ai` URL, size,
  SHA-256 and licence. A tracked `models/pocket-tts-voices/manifest.json` binds
  the published set.
- **R27.** Selecting a downloadable voice that is not installed saves the
  preference and starts its download. It works on desktop and self-host, with
  no restart. Speech uses the default voice until the download is installed,
  then uses the selected voice without a reload.
- **R28.** If a saved downloadable voice is not installed (a fresh install,
  cleared data, or another device), the app starts the download when it first
  needs the voice.
- **R29.** A failed download (offline, host error or verification failure)
  leaves nothing installed. Speech continues with the default voice. The app
  shows one notice per session and retries quietly on a later reply or pick.
- **R30.** The worker loads a downloaded state from the downloader's content
  route (`/v1/model-assets/<id>/content`); core states still load from
  `/onnx/models/pocket-tts/voices/`.
## Constraints

- **Licensing:** only voices whose licence permits commercial use ship: CC BY
  4.0 for VCTK and Alba MacKenna, and CC0 for Voice-Zero, Kyutai's own
  recording and the two donation voices. CC BY sources need attribution.
  Kyutai's model-card prohibited-use terms still apply.
- **Size:** voice states are about 6–8 MB each, and they barely compress.
  - **Measured:** all 38 in core measured 654 MB download (the owner rejected
    that). The 15 core voices should add about 80 MB over the original four.
  - **Caps:** 750 MiB compressed core and 1.5 GiB installed core.
  - **Downloads:** downloaded voices live in the data root and are not core.
- **Pinned inputs:** source audio, Kyutai states and self-encoded states are
  pinned by revision and SHA-256. There are no moving branches or unverified
  bytes. Core acquisition adds `downloads.animama.ai` as an allowed host for
  release-hosted states only.
- **Publication gate:** acquisition and downloads depend on the published
  objects. Nothing that references them may merge before they are publicly
  served and verified. Objects under `models/` are immutable because of the
  bucket lock rule, so the publish must be right the first time.
- **Credentials:** the bucket-scoped R2 token is read from an owner-only file
  and never printed, logged or committed.
- **Offline:** core voices work offline once acquired; downloaded voices work
  offline once installed.

## Acceptance criteria

- [ ] **Inventory and licences.** A documented inventory covers every
      candidate with source, licence, revision, hash, gender, accent and
      screening result. No NC or unknown-licence voice ships. (R1, R2, R24)
      Evidence: the inventory file, a review of it, and the automated licence
      check.
- [ ] **Reproducible encoding.** The encoding script reproduces the published
      states from pinned inputs and reproduces Kyutai's VCTK states within
      tolerance. (R5, R6) Evidence: recorded hashes and `encode --check`.
- [ ] **Owner curation.** The owner selects the shipped set and recommended
      voices. (R3, R4) Evidence: a dated owner decision in the plan (G1,
      2026-09-26).
- [ ] **Selector.** The selector shows Female and Male groups with recommended
      voices first and accent tags. Each voice speaks when selected; a
      spot-check covers one voice of each source kind. (R19–R21) Evidence:
      browser verification at desktop size, then a narrow layout.
- [ ] **Stale voice fallback.** A saved unknown voice falls back to the
      default with one notice per session. (R22) Evidence: an automated test.
- [ ] **Notices.** Notices credit every shipped voice. (R23) Evidence: the
      notice files and the staged desktop notices.
- [ ] **Acquisition and packaging.** Acquisition, the runtime inventory,
      licence records and docs are updated, and the core size is recorded
      under the caps. (R6, R7, R25) Evidence: `browser_speech.py
      acquire`/`verify` against published objects, the runtime stage and
      audit, and docs review.
- [ ] **Downloads.** Selecting a downloadable voice installs it with a subtle
      progress icon and speaks with it without a reload, on desktop and
      self-host. A failed download leaves nothing installed and shows one
      notice per session. (R26–R30) Evidence: automated tests, and browser and
      desktop verification against the published objects.
- [ ] **Owner acceptance.** The owner accepts the shipped voices in the app.
      Evidence: owner manual check.

## Open questions and decisions

Agreed on 2026-09-26:

- **Audience:** end users and the owner equally.
- **Sources:** the licensed Kyutai voices and the remaining VCTK speakers.
  Donations (except `javert` and `marius`), CML-TTS and new Voice-Zero
  encodings are excluded.
- **Screening:** an automated pre-screen, then owner listening on a developer
  page.
- **Self-encoded states:** published as pinned hosted artifacts in
  `animama-releases`, not generated at acquire time.
- **Shipped set (G1):** 38 voices; `eve` is the default, and 14 are
  recommended.
- **Delivery (2026-09-27):**
  - `eve` and the recommended voices are core; the other 23 download on demand.
  - Downloads use the same backend downloader on desktop and self-host.
  - Picking a voice downloads it automatically, with a subtle progress icon.
  - The agent publishes with the owner's bucket-scoped token file.
- **Downloader:** delivered by #180 (it superseded #162).
- **Attribution:** in notices only.
- **Stale voices:** no migration for the removed January voices, and a stale
  saved voice shows one notice per session.

Open, non-blocking; the plan resolves them:

- Resolved: display names (owner-approved) and the R2 layout (#180's
  `models/` layout).

## Spec

[raymond-van/animama#142](https://github.com/raymond-van/animama/issues/142) (authoritative).

## ExecPlan

Required: the work spans curation, a hosted artifact pipeline, core
acquisition, on-demand downloads and the selector.
[pocket-tts-voice-catalog-execplan.md](pocket-tts-voice-catalog-execplan.md).

## Delivery links

Phase issues:
- #150 (P1)
- #152 (P3)
- #153 (P4)
- #154 (P5)
- #182 (P6)
- #183 (P7)

The former P2 is now #151 / PR #162.
