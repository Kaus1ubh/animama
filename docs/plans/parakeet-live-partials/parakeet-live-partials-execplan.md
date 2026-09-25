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
- Phase 3 is being revised to match that decision and needs owner approval
  before implementation.

## Purpose and context

Desktop dictation and Voice Mode use only local Parakeet, because Electron's Web
Speech API fails with `network` errors. On web, Parakeet is the fallback when
browser recognition is unavailable.

Today the user sees no text until MicVAD closes a speech window and the worker
decodes that window once.

When this plan is done:

- While the user speaks, Parakeet shows interim text in the chat input about once
  a second, in both dictation and Voice Mode.
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
  - The Phase 3 details need a plan revision and owner approval.
- [x] Phase 2: live Parakeet partial transcripts.
  - Review passed after two repair rounds and one extra recheck authorized by
    the owner.
  - Commit `68cdf0e` (`feat(voice)[p2]`).
- [ ] Phase 3: WebGPU as an experimental setting (plan revision pending).
- [x] Final integration review passed (one repair round). The PR is opened
      from this branch; see the PR for hosted `Validation`.
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
- **2026-09-25, owner, review limit:** authorized one extra targeted recheck
  of P2-R3-1 after the bounded budget was spent. The recheck passed.

- **2026-09-25, owner:**
  - Keep Parakeet v2 and add growing-buffer partials plus a WebGPU spike.
  - Test in a worktree Compose development stack.
  - Leave feature-pack release planning out of this plan.
- **2026-09-25, agent proposals (accepted with this plan unless the owner changes
  them):**
  - Partials get no new user setting.
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

### Phase 3 (only if G1 = a): adopt the WebGPU encoder

> **Superseded by the G1 decision (2026-09-25).** WebGPU becomes an opt-in
> "Experimental" setting rather than automatic capability-based selection. The
> steps below are the original draft and are pending revision and owner
> approval. Do not implement them as written.

Issue: _created only after the revision is approved_.

Outcome: when WebGPU is available, Parakeet runs the fp16 encoder on WebGPU and
the int8 decoder on WASM. If WebGPU is unavailable, or the model load or first
decode fails, it falls back to WASM int8.

1. **Backend selection.** Widen `ClientParakeetBackend` to `"wasm" | "webgpu"`.
   The client selects it from capability detection and logs the backend chosen.
2. **Model files.**
   - Add the fp16 encoder to `models/parakeet-tdt-0.6b-v2/manifest.json`, pinned
     with its size and SHA-256.
   - Update verification in `scripts/models/parakeet.py`,
     `CLIENT_PARAKEET_MODEL_ASSET_PATHS`, and the FastAPI and Vite model-serving
     paths.
3. **Documentation.** Update `voice.md` and
   `docs/backend/operations/model-assets.md`.
4. **Pack follow-up.** Record the effect on the desktop pack (inventory, size
   budgets, approval) as a separate follow-up; do not change pack inputs here.

Tests: unit tests for backend selection and fallback; round-trip the manifest
through `python3 scripts/models/parakeet.py verify`; all Phase 2 checks.

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

None required. The final integration review passed with one repair round
used.

## Validation and acceptance

1. The Phase 1 results table and the G1 decision are recorded.
2. On the task stack, with Parakeet in Chrome and in `desktop:dev`:
   - interim text appears within ~1.5 s of starting to speak and updates while
     speaking
   - the final text replaces it
3. Voice Mode never submits on a preview, and final-text latency stays within the
   Phase 2 target (measured numbers recorded).
4. `pnpm check`, `pnpm web:lint`, `pnpm web:test`, `pnpm build` and
   `pnpm desktop:check` pass. Hosted `Validation` results are recorded separately
   in the PR.
5. The owner accepts manually on the task stack using a real microphone.

This plan does not establish packaged-app behavior, feature-pack installation or
release readiness.

## Idempotence and recovery

- **Spike files:** the benchmark inputs and the extra encoder file live in a
  developer cache outside the verified model store. They can be deleted and
  fetched again safely.
- **Reverting partials:** partials are client-only. Reverting the Phase 2 commit
  restores final-only behavior and changes no stored data.
- **Disabling previews:** set `maxPreviewDecodeMs: 0` in
  `DEFAULT_PARAKEET_PREVIEW_CONFIG` (`preview-controller.ts`) to turn previews
  off. It is an internal constant only, with no debug override or user setting.
- **Task stack:** it uses its own Compose project (`animama-stt`). Stop it with
  project-scoped commands per the
  [cleanup guide](../../backend/operations/development.md#cleaning-up-worktree-stacks).
  Never touch the main stack.

## Outcomes & Retrospective

_To be completed when the plan closes._
