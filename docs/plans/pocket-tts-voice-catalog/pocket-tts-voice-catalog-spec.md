# Expanded PocketTTS core voices with a grouped selector

Snapshot of [raymond-van/animama#142](https://github.com/raymond-van/animama/issues/142),
captured 2026-09-26T19:09:25Z. The issue is authoritative; refresh this file from it
before resuming.

Status: Agreed (revised 2026-09-26 at gate G1)
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

The outcome is a curated set of 38 core voices and a selector that makes a
good choice easy.

## Goals, scope and non-goals

Included:

- **Candidate inventory and screening** of two sources:
  - the Kyutai `english_2026-04` precomputed states in
    `kyutai/pocket-tts-without-voice-cloning` (pinned revision
    `4e1e0a3e611c51c0b4ed8174fc10f32a54644303`);
  - the remaining VCTK speakers (CC BY 4.0), encoded by us.
- **Owner curation** on a developer listening page.
- **Reproducible self-encoded voice states** from pinned source audio, published
  as pinned hosted artifacts that core acquisition downloads.
- **A core set of 38 voices** (27 female, 11 male), of which 14 are
  recommended.
- **Grouped selector** with voice metadata.
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
- **Downloads:** an optional downloadable voice catalog, prerendered samples,
  per-voice download, auto-download and removal. These were withdrawn at G1.
- **The downloader itself:** it is tracked in #151.
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
  11 male) and 14 recommended; voices not selected are dropped.
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
- **R6.** Self-encoded states are published as pinned, hash-recorded hosted
  artifacts in the `animama-releases` R2 bucket. Acquisition downloads and
  verifies them; it never runs the encoder.

### Core set

- **R7.** All 38 voices ship in the core distribution and are acquired and
  verified like today's built-in voices, with their hashes and licences in the
  browser speech manifest. Kyutai states keep their Hugging Face pins, and
  self-encoded states come from the release host.
- **R8–R18. Withdrawn at G1 (2026-09-26).**
  - The shared downloader requirements, R8–R12, moved to #151.
  - The optional catalog, samples, downloads, auto-download and removal,
    R13–R18, are no longer needed.

### Selector

- **R19.** The Pocket voice selector in Anima settings groups voices into
  Female and Male. Recommended voices come first in each group.
- **R20.** Each voice shows its display name and an accent tag where known.
- **R21.** Every listed voice is installed and selectable, so no download
  state is shown.
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

## Constraints

- **Licensing:** only voices whose licence permits commercial use ship: CC BY
  4.0 for VCTK and Alba MacKenna, and CC0 for Voice-Zero, Kyutai's own
  recording and the two donation voices. CC BY sources need attribution.
  Kyutai's model-card prohibited-use terms still apply.
- **Size:** voice states are about 6–8 MB each, so 38 voices are about 265 MB
  installed, 237 MB more than today's four. The desktop hard caps are 750 MiB
  compressed core and 1.5 GiB installed core. The last stage measured 430 MB
  download and 1.03 GB installed. The core must stay under the caps without a
  size exception; compression of the states is not yet measured.
- **Pinned inputs:** source audio, Kyutai states and self-encoded states are
  pinned by revision and SHA-256. There are no moving branches or unverified
  bytes. Core acquisition adds `downloads.animama.ai` as an allowed host for
  release-hosted states only.
- **Publication gate:** acquisition of the self-encoded states depends on the
  owner publishing them to `animama-releases`. Nothing that makes acquisition
  depend on them may merge before they are publicly served and their hashes
  verified.
- **Offline:** every shipped voice works offline once acquired.

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
- **Shipped set (G1):** 38 voices, all core, with no optional catalog. `eve`
  stays the default, and 14 voices are recommended.
- **Downloader:** split to #151 and draft PR #162.
- **Attribution:** in notices only.
- **Stale voices:** no migration for the removed January voices, and a stale
  saved voice shows one notice per session.

Open, non-blocking; the plan resolves them:

- Display names for self-encoded VCTK voices, which have no Kyutai name.
- The R2 URL layout for voice states.

## Spec

[raymond-van/animama#142](https://github.com/raymond-van/animama/issues/142) (authoritative).

## ExecPlan

Required: the work spans curation, a hosted artifact pipeline, core
acquisition and the selector.
[pocket-tts-voice-catalog-execplan.md](pocket-tts-voice-catalog-execplan.md).

## Delivery links

Phase issues:
- #150 (P1)
- #152 (P3)
- #153 (P4)
- #154 (P5)

The former P2 is now #151 / PR #162.
