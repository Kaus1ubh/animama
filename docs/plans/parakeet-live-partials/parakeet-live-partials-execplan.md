# Live Parakeet partial transcripts

Source agreement: the owner's task instructions on 2026-09-25.

- Keep Parakeet TDT 0.6B v2.
- Add live partial transcripts by re-decoding a growing audio buffer.
- Run a WebGPU encoder spike.
- Test in a local Compose development stack from this worktree.
- Planning for the desktop feature-pack release is explicitly out of scope.

There is no separate spec: this plan and its phase issues carry the acceptance
criteria.

Authorized scope:

- Phases 1 and 2: authorized and delivered.
- G1 (2026-09-25): the owner chose WebGPU behind an "Experimental" settings
  toggle.
- Phase 2 amendment and Phase 3 (experimental WebGPU toggle): authorized on
  2026-09-25.

## Purpose and context

Desktop dictation and Voice Mode use only local Parakeet, because Electron's Web
Speech API fails with `network` errors. On web, Parakeet is the fallback when
browser recognition is unavailable.

Today the user sees no text until MicVAD closes a speech window and the worker
decodes that window once.

When this plan is done:

- On the WebGPU backend (an experimental setting, off by default), Parakeet
  shows interim text in the chat input about once a second while the user
  speaks, in both dictation and Voice Mode. The default WASM backend stays
  final-only.
  - It uses the same interim preview surface the browser provider already uses.
  - The final text, Smart Turn end-of-turn detection and Voice Mode auto-submit
    are unchanged.
- There is measured evidence comparing the current single-thread WASM int8
  encoder with a WebGPU encoder, and the owner has decided whether to adopt
  WebGPU.

Browser speech recognition behavior does not change.

### Current code (starting revision `c612e9d`, `origin/main`)

- **Worker:** `src/frontend/web/src/workers/client-parakeet-worker.ts`
  - Loads `parakeet.js` 1.4.4 with
    `fromUrls({ backend: "wasm", cpuThreads: 1, preprocessorBackend: "js", nMels: 128 })`.
  - Processes requests one at a time on a single promise queue.
  - Runs `transcribe()` once per accepted window and always returns
    `isFinal: true`.
- **Protocol:** `src/frontend/web/src/lib/speech/client-parakeet/worker-protocol.ts`
  - `ClientParakeetBackend = "wasm"`.
  - `ClientParakeetTranscribeResult.isFinal: true`.
- **Client:** `src/frontend/web/src/lib/speech/client-parakeet/client.ts`
  - A singleton worker, a pending-request map, and idle disposal after 300 s.
- **Dictation:** `src/frontend/web/src/hooks/use-dictation.ts`
  - `transcribeParakeetSpeechWindow` (around line 1412) handles stale-result
    checks, the Voice Mode commit, the Smart Turn check and `onSegment`.
  - `commitParakeetVoiceTranscript` (around line 1376) writes final text into the
    shared `browserSpeechTextBuffersRef` and calls `publishTranscriptPreview`
    with an empty `interimText`.
  - `MICVAD_PRESPEECH_PAD_MS = 200`.
- **MicVAD wrapper:** `src/frontend/web/src/hooks/voice/mic-vad-runtime.ts`
  - Its `onFrameProcessed` type drops the `frame: Float32Array` argument that
    `@ricky0123/vad-web` 0.0.30 provides (`real-time-vad.d.ts:7`).
  - `onSpeechStart`, `onSpeechRealStart`, `onVADMisfire` and `onSpeechEnd`
    already exist.
- **Development smoke loader:**
  `src/frontend/web/src/lib/speech/client-parakeet/smoke-loader.ts`.
- **Current guidance:** `docs/frontend/runtime/voice.md` says Parakeet has no
  interim preview and writes final text only.

### Boundaries

- **Model:** keep `parakeet-tdt-0.6b-v2` and the pinned
  `models/parakeet-tdt-0.6b-v2/manifest.json`. No v3, Nemotron or Moonshine.
- **Final authority:** final transcripts still come from the existing single
  full-window `transcribe()` call. Previews never feed Smart Turn, Voice Mode
  auto-submit, `onSegment(isFinal: true)` or chat submission.
- **No server-side change:** no backend API, persistence or schema change, and
  no generated-client change.
- **Out of scope:** feature-pack production, release inputs, size budgets and
  publication. If Phase 3 would change the model files, record the effect on the
  pack as a follow-up for separate planning rather than acting on it here.

### Test environment

Use a named task stack from this worktree. Keep the main stack
(`animama-server` on its usual local port) running and unchanged.

```bash
./reset.sh --name stt --base-port 8200
source .animama-stack.env
```

Confirm the chosen name and port are free at workspace setup, and record the
resolved application URL here.

- **Browser testing:** desktop Chrome at the stack URL, with Parakeet selected as
  the speech-to-text provider in Settings.
- **Desktop renderer path:** from `src/frontend`, run
  `source ../../.animama-stack.env && pnpm desktop:dev`. This opens Electron on
  the same stack.

The Parakeet model comes from the shared developer model store. Check it with
`python3 scripts/models/parakeet.py verify`.

## Progress

- [x] Workspace setup (2026-09-25):
  - Branch `feat/parakeet-live-partials` from `c612e9d`.
  - Issues: parent #98, phase 1 #99, phase 2 #100.
  - Stack `animama-stt` at `http://animama-stt.localhost:8200`, development
    mode, created with `--base-port 8200`.
- [x] Phase 1: WebGPU encoder spike and baseline measurements.
  - Commit `f5591c1` (`test(voice)[p1]`).
  - Review passed after one repair round.
  - Results and the recommendation are under Phase 1.
- [x] Gate G1 (2026-09-25): the owner chose a modified (a).
  - Adopt WebGPU, but behind an enable/disable toggle in a new "Experimental"
    section of the app settings, in case some users lack support.
  - Phase 3 was revised and authorized on 2026-09-25.
- [x] Phase 2: live Parakeet partial transcripts.
  - Review passed after two repair rounds and one extra recheck authorized by
    the owner.
  - Commit `68cdf0e` (`feat(voice)[p2]`).
- [x] Final integration review for Phases 1–2 passed (one repair round). PR
      #111 is open from this branch.
- [x] Phase 2 amendment: previews only on the WebGPU backend. Commit
      `e091c69`.
- [x] Phase 3: experimental WebGPU toggle (issue #113). Review passed after
      one repair round. Commit `5a84307` (`feat(voice)[p3]`).
- [x] Final integration review of the full scope after Phase 3: passed after
      two repair rounds (Code Review #5).
- [ ] Owner manual acceptance on the task stack.

## Surprises & Discoveries

- **2026-09-25: the int8 encoder cannot run on WebGPU.**
  - `parakeet.js` upgrades int8 encoder requests to fp32 in WebGPU modes
    (upstream README, "Quantization options").
  - Pinned v2 encoder sizes:
    - int8: 652 MB (the file used today)
    - fp16: 1,239 MB (`ysdede/parakeet-tdt-0.6b-v2-onnx`)
    - fp32: 41.8 MB plus 2,435 MB of external data
  - Adopting WebGPU therefore adds model files, which is why Gate G1 exists.
- **2026-09-25: multithreaded WASM would need cross-origin isolation
  (COOP/COEP).** No Animama surface sets these headers today;
  `window.crossOriginIsolated` is only read in PocketTTS and debug views. Record
  it as an alternative in Phase 1 only; do not enable it in this plan.
- **2026-09-25: `parakeet.js` 1.4.4 exports a streaming transcriber and an
  incremental mel cache.**
  - `StatefulStreamingTranscriber` carries decoder state across non-overlapping
    chunks.
  - Parakeet TDT was trained on whole utterances, so hard chunking costs
    accuracy.
  - Previews therefore re-decode the growing buffer, and the final pass keeps the
    full window.

- **2026-09-25: the packaged Animama.app holds the desktop single-instance
  lock.** Running `desktop:dev` while it is open exits immediately.
  - Dev launches need `ANIMAMA_DESKTOP_DEV_USER_DATA=<disposable dir>`.
  - `--user-data-dir` is ignored because `prepareDesktopIdentity` sets
    `userData` itself.
- **2026-09-25: single-thread WASM decodes at only 2–3× real time.** Finals for
  long utterances already take seconds. See the Phase 1 results.

## Decision Log

- **2026-09-25, owner, G1:** put WebGPU under an "Experimental" app-settings
  toggle that users can enable or disable. It is not an automatic default, in
  case some users don't have WebGPU support.
- **2026-09-25, owner, scope:**
  - Disable previews on the CPU backend rather than keep the 2 s preview.
  - Add Phase 3 as the Experimental WebGPU toggle.
  - Desktop WASM threads were discussed and deferred. They are acceptable
    later only if configured automatically; no Phase 4 in this plan.
- **2026-09-25, owner, review limit:** authorized one extra targeted recheck
  of P2-R3-1 after the bounded budget was spent. The recheck passed.

- **2026-09-25, owner:**
  - Keep Parakeet v2 and add growing-buffer partials plus a WebGPU spike.
  - Test in a worktree Compose development stack.
  - Leave feature-pack release planning out of this plan.
- **2026-09-25, agent proposals (accepted with this plan unless the owner changes
  them):**
  - Partials get no preview-specific user setting. After the Phase 2 amendment
    they follow the Experimental WebGPU setting.
  - Preview cadence adapts to measured decode time, and previews stop
    automatically when decoding cannot keep up.
  - One branch and one PR: `feat/parakeet-live-partials`.
  - The Phase 1 benchmark tooling stays in the repository only as a
    development/debug facility.
- **2026-09-25, agent (within the plan's tuning authority), Phase 2 preview
  controller:**
  - The Phase 1 data replaced the draft "1.5 s ceiling disables previews for
    the session" rule. The controller now stops previews per window once the
    predicted decode exceeds 800 ms, and each new window starts previewing
    again.
  - The first preview and the minimum interval are both 600 ms.
  - The 20 s cap on preview audio is kept.
  - Decoder-state reuse is left for Phase 3, because its gain matters only on
    WebGPU.

## Phased implementation

Work from the task worktree root unless a step says otherwise, and run frontend
commands from `src/frontend`.

- Rename the generated branch `claude/speech-to-text-tts-setup-77190c` to
  `feat/parakeet-live-partials` before the first push.
- Create one issue per authorized phase during workspace setup.

### Phase 1: WebGPU encoder spike and baseline measurements

Issue: #99. Depends on: the task stack.

Outcome: reproducible numbers for deciding whether WebGPU is worth larger model
files, plus the re-decode cost budget for Phase 2. No user-facing behavior
changes.

1. **Benchmark tool.** Extend `smoke-loader.ts`, or add a dev-only benchmark
   entry beside it. It loads the model with a selectable backend and encoder
   quantization, and times `transcribe()` on fixed clips.
   - Configurations: `wasm` int8 on 1 thread (the baseline), `webgpu` with an
     fp16 encoder and int8 decoder, and `webgpu` fp32 if memory allows.
   - Keep it out of production bundles, or behind the existing debug surface.
2. **Spike-only encoder files.** Fetch them locally from the pinned revision
   `ysdede/parakeet-tdt-0.6b-v2-onnx@db4a768f…` into a developer cache outside
   the verified model store. Do not add them to the manifest.
3. **Clips.** Use 3–5 short utterances of 2–15 s, such as owner recordings or
   PocketTTS output produced locally. Keep audio out of Git and record only
   durations and summaries of how closely the text matches.
4. **Measurements.** Run in Chrome and in `desktop:dev` against the task stack.
   Record:
   - model load time
   - first-decode and warm-decode time per clip
   - real-time factor
   - renderer memory
   - whether `navigator.gpu` is available
   - encoder operations falling back to CPU (profile with `enableProfiling` and
     `endProfiling()`)
   - whether the final text matches the WASM baseline

   Also measure the WASM int8 re-decode cost for growing buffers of 1, 3, 6 and
   12 s. This sets the Phase 2 budget.

5. **Results.** Add a results table to this plan, including hardware and OS, and
   a recommendation.

Checks: `pnpm check` and `pnpm web:lint`. The benchmark is a measurement tool, so
it has no unit tests.

Completion: the results table and recommendation are recorded, and Code Review #1
passes.

**Gate G1 (owner decision):**

- (a) Adopt WebGPU with the fp16 encoder and accept the larger model files. This
  leads to Phase 3.
- (b) Keep WASM int8. Skip Phase 3; keep the dev benchmark and the findings.
- (c) Defer the decision.

Phase 2 does not wait for G1.

#### Phase 1 results (2026-09-25)

Issue #99, branch `feat/parakeet-live-partials` from `c612e9d`. Numbers come
from the second measurement run (after Code Review #1). The benchmark source
was identical to the Phase 1 commit, which is recorded in Progress.

**Environment**

- Hardware: Apple M5, 10 cores, 24 GiB, macOS 26.6.
- Runtimes:
  - Chrome 153, a separate test profile driven through the DevTools protocol.
  - Electron 39.8.9 (Chromium 142), run as the `desktop:dev` main process with
    a disposable `ANIMAMA_DESKTOP_DEV_USER_DATA` profile and the benchmark
    window brought to the front.
- WebGPU adapter `apple / metal-3` in both runtimes.
- Neither page is cross-origin isolated, so WASM uses one thread whatever
  `threads` requests.

**Reproduce**

Start the task stack (see [Test environment](#test-environment)).

Get the spike encoder, pinned revision
`ysdede/parakeet-tdt-0.6b-v2-onnx@db4a768f5795e0f508187a34241fbeeef6ebb0d3`.
The file is 1,238,960,452 bytes with SHA-256
`ad8bb0acaec339c32ffbdedb869bd60f7103d0f6c00e56c7a2c2ab57df7462a2`, which
matches the Hugging Face LFS object ID. Download it into a developer cache
outside the verified model store:

```bash
curl -L -o "$SPIKE_DIR/encoder-model.fp16.onnx" \
  "https://huggingface.co/ysdede/parakeet-tdt-0.6b-v2-onnx/resolve/db4a768f5795e0f508187a34241fbeeef6ebb0d3/encoder-model.fp16.onnx"
```

Create the clips with the macOS `say -v Samantha` voice. Convert each with
`afconvert -f WAVE -d LEI16@16000 -c 1` to 16 kHz mono 16-bit, and list
`{ id, text, url }` in `clips.json`. Keep audio out of Git.

| Id  | Seconds | Text                                                                                                                                                                                                                                                                                                               |
| --- | ------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| c1  |     3.1 | Hey, can you remind me what we talked about yesterday?                                                                                                                                                                                                                                                             |
| c2  |     4.6 | I think the avatar should wave when I say hello, and maybe smile a little bit more.                                                                                                                                                                                                                                |
| c3  |     9.0 | Let's plan a quick trip to the mountains next weekend. I want to leave early on Saturday morning, stop for coffee somewhere scenic, and be back by Sunday night.                                                                                                                                                   |
| c4  |    15.9 | Okay so here's the thing. I've been working on this project for about three months now and I keep getting stuck on the same problem. Every time I think I've solved it, something else breaks, and honestly I'm starting to wonder whether I should just rewrite the whole thing from scratch or keep patching it. |
| c5  |     1.1 | What's the weather like?                                                                                                                                                                                                                                                                                           |

Link or copy `$SPIKE_DIR/encoder-model.fp16.onnx` to
`spike/encoder-model.fp16.onnx` inside the clips directory, then serve that
directory from
a loopback server. It must send `Access-Control-Allow-Origin: *` and
`Cache-Control: no-store`, so every load below is uncached. We used a
ten-line Python `SimpleHTTPRequestHandler` subclass on `127.0.0.1:8290`.

Open:

```text
http://animama-stt.localhost:8200/parakeet-bench.html?backend=wasm&encoder=int8&clips=http://127.0.0.1:8290
http://animama-stt.localhost:8200/parakeet-bench.html?backend=webgpu&encoder=fp16&spike=http://127.0.0.1:8290/spike&clips=http://127.0.0.1:8290
```

For Electron, set the same URL as `ANIMAMA_DESKTOP_WEB_URL`. Results render as
JSON and are available as `window.__parakeetBenchResult`.

**Clips:** warm decode in milliseconds, median of 3, with each clip's first
decode in brackets. `×` is audio duration divided by warm decode time.

| Clip (s) |   Chrome WASM int8 | Chrome WebGPU fp16 | Electron WASM int8 | Electron WebGPU fp16 |
| -------: | -----------------: | -----------------: | -----------------: | -------------------: |
|      1.1 |     452 (478) 2.4× |        82 (86) 13× |     416 (415) 2.6× |       185 (193) 5.9× |
|      3.1 | 2,897 (1,235) 1.1× |    129 (1,022) 24× | 2,619 (3,838) 1.2× |        201 (254) 16× |
|      4.6 | 1,536 (1,830) 3.0× |      118 (194) 39× | 3,460 (5,091) 1.3× |        223 (244) 21× |
|      9.0 | 2,984 (2,948) 3.0× |      186 (275) 48× | 2,879 (2,906) 3.1× |      438 (1,116) 20× |
|     15.9 | 5,229 (5,248) 3.0× |      300 (302) 53× | 5,063 (5,101) 3.1× |        682 (443) 23× |

Clips run in the order c1–c5, so c1's first decode is the cold first inference
after load.

**Growing buffer:** the first N seconds of c4. Each cell is the full re-decode
in milliseconds (median of 3), with the encoder / decoder-loop split in
brackets. Incremental is a second decode of the same buffer after priming
`parakeet.js`' decoder-state and mel caches at the previous length.

| Buffer | Chrome WASM        | Chrome WebGPU  | Electron WASM      | Electron WebGPU | Electron WebGPU incremental |
| -----: | ------------------ | -------------- | ------------------ | --------------- | --------------------------: |
|    1 s | 430 (417 / 11)     | 81 (69 / 11)   | 392 (382 / 9)      | 194 (154 / 39)  |                           — |
|    3 s | 1,126 (1,102 / 23) | 100 (75 / 24)  | 1,022 (996 / 23)   | 245 (151 / 89)  |            356 (254 / 90)\* |
|    6 s | 2,079 (2,032 / 43) | 139 (92 / 45)  | 1,930 (1,881 / 40) | 346 (172 / 158) |              258 (166 / 83) |
|   12 s | 3,945 (3,849 / 78) | 232 (136 / 90) | 3,820 (3,734 / 76) | 515 (198 / 289) |             393 (197 / 178) |

\* A single run. The encoder time is noisy.

With incremental caching, Chrome WASM at 12 s took 3,817 ms (encoder 3,771,
decoder 42) and Chrome WebGPU took 189 ms (encoder 138, decoder 48).

**Findings**

- **Speedup (warm WASM ÷ WebGPU):**
  - Chrome: 5–17× on the growing buffer and 5.5–17× on clips, ignoring the
    3.1 s WASM outlier.
  - Electron: 2–7× on the growing buffer and 2–7× on clips, ignoring the
    3.1 s and 4.6 s WASM outliers.
  - Electron, the only speech path on desktop, gains less.
- **Where time goes:**
  - On WASM the encoder is about 97% of decode time.
  - On WebGPU the encoder drops to 70–240 ms, and the WASM decoder loop becomes
    a large share. In Electron that is 289 of 515 ms at 12 s, against 90 ms in
    Chrome, for reasons not yet investigated.
  - Reusing decoder state with a primed cache saves about 40% of decoder time
    on Electron WebGPU (12 s: 289 → 178 ms). It saves nothing that matters on
    WASM.
- **Accuracy:** all four configurations produced identical text on every clip,
  with a word error rate of 0. The clips are clean synthetic speech, so this
  shows parity, not accuracy on real microphones.
- **Load (uncached):**
  - Chrome: 3.6 s (WASM) and 3.9 s (WebGPU).
  - Electron: 4.7 s (WASM) and 8.5 s (WebGPU).
  - The product worker is disposed after 5 minutes idle, so the next utterance
    pays load time plus a cold first decode.
- **Variance:** WASM warm decodes of the 3.1 s and 4.6 s clips were sometimes
  about 3× slower than the growing-buffer trend. This happened in both
  runtimes, so it is not caused by the window being in the background. The
  cause is unknown; possibly shape-dependent ORT memory planning.
- **Not measured:**
  - Renderer, WASM and GPU memory: page APIs cannot see them.
  - Which operations ORT assigns to CPU vs GPU: `endProfiling()` needs
    `env.wasm.FS`, which ORT 1.24 does not expose, so the profiling option was
    removed.
  - fp32 WebGPU, which needs 2.4 GB of weights; fp16 already answers G1.

**Budget for Phase 2:** single-thread WASM spends about 320 ms decoding per
second of buffered audio.

- With `maxPreviewDecodeMs = 800`, previews on WASM cover roughly the first 2 s
  of each window. That keeps the latency a final can inherit from an in-flight
  preview under about 800 ms.
- On WebGPU:
  - Chrome stays within budget up to the 20 s preview cap.
  - Electron stays within budget to roughly 15–18 s.
  - Longer windows stop previewing.

**Checks** (2026-09-25, all from `src/frontend`): `pnpm check`,
`pnpm web:lint` and `pnpm build` passed. The production `dist` contains no
`parakeet-bench` page and no benchmark strings.

**Recommendation for G1: (a) adopt WebGPU with the fp16 encoder, falling back
to WASM int8.**

- On desktop it cuts final-transcript latency 2–7×, rising with utterance
  length.
- It keeps previews useful for whole utterances.
- Cost: a 1.24 GB model file on top of the int8 encoder, or replacing int8 if
  the fallback is dropped. The feature-pack impact needs separate planning.
- If adopted, Phase 3 should also:
  - check the slow Electron decoder loop;
  - consider decoder-state reuse for previews, since the decoder is a large
    share on WebGPU;
  - measure memory.

#### Code Review #1 Findings

Reviewer: independent `sdlc-reviewer` subagent. Source: baseline `0b83b16` plus
the uncommitted Phase 1 files. Checks: a separate subagent ran `pnpm check`,
`pnpm web:lint` and `pnpm build`; the reviewer ran read-only `eslint`, `tsc`
and `prettier --check`. Round: initial.

- **P1-R1-1 (required):** the incremental variant never hit the `parakeet.js`
  decoder-state cache. That cache is keyed by the exact prefix length, and the
  benchmark changed the prefix on every step. As a result, the plan's claim
  that incremental caching "saved nothing" was unsupported, and stage timings
  were not recorded.
- **P1-R1-2 (required):** the stated 8–20× WebGPU speedup did not match the
  tables, particularly for Electron.
- **P1-R1-3 (required):** "On WebGPU the whole 20 s cap stays within budget" is
  false for Electron: 871 ms at 15.9 s, against the 800 ms budget.
- **P1-R1-4 (required):** first-decode times were measured but not recorded.
- **P1-R1-5 (required):** the results were not reproducible from the plan.
  Missing: URLs, serving, clip recipe, full revision and hash, source revision,
  and check results.
- **P1-R1-6 (required):** the Phase 1 review placeholders had been removed.
- **Optional:**
  - the `profile` option never works;
  - the worker has no `error` listener;
  - query values are not validated;
  - `clips.json` fetch results are not checked;
  - "RTF" is ambiguous;
  - load-time cache state is not stated;
  - the synthetic-clip accuracy caveat is missing;
  - the budget paragraph and the Phase 2 steps differ.
- **Verified without findings:**
  - the benchmark is excluded from production;
  - the ORT `wasmPaths` selection;
  - the median, word error rate, WAV and cap logic;
  - the Electron table values against the raw JSON.

#### Code Review #1 Revisions

- **P1-R1-1: accepted and fixed.** The benchmark now records the encoder and
  decoder-loop split for every run. The incremental variant primes the cache at
  the previous length before timing a guaranteed hit. The measurements were
  redone, and the finding is restated above.
- **P1-R1-2: accepted.** The speedup is now stated per runtime (Chrome 5–17×,
  Electron 2–7×), and the outliers are discussed.
- **P1-R1-3: accepted.** The budget statement is now qualified per runtime.
- **P1-R1-4: accepted.** First-decode times are shown in brackets.
- **P1-R1-5: accepted.** Added commands, URLs, the clip table, full hashes, a
  note on the source revision, and check results.
- **P1-R1-6: accepted.** The review sections are restored here.
- **Optional items:**
  - accepted: removed the `profile` option; added the worker `error` handler;
    added validation of `backend`, `encoder`, `threads` and `runs`; added the
    `clips.json` `ok` check; defined `×`; stated the uncached loads; added the
    accuracy caveat;
  - addressed in the Phase 2 Decision Log: the budget vs Phase 2 steps
    difference;
  - rejected: restricting to loopback origins, because the page is dev-only and
    not built.
- **Verification:**
  - `tsc -b` and `eslint src/dev/parakeet-bench` pass;
  - all four configurations were re-run and cross-checked against the JSON.
- **Next:** targeted recheck #2.

#### Code Review #2 Findings (repair round 1)

The same reviewer ran a targeted recheck. P1-R1-1 to P1-R1-6 and the accepted
optional items are resolved, and no code regressions were found.

- **P1-R2-1 (required, trivial):** the results cite "the Phase 1 commit", but
  no commit had been recorded yet.
- **Optional:**
  - the 9.0 s Electron WebGPU speedup should read 20×, not 21×;
  - the recommendation's "more for longer ones" overstates;
  - Electron's clip range should exclude the WASM outliers, as Chrome's does;
  - the encoder range should read 70–240 ms;
  - the bracket caption should cover each clip's first decode;
  - the step that places the spike file in the served directory is only
    implied;
  - the review record's checks description is incomplete.

#### Code Review #2 Revisions

- **P1-R2-1: accepted.** The results now point to Progress, where the Phase 1
  commit SHA is recorded once it exists. Phase 1 is not marked complete until
  then.
- **All optional items: accepted and fixed** in the text above.
- **Budget:** one repair round remains. No blocking findings remain, so Phase 1
  passes review.

### Phase 2: live Parakeet partial transcripts

Issue: #100. Depends on: the Phase 1 re-decode cost estimate, not on G1.

Outcome: interim Parakeet text appears during speech and is replaced by the final
text. Final text, Smart Turn, auto-submit and stale-result handling keep their
current behavior.

1. **Capture.**
   - Pass the `frame` argument through the `onFrameProcessed` type in
     `mic-vad-runtime.ts`.
   - Add a small, testable accumulator module, for example
     `src/frontend/web/src/lib/speech/client-parakeet/preview-buffer.ts`. It:
     - keeps a pre-speech ring buffer the length of `MICVAD_PRESPEECH_PAD_MS`
     - starts a growing buffer on `onSpeechStart` and appends each frame
     - clears on `onVADMisfire`, on `onSpeechEnd`, and when the session or turn
       changes
2. **Scheduling.** Add a pure preview scheduler, unit-tested with fake time.
   - The first preview is sent once the buffer holds at least ~700 ms of speech.
   - The next interval is `max(700 ms, 1.5 × last preview decode time)`.
   - At most one preview is in flight.
   - No previews are sent for a window after its `onSpeechEnd`.
   - If one preview decode takes longer than a ceiling (initially 1.5 s),
     previews stop for the rest of the session.
   - Preview input is capped to the most recent N seconds (initially 20 s).
   - Tune these values from Phase 1 data. Try the `parakeet.js`
     `incremental: { prefixSeconds }` and mel-cache options only if Phase 1 shows
     a gain.
3. **Protocol and worker.**
   - Add a `kind: "preview" | "final"` field to transcribe requests; results set
     `isFinal` to match.
   - The worker stays serial.
   - The client never queues more than one preview, and drops a preview result
     once the final for the same `windowId` has been requested or resolved.
   - Previews call `transcribe()` with the same options as final requests.
     Confirm that a preview does not change any decoder state a later final
     depends on. If the mel cache is used, reset it at window boundaries.
4. **Presentation.**
   - Previews update only `interimText` in `browserSpeechTextBuffersRef`, through
     `publishTranscriptPreview({ provider: "parakeet", ... })`, in both modes.
   - Confirm that `commitParakeetVoiceTranscript` and the dictation final path
     clear or replace the interim text.
   - Dictation mode must never emit a preview through `onSegment` with
     `isFinal: true`. Use the same interim channel the browser provider uses.
   - Voice Mode previews must not call `submitPendingVoiceEndTurn`, append Smart
     Turn audio, or reset silence timers.
   - Apply the existing stale checks to previews: session, provider, mode, run,
     turn and dictating state.
5. **Diagnostics.** Log preview decode time and skip reasons through the existing
   logger and voice debug sink. Do not log transcript text beyond the current
   length-only pattern.
6. **Documentation.** Update `docs/frontend/runtime/voice.md`:
   - Update the provider table row and the "Final-window Parakeet path" section.
   - Remove the statement that Parakeet writes final text only.
   - Describe preview cadence, when previews are skipped, and that the final
     transcript remains authoritative.

**Tests** (behavior-focused, run with `pnpm web:test`):

- preview buffer: start, append, pre-speech pad, and clearing on misfire and on
  speech end
- scheduler: first-preview threshold, adaptive interval, single in-flight
  preview, stop at speech end, stop after a slow decode, and the buffer cap
- client: a preview result that arrives after its window's final is discarded
- a Voice Mode test that previews never trigger submission, if existing test
  patterns can exercise `use-dictation`; otherwise record it as covered by the
  manual checks

**Manual checks** on the task stack, in both Chrome and `desktop:dev`, with
Parakeet selected:

- Interim text appears while speaking, and the final text replaces it.
- Voice Mode auto-submits only after the final text and Smart Turn.
- VAD misfires leave no stray interim text.
- Stop, restart, and push-to-talk (desktop) leave no stale previews.
- Avatar animation stays smooth while speaking (watch the debug panel's frame
  rate).
- Measure final-text latency after speech ends, before and after the change, on
  the same clips. The target is a median increase of no more than one preview
  decode time. Record the actual numbers.

Checks: `pnpm check`, `pnpm web:lint`, `pnpm web:test`, `pnpm build` and
`pnpm desktop:check`.

Completion: tests and checks pass, manual results are recorded, docs are updated,
and review passes.

#### Phase 2 results (2026-09-25)

Issue #100. The work started from `f5591c1`; the phase commit is `68cdf0e`.

**What was built**

- `lib/speech/client-parakeet/preview-controller.ts`: the frame-driven preview
  controller, with 20 behaviour tests.
- `mic-vad-runtime.ts` now forwards MicVAD frames through `onVadFrame`, with 2
  tests.
- The worker protocol gained `kind: "preview" | "final"`.
- `use-dictation.ts` wiring:
  - a preview session per Parakeet start;
  - window start, end and invalidation handling;
  - clearing of display-only previews on final, error, mute, stop and restart.
- `docs/frontend/runtime/voice.md` was updated.

**How the manual evidence was gathered**

- Agent-run on the task stack with synthetic speech.
- Chrome 153 and Electron 39 `desktop:dev` were started with
  `--use-fake-device-for-media-stream`,
  `--use-file-for-fake-audio-capture=<wav>` and
  `--disable-features=AudioServiceOutOfProcess,AudioServiceSandbox`. Without the
  last flag, macOS delivers silence.
- Inputs: 2 s of silence, then the Phase 1 clips.
- The STT provider was set to Parakeet through the stack's settings API, from
  inside the page.
- Chat submission (`chat:sse`) was intercepted in the page and answered with
  503, so no provider call was made.
- Backend: WASM int8, one thread.

**Results**

- **Dictation, Chrome and Electron, 15.9 s clip:**
  - previews appeared about 1.0 s after speech start ("Okay, so here's") and
    about 1.8 s after ("Okay so here's the thing.");
  - the per-window budget then stopped previews at about 2.3 s of window audio;
  - the final replaced the preview 5.8–5.9 s after speech end.
- **Voice Mode, Chrome:**
  - the previews were the same;
  - auto-submit fired only after the final and Smart Turn;
  - the intercepted `body.message` equalled the full final transcript.
- **Multiple windows, Chrome dictation (clips c1, c5, c2 in sequence):**
  - each window previewed, then committed;
  - a later window's preview was appended after the earlier final text.
- **Final latency on short utterances (1.1–4.6 s clips, 6 windows):**
  - the final request was dispatched in the same millisecond as speech end
    every time, and was ready 0.9–2.0 s later;
  - no preview was in flight, because the budget cutoff (about 2.2 s) always
    came before VAD's 1.4 s redemption period ended;
  - so previews added no final latency in these runs. No separate A/B against
    the old build was run.
- **Voice Mode mute (after Code Review #1 fixes):** the preview cleared within
  about 0.1 s of muting, and nothing late arrived.
- **Stop and restart (dictation):** the preview cleared on stop, nothing stale
  appeared in the next 4 s, and restart began clean.

**Not performed**

- real-microphone checks, which are part of owner acceptance;
- push-to-talk (a desktop global shortcut);
- a deliberate VAD misfire;
- Electron Voice Mode;
- avatar frame-rate measurement;
- a WebGPU backend, which is Phase 3;
- a before/after final-latency A/B against the old build. The latency evidence
  instead shows no preview in flight at any speech end;
- an automated Voice Mode `use-dictation` test. No hook test pattern exists for
  it, so the manual Voice Mode check covers it.

The manual runs above used the tree before the P2-R2-1 and P2-R3-1 fixes.
Those fixes only change held-back first previews (Voice Mode during an
assistant run), which the runs did not exercise, so they were not repeated.

**Disclosed limitation (R1 on WASM):** previews cover roughly the first 2 s of
each window. Longer utterances show the frozen preview until the final lands:
about 14 s without updates for the 15.9 s clip, followed by about 6 s of final
decode. Meeting "updates about once a second" throughout needs a faster
backend (G1).

**Deviation:** diagnostics use the logger only (`debug` for results, `info`
for budget stops and failures). They do not use the voice debug sink.

**Checks:** see [Final integration review](#final-integration-review) for the
full suite on the Phase 2 commit.

#### Code Review #1 Findings

Reviewer: independent `sdlc-reviewer` subagent. Source: `0b83b16` plus the
uncommitted Phase 2 files. Round: initial.

- **P2-R1-1 (required):**
  - `decodeRate` was shared across the whole session, and every dispatch was
    checked against it.
  - After one slow preview (for example a cold first decode running slower than
    real time), each later window's first preview was also predicted over
    budget, so previews never ran again for the session.
  - The reviewer reproduced this with the controller bundled under Node.
- **P2-R1-2 (required):**
  - Muting Voice Mode without a flush pauses MicVAD without firing any window
    callback.
  - The Parakeet preview therefore stayed in the input, and an in-flight
    preview could still be published. A manual send while muted would include
    that text.
  - The resume path could also drop the preview reference without clearing the
    display.
- **P2-R1-3 (required):** the plan's recovery step ("a slow-decode ceiling of 0
  disables previews") did not work, because a session's first preview ignored
  the budget. The "internal constant or debug override" decision was also not
  recorded.
- **Optional:**
  - disclose the R1 limitation on WASM;
  - gate dispatch rather than results during assistant runs and after turn
    changes;
  - previews continue through the VAD redemption period;
  - `speechSamples` counts window audio, not speech;
  - trim `window.frames` to the cap;
  - add tests: interval multiplier branch, recovery, `endWindow(null)`;
  - the diagnostics deviation;
  - `parakeet.js` prints profiling `console.log` output on every preview;
  - clarify manual send;
  - `voice.md` table alignment;
  - `reset()` lets a second decode queue behind an old one;
  - list the manual checks that were not performed.
- **Verified without findings:**
  - previews are display-only, with no path into gate state, speech buffers,
    Smart Turn or `onSegment`;
  - the final path clears the preview in the right order;
  - the Voice Mode commit keeps a later window's preview;
  - previews do not share decoder state with the final;
  - the pre-speech pad matches MicVAD;
  - `transcribeClientParakeetWindow` has no other callers, and nothing reads
    `isFinal`;
  - no cross-boundary changes.

#### Code Review #1 Revisions

- **P2-R1-1: accepted and fixed.** Each window's first preview always runs,
  which re-measures the rate; the prediction applies only to later previews in
  the same window. New test: "previews a new window again after a slow decode
  stopped the previous one".
- **P2-R1-2: accepted and fixed.**
  - On Parakeet mute, `muteVoiceMic` resets the controller, which drops
    in-flight results.
  - It clears the preview unless the mute is a push-to-talk flush, where the
    queued final replaces it.
  - `createParakeetPreviewSession` clears any leftover preview display.
  - The preview helpers moved above `muteVoiceMic` so its dependency list is
    valid.
  - Manual check above: mute clears the preview.
- **P2-R1-3: accepted and fixed.**
  - `maxPreviewDecodeMs <= 0` disables previews in the controller. New test:
    "never previews when the decode budget is zero".
  - Decision: this stays an internal constant in
    `DEFAULT_PARAKEET_PREVIEW_CONFIG`, with no debug override or user setting.
  - The recovery section was corrected.
- **Optional items:**
  - **accepted:**
    - the R1 disclosure (above, and in the PR);
    - dispatch gating through a new `shouldPreview` option, used for session
      staleness and assistant runs, with a test;
    - frames are trimmed to the 20 s cap;
    - tests for the interval multiplier, `endWindow(null)` and the capped tail;
    - previews run without profiling (`enableProfiling` only for finals);
    - `voice.md` now says "600 ms of window audio", clarifies manual sends and
      realigns the table;
    - the deviation and the checks that were not performed are recorded above.
  - **deferred to Phase 3:**
    - redemption-period decodes;
    - the `reset()` double-queue. Its cost is bounded, and only fast backends
      could make it matter.
  - **note:** no Prettier check covers `docs/`. The root `.prettierignore`
    ignores everything, and the web-package invocation (root `.prettierrc`,
    `tabWidth: 4`) also flags the unchanged baseline. The `voice.md` diff is
    limited to the intended sections, and the provider table is aligned to
    Prettier's default widths.
- **Verification:**
  - 20 controller and runtime tests pass;
  - `tsc -b` and `eslint` pass on the touched files;
  - manual mute and stop/restart checks as above.
- **Next:** targeted recheck #2.

#### Code Review #2 Findings (repair round 1)

The same reviewer ran a targeted recheck. P2-R1-1 to P2-R1-3 and the accepted
optional items are verified.

- **P2-R2-1 (required, regression from the revisions):**
  - A window's first preview skipped the prediction. When `shouldPreview`
    held that preview back (for example during an assistant run in Voice
    Mode), it could later decode the whole buffered window, up to the 20 s
    cap, with no budget check.
  - The worker is serial, so the next final could then wait well past
    800 ms.
  - The reviewer's probe: 9.6 s of audio held back, a 3.85 s predicted
    decode, and no `budget_exceeded` event.
- **Optional:**
  - the "capped tail" test passes without the trimming, so it does not prove
    memory is trimmed;
  - the plan's claim that root Prettier passes is vacuous, because the root
    `.prettierignore` ignores everything;
  - table padding.

#### Code Review #2 Revisions

- **P2-R2-1: accepted and fixed.**
  - A first preview is exempt from prediction only while it is on time, with
    window audio no longer than pad + `firstPreviewMs` + `minIntervalMs`
    (about 1.4 s by default). Longer first previews are predicted like any
    other.
  - New test: "budget-checks a first preview that was held back until the
    window grew long". The `voice.md` bullet and the controller header are
    updated.
- **Optional items, accepted:**
  - the test is renamed to "never decodes more than the capped audio tail";
  - the Prettier note is corrected (above);
  - the table is aligned to Prettier's default widths.
- **Verification:**
  - 19 controller tests pass;
  - `tsc -b` and `eslint` pass.
- **Budget:** one repair round remains. The next step is final targeted
  recheck #3, the last allowed.

#### Code Review #3 Findings (repair round 2, final)

The same reviewer checked P2-R2-1 again.

- **P2-R2-1:** fixed when a decode rate is already known.
- **P2-R3-1 (required):**
  - Every Parakeet start and every Voice Mode unmute (including each desktop
    push-to-talk press) creates a new controller with no measured rate.
  - If that controller's first preview is held back (assistant still running
    or speaking), it can still be sent unchecked with the whole window.
  - That decode can take up to about 6.4 s on WASM, and the window's final
    queues behind it.
  - The reviewer's probe: 9.6 s held back on a new controller, with no
    `budget_exceeded` event.
- **Accepted round-2 optional items:** verified.
- **Result:** blocked, with both repair rounds used.

#### Code Review #3 Revisions

- **P2-R3-1: accepted and fixed after the review budget was exhausted.**
  - A first preview that is not on time is treated as over budget when no rate
    has been measured. The window stops previewing and emits `budget_exceeded`
    with `predictedDecodeMs: null`; the event type now allows `null`.
  - New test: "does not send a late first preview before any decode rate is
    known".
  - The `voice.md` bullet is updated.
  - Verification:
    - the 22 controller and runtime tests pass;
    - `tsc -b` and `eslint` pass;
    - the full `pnpm web:test` run passes (297 files, 1,780 tests).
- **Budget:** the bounded review budget was spent at this point. The owner
  chose to authorize one extra targeted recheck (below) rather than accept the
  fix without review.

#### Code Review #4 Findings (owner-authorized extra recheck, 2026-09-25)

Limited to P2-R3-1 and regressions from its fix.

- **Result: pass.**
- **P2-R3-1:** fixed. The reviewer's probe of a new controller held back for
  9.6 s now sends no request and emits `budget_exceeded`.
- **No regressions:**
  - a later preview can't run without a measured rate;
  - the normal flow on a new controller, the slow-decode recovery, the zero
    budget and the rate-known held-back cases all behave as before;
  - the null-rate stop applies to one window only;
  - the only event consumer spreads the payload, so `null` is safe.
- **Non-blocking:** record this review here (done).

#### Code Review #4 Revisions

None required. Phase 2 passes review.

### Phase 2 amendment: previews only on the WebGPU backend

Source: owner instruction on 2026-09-25, after the Phase 2 evidence. On
single-thread WASM a preview covers only about 2 s and then freezes, which
looks like a stall.

Issue: #100 (amendment). Depends on: nothing.

Outcome: live previews run only when the loaded Parakeet backend is WebGPU.
The CPU (WASM) backend produces final-only transcripts again, as before this
plan. The controller, its budget and the stale-result handling stay as the
WebGPU safety net.

Steps:

1. **Gate.** `use-dictation` creates a preview controller only when the
   worker's load result reports `backend: "webgpu"`. Until Phase 3 exists,
   the result is always `"wasm"`, so no controller is created.
2. **Docs.** `voice.md` states that previews require the WebGPU backend.
3. **Tests.** Add a pure `shouldEnableParakeetPreviews(backend)` helper with a
   unit test. The rest is already covered by the controller tests.

Checks: `pnpm check`, `pnpm web:lint`, `pnpm web:test`. Then a targeted review.

**Results (2026-09-25):**

- `pnpm web:test`: 297 files, 1,781 tests.
- `pnpm web:lint` and `pnpm check`: exit 0.

**Code Review #1 (independent):** pass.

- All requirements were verified:
  - no controller or preview request on WASM;
  - callbacks are null-safe;
  - mute, stop and resume behave;
  - the final path is unchanged.
- Optional items, accepted:
  - clarify that WASM is the only backend until Phase 3;
  - replace the plan-phase wording in `voice.md` with the hardware context;
  - three stale plan statements, now updated.
- Optional item deferred to Phase 3: narrowing `backend: string` to
  `ClientParakeetBackend` once the union widens.
- The hook wiring has no automated test, because `use-dictation` has no hook
  test harness; it was verified by reading the code.

### Phase 3: experimental WebGPU toggle

Source: the owner's G1 decision and the Phase 3 scope approval on 2026-09-25.
Issue: #113. Depends on: the Phase 2 amendment (`e091c69`).

Outcome:

- App Settings gains an **Experimental** section with a "GPU-accelerated
  offline speech (WebGPU)" toggle, off by default.
- When it is on and available, Parakeet loads the fp16 encoder on WebGPU and
  the int8 decoder on WASM, and live previews run. Otherwise, or if the WebGPU
  load fails, Parakeet uses the existing WASM int8 backend with final-only
  transcripts.

Decisions (owner-approved direction, agent-proposed details):

- **Setting:** `speech.stt_parakeet_webgpu: boolean`, default `false`. There
  is no automatic enablement.
- **Model files:** the fp16 encoder is a **separate optional model set**,
  `parakeet-tdt-0.6b-v2-webgpu`, pinned to
  `ysdede/parakeet-tdt-0.6b-v2-onnx@db4a768f…`. It is acquired with a new
  `scripts/models/parakeet_webgpu.py` that reuses the `parakeet.py` store
  helpers, as `browser_speech.py` does. The approved seven-file Parakeet
  inventory and the desktop pack stay unchanged.
- **Availability:** development stacks served by Vite, including
  `desktop:dev`. The built self-host and packaged desktop apps report the GPU
  model as not installed; serving it there is a follow-up that belongs with
  pack planning.
- **Missing model or no WebGPU:** the toggle stays visible, but a status line
  explains why it is inactive. The worker falls back to WASM.

Steps:

1. **Model set.**
   - Add `models/parakeet-tdt-0.6b-v2-webgpu/manifest.json`, with the fp16
     encoder (size and SHA-256) plus `README.md` and `ATTRIBUTION.md`.
   - Add `scripts/models/parakeet_webgpu.py` (`acquire|verify|path`) with
     tests in `tests/`, following `tests/test_browser_model_store.py`.
2. **Serving (development).**
   - `reset.sh` resolves the optional variant offline. If it is present, it
     records `ANIMAMA_PARAKEET_WEBGPU_MODEL_DIR`. Otherwise it records an
     empty value, and development Compose falls back to the tracked notices
     directory, so Compose never fails.
   - `docker-compose.development.yml` mounts it read-only for `web`.
   - The Vite plugin serves it at `/__client-parakeet-webgpu-models`, with an
     optional directory (no startup failure).
   - Existing stack/compose tests are updated.
3. **Client.**
   - `ClientParakeetBackend = "wasm" | "webgpu"`.
   - Asset URLs for the fp16 encoder.
   - A capability probe: `navigator.gpu` plus an adapter, and a `HEAD` request
     for the fp16 encoder.
   - Backend resolution: the preference must be on and both probes must pass.
4. **Worker.**
   - The WebGPU load uses the JSEP ORT build (`webgpu-hybrid`, fp16 encoder,
     int8 decoder).
   - ORT's WASM build cannot switch within one worker, so the client
     terminates and recreates the worker when the backend changes.
   - On a WebGPU load failure, the client falls back to WASM and logs the
     reason.
5. **Settings UI.** Add the Experimental section with the toggle and a status
   line: active, not supported on this device, GPU model not installed, or
   fell back to CPU.
6. **Previews.** The Phase 2 amendment gate enables them automatically on
   WebGPU.
7. **Docs.**
   - `voice.md`: backends, the toggle and previews.
   - `docs/backend/operations/model-assets.md` and `scripts/models/README.md`:
     the optional variant.
   - The settings documentation, if it exists.

Tests: the model-store script (Python); backend resolution and fallback
selection (pure TypeScript); the preference default; the settings toggle,
if existing UI test patterns allow.

Manual checks (task stack, Chrome and `desktop:dev`):

- the toggle is off by default;
- the toggle on without the model shows "not installed" and the app still
  works;
- after acquiring the model, the toggle on activates WebGPU, and previews
  update through a 15.9 s clip;
- toggling off returns to WASM with final-only transcripts;
- fallback when WebGPU is unavailable (simulated).

Checks: `pnpm check`, `pnpm web:lint`, `pnpm web:test`, `pnpm build`,
`pnpm desktop:check`, the relevant `uv run pytest -q` model and stack tests,
`bash -n reset.sh`, and the Compose `config --quiet` commands from
`AGENTS.md`.

Follow-ups (not in this plan):

- serving the GPU model in built self-host and in a desktop pack;
- desktop WASM threads (declined for now on 2026-09-25);
- investigating the slow Electron WebGPU decoder loop (Phase 1: 289 of 515 ms
  at 12 s, against 90 ms in Chrome), and using decoder-state reuse for
  previews (about 40% less decoder time on Electron WebGPU);
- skipping preview decodes during the 1.4 s VAD redemption period at window
  end. On WebGPU a preview is often in flight at speech end; the measured
  final still landed 0.56–0.67 s after it;
- the `reset()` double-queue edge (a new session can queue one preview behind
  an old decode), now reachable on WebGPU; its cost is bounded;
- falling back when the GPU device is lost after a successful load;
- memory measurement for WebGPU.

The amendment's deferred narrowing of `backend` to `ClientParakeetBackend`
was done in Phase 3.

#### Phase 3 results (2026-09-25)

**Source:** `e091c69` plus the Phase 3 working tree, on the task stack after
running `reset.sh` again. The optional set was imported offline from the
Phase 1 spike file, verified at
`<store>/parakeet-tdt-0.6b-v2-webgpu/b62312c6…`.

**Manual checks** (agent-run, Chrome 153 test profile with the fake microphone,
Apple M5):

- **Settings UI:** App Settings → Experimental shows the toggle off and the
  status "Available on this device…". Clicking it saved
  `speech.stt_parakeet_webgpu: true` and kept the other speech keys.
- **WebGPU dictation, 15.9 s clip:**
  - load 8.6 s, including the uncached 1.24 GB encoder;
  - previews every ~0.6 s through the whole utterance, decoding in 110–430 ms,
    with no budget stop;
  - final transcript 0.6 s after speech end, against ~5.9 s on WASM.
- **Warm-up (added after one run hit a budget stop, consistent with a cold
  first decode):** three fresh loads each had a first preview of 150–170 ms
  and no budget stops.
- **Electron 39 `desktop:dev`:** WebGPU loaded, and previews ran through a
  17 s window (decodes 150–445 ms, no budget stop), followed by the final.
- **In-session switch:** turning the toggle off terminated the WebGPU worker
  and loaded WASM (`backendReason: setting_off`), with no previews.
- **Fallback:** Chrome was started with `--disable-gpu`, and `navigator.gpu`
  was stubbed on the main thread only, so the probe said `available` but the
  worker had no WebGPU.
  - The WebGPU load failed. In this run ORT threw `std::bad_alloc` while
    building the FP16 session on WASM, before the device check was reached.
  - The client logged the fallback, loaded WASM, and final transcripts
    continued.
  - The second start in the same page (the `load_failed` no-retry path) was not
    observed, because the automation's stop/start clicks raced the WASM load.
- **Serving:**
  - `HEAD /__client-parakeet-webgpu-models/encoder-model.fp16.onnx` returns
    200;
  - missing files return 404;
  - a stack without the set falls back to the tracked notices directory
    (Compose test).

**Voice Mode on WebGPU** (Chrome, run after the final integration review on
`5a84307`, with `chat:sse` intercepted and answered with 503):

- previews ran through the 17 s window;
- the final landed 0.67 s after speech end;
- auto-submit fired after the final and Smart Turn;
- the intercepted `message` was the full final transcript.

**Not performed:**

- a real microphone;
- Electron Voice Mode on WebGPU;
- `model_missing` on a live stack (covered by unit and Compose tests);
- WebGPU on non-Apple GPUs;
- memory measurement;
- a WebGPU before/after final-latency comparison with previews disabled;
- automated coverage of `reset.sh`'s present and verification-failure paths
  for the optional set. The `reset.sh` harness stubs only the base model
  scripts; the present path was verified manually by `reset.sh` recording the
  store path.

**Checks** (on the working tree before the Code Review #1 fixes; the rerun after
the fixes is under Code Review #2 Revisions below, and the checks on `5a84307`
are under Final integration):

- `pnpm check`, `web:lint`, `web:test` (298 files, 1,791 tests), `build` and
  `desktop:check`: all exit 0;
- `uv run pytest` model-store, Compose and state-script tests: 208 passed, 6
  skipped;
- `ruff check`, `bash -n reset.sh`, and both `docker compose ... config
--quiet` commands: OK.

#### Code Review #1 Findings

Reviewer: independent `sdlc-reviewer` subagent. Source: `e091c69` plus the
Phase 3 working tree. Round: initial.

- **P3-R1-1 (required):** in `webgpu-hybrid` mode, ORT drops a WebGPU provider
  that fails to start and runs on WASM without throwing. The worker would
  then report `webgpu` and never fall back: the FP16 encoder runs on WASM,
  previews are enabled, and the panel says "Active".
- **P3-R1-2 (required):** the manifest validator accepted non-canonical
  SHA-256 strings (uppercase, `0x`, `_`, whitespace), unlike its sibling
  scripts.
- **P3-R1-3 (required):** the preference-default test was missing.
- **Optional:**
  - **P3-R1-4:** a persistent WebGPU failure was retried at every start, each
    time discarding a warm WASM worker;
  - **P3-R1-5:** a `stt_parakeet_webgpu: false` default in
    `DEFAULT_ANIMAMA_PREFERENCES` could let Anima preferences override the
    app toggle;
  - **P3-R1-6:** tests for serving and the build-time define;
  - **P3-R1-7:** two inaccurate `voice.md` statements;
  - **minor:**
    - `reset.sh` treats a corrupt optional set like a missing one;
    - the CI `SHARED_TESTS` list lacks the new test;
    - the plan's "empty stack-local directory" text;
    - the panel's status is read during render;
    - a placeholder `status` in `client.ts`.
- **Verified without findings:**
  - the worker lifecycle and its guard;
  - the encoder URL versioning and same-origin check;
  - status caching;
  - Vite route 404/traversal handling and HEAD support;
  - `reset.sh` under `set -eo pipefail`;
  - the Compose mount;
  - the pack inventory is untouched, and no new production artifact is added
    (the JSEP WASM was already emitted);
  - the warm-up has no cache side effects;
  - preference merging;
  - UI accessibility and error handling;
  - boundaries.

#### Code Review #1 Revisions

- **P3-R1-1: accepted and fixed.**
  - After loading `webgpu`, the worker requires ORT's own
    `env.webgpu.device` value property, which ORT defines only after WebGPU
    initializes. If it is missing, the worker releases the model and throws,
    so the client falls back.
  - Verified manually as above: the fallback runs and final transcripts
    continue.
- **P3-R1-2: accepted.** `re.fullmatch(r"[0-9a-f]{64}")` is now used, and
  uppercase and `0x` cases are added to the test (13 passed).
- **P3-R1-3 and P3-R1-5: accepted.**
  - The default entry is removed.
  - A new `isParakeetWebgpuPreferred()` helper is used by both the hook and
    the panel.
  - A test covers absent, default, string and `true` values.
- **P3-R1-4: accepted.**
  - A per-page `webgpuLoadFailed` flag sends later starts straight to WASM
    with reason `load_failed`.
  - The panel's status refresh clears the flag.
  - The fallback log now reports the actual reason.
- **P3-R1-6: accepted.** Added tests for a null model root answering 404, the
  optional resolver returning `null`, and `null` WebGPU defines in production
  and embedded-desktop builds.
- **P3-R1-7: accepted.** The `voice.md` status table and the load-failure
  behavior are corrected.
- **Minor items, accepted:**
  - `reset.sh` warns when the optional set fails verification (non-2 exit);
  - `test_webgpu_model_store.py` is added to CI `SHARED_TESTS`;
  - the plan text is corrected.
  - Kept as is: the render-time status read (it updates on reopen), and the
    pending-request edge on a mid-final toggle.
- **Accidental change caught and reverted:** a broad `prettier --write`
  reformatted 11 unrelated files. They were restored from HEAD before the
  checks.
- **Next:** targeted recheck #2.

#### Code Review #2 Findings (repair round 1)

- **All code revisions verified:** P3-R1-1 to P3-R1-7, the minor items, and
  that no unrelated files were changed.
- **P3-R2-1 (required, evidence):** the WebGPU success path had not been run
  since the P3-R1-1 device check was added. If that check wrongly failed,
  WebGPU would silently fall back every time.
- **Optional:**
  - the `load_failed` no-retry path has no test;
  - the `reset.sh` warning should pass `--root`.

#### Code Review #2 Revisions

- **P3-R2-1: accepted and verified** on the revised source (working tree over
  `e091c69`, served by the task stack through Vite), in the Chrome test
  profile with the 15.9 s clip:
  - the load was requested as `backend: "webgpu"`, with no failure or fallback
    log;
  - previews ran every ~0.6 s through the 17 s window (decodes 115–494 ms, no
    budget stop), which the Phase 2 amendment gate allows only on WebGPU;
  - the final transcript landed 0.56 s after speech end.
- **`reset.sh` hint: accepted.** The warning now suggests
  `verify --root "$ANIMAMA_MODEL_ROOT"`.
- **`load_failed` test: deferred.** `client.ts` has no worker test harness; the
  code path was reviewed and reads correctly.
- **Budget:** one repair round remains. Phase 3 passes review.
- **Checks after the revisions:**
  - `pnpm check`, `web:lint`, `web:test` (298 files, 1,794 tests), `build` and
    `desktop:check`: exit 0;
  - pytest model, Compose, state and CI policy tests: 305 passed, 6 skipped;
  - `ruff check` and `bash -n reset.sh`: OK.

## Final integration review

Covers the combined diff and whole-plan acceptance, reusing unchanged phase
evidence. It confirms that:

- previews cannot change the final text, Smart Turn or submission
- docs describe current behavior
- the PR discloses G1 and every check that was not performed

Findings and revisions are recorded here. Budget: one full review plus at most
two repair rounds.

**Checks on `68cdf0e`** (2026-09-25, from `src/frontend`, with only
plan/doc edits uncommitted):

| Command              | Result                             |
| -------------------- | ---------------------------------- |
| `pnpm check`         | exit 0 (web and desktop typecheck) |
| `pnpm web:lint`      | exit 0                             |
| `pnpm web:test`      | exit 0, 297 files, 1,780 tests     |
| `pnpm build`         | exit 0                             |
| `pnpm desktop:check` | exit 0                             |

The production `dist` contains only `index.html`. A search for
`parakeet-bench`, `ParakeetBench` and `__parakeetBenchResult` finds nothing.
Backend code is unchanged, so no backend checks were run. Hosted `Validation`
is recorded in the PR.

#### Code Review #1 Findings (final integration)

Reviewer: independent `sdlc-reviewer` subagent. Source: `c612e9d..68cdf0e`
plus the uncommitted plan edit recording `68cdf0e`. Round: initial.

- **FI-R1-1 (required):** the plan had no recorded Phase 2 run of `check`,
  `lint`, `build` or `desktop:check`, and the latest build predated the
  P2-R3-1 fix.
- **FI-R1-2 (required):** `voice.md`'s short-utterance override section still
  said "Parakeet has no interim path".
- **Optional:**
  - **FI-R1-3:** the "faster backends preview whole utterances" line describes
    a backend that doesn't exist yet;
  - **FI-R1-4:** the `onTranscriptPreview` description omits Parakeet;
  - **FI-R1-5:** plan hygiene: test count, stale issue placeholders, the
    authorized-scope header, marking the Phase 3 draft as superseded, missing
    "not performed" items, which source tree the manual runs used, and a
    machine-specific port.
- **Verified without findings:**
  - preview isolation from the final, Smart Turn and submission;
  - the benchmark is excluded from production;
  - phase compatibility (shared ORT via Vite `dedupe`; the product worker
    still uses the non-JSEP WASM);
  - the MicVAD frame signature;
  - plan record consistency;
  - commit conventions;
  - no private paths.

#### Code Review #1 Revisions (final integration)

- **FI-R1-1: accepted.** The full suite was rerun on `68cdf0e` and recorded in
  the table above.
- **FI-R1-2: accepted.** The reason now says Parakeet previews are
  display-only and never enter the per-turn buffers.
- **FI-R1-3, FI-R1-4, FI-R1-5: accepted and fixed:**
  - the line was removed;
  - the `onTranscriptPreview` description now includes Parakeet previews;
  - the test count is corrected, issues #99 and #100 are linked, the scope
    header is updated, the Phase 3 draft is marked as superseded by G1, the
    "not performed" items and the manual-run source note are added, and the
    port is now a placeholder.
- **Next:** targeted recheck #2.

#### Code Review #2 Findings (final integration, repair round 1)

- **Result: pass.** FI-R1-1 to FI-R1-5 are resolved, with no regressions.
- The reviewer independently checked the raw check log and re-verified that
  `dist` excludes the benchmark.

#### Code Review #2 Revisions (final integration)

None required. The final integration review for Phases 1–2 passed with one
repair round used.

#### Code Review #3 Findings (final integration, full scope after Phase 3)

Reviewer: independent `sdlc-reviewer` subagent. Source: `c612e9d..5a84307`.
Round: initial for the full scope. Earlier phase reviews stand.

- **No code, boundary or documentation defects.**
- **FI2-R1-1 (required):** Validation and acceptance, and the Phase 3 "Not
  performed" list, still described the pre-amendment outcome. Voice Mode on
  WebGPU had not been run.
- **FI2-R1-2 (required):** Idempotence and recovery was stale after Phase 3.
- **FI2-R1-3 (required):** the Phase 3 commit was not recorded, and a Checks
  cross-reference was wrong.
- **Optional:**
  - FI2-R1-4: deferred items had no disposition;
  - FI2-R1-5: `reset.sh`'s WebGPU present and failure paths have no automated
    coverage;
  - the PR body is stale;
  - a GPU device lost after load does not fall back;
  - cosmetic wording.

#### Code Review #3 Revisions (final integration)

- **FI2-R1-1: accepted.**
  - Validation and acceptance is rewritten per backend, adding the WASM
    final-only criterion, toggle behavior, and the Phase 3 checks and owner
    steps.
  - Voice Mode on WebGPU was run on `5a84307` and recorded under Phase 3.
  - The "Not performed" list is extended.
- **FI2-R1-2: accepted.** Idempotence and recovery is rewritten: optional set
  removal and reacquisition, the toggle, the revert caveats and the inert
  preference.
- **FI2-R1-3: accepted.** `5a84307` is recorded in Progress, the
  cross-reference is fixed, and HEAD checks are recorded below.
- **FI2-R1-4: accepted.** Follow-ups are listed under Phase 3, and the type
  narrowing is recorded as done.
- **FI2-R1-5: disclosed** under Phase 3 "Not performed" rather than extending
  the `reset.sh` harness in this plan.
- **PR body:** updated when the branch is pushed.
- **Device loss after load:** listed as a follow-up.
- **Cosmetic:**
  - the `voice.md` fallback wording now matches the panel;
  - the Decision Log note is updated.

**Checks on `5a84307`:** the tree is identical to the Phase 3 tree checked
after Code Review #2 (`pnpm check`, `web:lint`, `web:test` 298/1,794, `build`,
`desktop:check`, pytest 305 passed / 6 skipped, `ruff`, `bash -n`, both Compose
configs).

- The reviewer reran `tsc -b`, `eslint`, the targeted vitest (53) and pytest
  (14) runs, `ruff` and `bash -n` on HEAD.
- This revision changes only the plan and `voice.md`.

#### Code Review #4 Findings (final integration, repair round 1)

- **FI2-R1-1 to FI2-R1-4 and the cosmetic items:** verified.
- **FI2-R2-1 (required):** the rewritten Validation items 3–4 overstated the
  evidence.
  - No first-preview time after speech start was recorded for WebGPU.
  - "Well under the Phase 2 target" was claimed without a before/after
    comparison.
- **Optional:** a `voice.md` line was not re-wrapped.

#### Code Review #4 Revisions (final integration)

- **FI2-R2-1: accepted.**
  - Item 3 now cites the observed WebGPU trace: first preview 0.86 s after
    speech start.
  - Item 4 states the inference: about 0.26–0.37 s added, roughly one preview
    decode, within the target by inference.
  - The missing WebGPU before/after comparison is added to Phase 3 "Not
    performed".
- **Line wrap: fixed.**
- **Budget:** this revision is the second and last repair round for the
  full-scope final integration review, and it was verified by recheck #5.

#### Code Review #5 (final integration, final targeted recheck)

- **Result: pass.** FI2-R2-1 is resolved and no regressions were found.
- Repair rounds used: 2 of 2.
- Non-blocking notes (the source-state line for the first WebGPU trace, and
  the budget wording) are applied above.

## Validation and acceptance

1. The Phase 1 results table and the G1 decision are recorded.
2. **Default (WASM) backend:** Parakeet in Chrome and `desktop:dev` is
   final-only. No interim text appears, and the final text is unchanged.
3. **WebGPU backend** (with the optional set acquired and the Experimental
   toggle on), in Chrome and `desktop:dev`:
   - interim text appears within ~1.5 s of speech start and updates while
     speaking;
   - the final text replaces it;
   - evidence:
     - in the first Phase 3 WebGPU dictation trace (the Phase 3 tree before
       the warm-up and Code Review #1 fixes; later runs had warm first decodes
       of 150–170 ms), speech started at 19.01 s
       and the first preview arrived at 19.87 s, about 0.86 s after speech
       start (600 ms threshold plus the first decode);
     - updates every ~0.6 s;
     - finals 0.56–0.67 s after speech end, against ~5.9 s on WASM.
4. **Voice Mode never submits on a preview.** The Phase 2 Voice Mode, mute and
   stop/restart checks are reused as backend-independent controller evidence,
   and Voice Mode on WebGPU was run in Phase 3.
   - WASM creates no preview, so previews add no final latency there.
   - On WebGPU a preview may be in flight at speech end. Phase 1's warm decode
     of the 15.9 s clip was about 300 ms, which implies previews add about
     0.26–0.37 s to the measured 0.56–0.67 s finals. That is roughly one
     preview decode, within the Phase 2 target by inference.
   - A WebGPU before/after comparison without previews was not run.
5. **Toggle behavior:** off by default. With the toggle on:
   - no WebGPU, missing model, or an unserving build falls back to WASM, and
     the status line says why;
   - a failed WebGPU load falls back to WASM.
6. **Checks:**
   - `pnpm check`, `pnpm web:lint`, `pnpm web:test`, `pnpm build` and
     `pnpm desktop:check`;
   - pytest model-store, Compose, state-script and CI-policy tests;
   - `bash -n reset.sh`;
   - both `docker compose ... config --quiet` commands.

   Hosted `Validation` results are recorded separately in the PR.

7. **Owner manual acceptance** on the task stack with a real microphone:
   - default WASM: final-only;
   - after `python3 scripts/models/parakeet_webgpu.py acquire` and `reset.sh`,
     turn on App Settings → Experimental → GPU-accelerated offline speech:
     live previews in dictation and Voice Mode;
   - toggle back off: final-only.

This plan does not establish packaged-app behavior, feature-pack installation or
release readiness.

## Idempotence and recovery

- **Spike files:** the Phase 1 benchmark inputs and spike encoder copy live in
  a developer cache outside the verified model store. They can be deleted and
  fetched again safely.
- **Optional WebGPU model set:** about 1.24 GB at
  `<store>/parakeet-tdt-0.6b-v2-webgpu/<digest>`.
  - To remove it, first check the stack records and mounts, following the
    `model-assets.md` cleanup guidance.
  - Then rerun `reset.sh`. The stack records an empty
    `ANIMAMA_PARAKEET_WEBGPU_MODEL_DIR`, Compose mounts the notices directory,
    and the setting reports `model_missing`.
  - Reacquire it with `python3 scripts/models/parakeet_webgpu.py acquire`.
- **Turning previews and WebGPU off:**
  - Users turn off App Settings → Experimental → GPU-accelerated offline speech
    (`speech.stt_parakeet_webgpu`). WASM is final-only.
  - Developers can also set `maxPreviewDecodeMs: 0` in
    `DEFAULT_PARAKEET_PREVIEW_CONFIG` to disable previews on every backend.
- **Reverting:** all changes are client-side or development tooling, with no
  schema or backend change.
  - Reverting the branch as a whole restores the pre-plan behavior.
  - Reverting individual phase commits needs care, because the amendment and
    Phase 3 build on Phase 2's controller and hook changes.
  - A reverted build ignores a saved `stt_parakeet_webgpu` preference; the key
    becomes inert.
- **Task stack:** it uses its own Compose project (`animama-stt`). Stop it with
  project-scoped commands per the
  [cleanup guide](../../backend/operations/development.md#cleaning-up-worktree-stacks).
  Never touch the main stack.

## Outcomes & Retrospective

_To be completed when the plan closes._
