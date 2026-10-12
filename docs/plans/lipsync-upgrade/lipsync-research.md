# Lip-sync upgrade research brief (as of 2026-10-12)

Investigation for [#468](https://github.com/raymond-van/animama/issues/468): how to
replace or upgrade Animama's lip-sync so the avatar's mouth follows what the voice
actually does, including vocal tags, laughter and languages other than English.
Source revision `1b34e471`. This brief is evidence and a recommendation for
`to-spec`; it changes no product code. **The owner has not chosen a direction yet**
(see [Owner decisions](#owner-decisions)).

Labels: **(M)** measured for this brief on the owner's Mac; **(V)** vendor or author
statement; **(I)** independent or third-party figure; **(U)** unverified.

## Summary

- **Today's lip-sync fails the three goals.** Japanese, Korean and Chinese lines
  give gruut no phonemes, so the mouth stays shut; vocal tags would be phonemized
  as words; and one global rescale cannot follow pauses, so the mouth is open in
  72% of the silent gaps in English lines (M). The same gruut step also decides
  which sentences reach the finalized TTS providers: a Japanese, Korean or Chinese
  sentence produces no TTS segment, so Gemini and Eleven v3 never speak it (M,
  function-level check).
- **Recommended direction: one browser lip-sync planner that aligns per-language
  text to the TTS audio, with vocal tags as non-speech events, in two tiers.**
  1. **Default, no download:** small text converters plus loudness and voicing
     alignment. About 5 KB of code (plus a 145 KB pinyin table loaded only for
     Chinese, and an English converter still to be sized) and about 3 ms of CPU per
     second of audio (M).
  2. **Optional model pack:** the ZIPA small phone recognizer (CC-BY-4.0 weights)
     feeds phone posteriors into the same aligner. About 52 ms of CPU per second of
     audio on one thread (M). The fp16 model (119 MB download) gave the best vowel
     match (78%) and placed all 8 tags; int8 (56 MB) gave 77% and 7 of 8 (M).
  3. **Provider timing** (ElevenLabs v4 character alignment, planned in
     [#471](https://github.com/raymond-van/animama/issues/471)) plugs into the same
     planner as a third timing source when present.
- **Drop the backend gruut step** in stages: first stop gating TTS on it, then
  move its English phonemes and talking-hands beats to the browser, then remove it.
- **Not recommended as the main path:** wLipSync (needs a calibration recording per
  voice and scored lowest of the vowel-classifying methods), jaw-from-volume alone
  (no vowel shapes), heavy audio-to-face models (hundreds of MB, GPU runtimes).

| Approach (prototype) | Vowel match, ja/ko/zh/es | Open in silence, English / tag lines | Tags placed | CPU, ms per audio s (Chromium / Electron) | Download (gzip) |
| --- | --: | --: | --: | --: | --: |
| Today: gruut + rescale | 6% | 72% / 65%¹ | read as words¹ | 0.02 / 0.02, plus 17–549 ms of backend gruut per speech event | 4 KB + backend gruut |
| 2. Jaw from volume | 26% (always "A") | 11% / 23% | not aware | 0.04 / 0.04 | 0.6 KB |
| 1. wLipSync, per-voice profile | 33% | 8% / 23% | not aware | 5.2 / 5.3 | 7 KB + profile per voice |
| 4+5. Text + audio (default tier) | 48% | 0% / 8% | 4/8 | 3.1 / 3.2 | 5 KB + English converter (+145 KB for zh) |
| 3. ZIPA phones, audio only (fp16) | 72% (int8: 72%) | 18% / 23% (int8: 22% / 24%) | not aware | 49 / 48 (int8: 50 / 48) | 119 MB (int8: 56 MB) |
| 3+4+5. Text + ZIPA, fp16 (pack tier) | 78% | 0% / 10% | 8/8 | 52 / 51 | as ZIPA fp16 + text |
| 3+4+5. Text + ZIPA, int8 (pack tier) | 77% | 0% / 6% | 7/8 | not run² / 52 | as ZIPA int8 + text |

All rows (M), from whole-clip alignment. Streaming changes some of these numbers,
and the CPU of a shipped progressive planner is not measured yet (see
[Streaming and latency](#streaming-and-latency)). Metrics, test set and caveats
are in [Method](#method). The text methods were tuned on this same small set, so
their scores are optimistic.

¹ Assumes tags reach gruut unchanged, which the prompt forbids today. With tags
stripped before gruut, today's plan is open in 34% of silent gaps on tag lines.
² The Chromium run of this row was discarded: it ran 4–5× slower than every other
run, consistent with a throttled hidden browser pane.

## Method

### Test set

21 clips, 24 kHz mono, covering four providers and five languages:

| Group | Clips | Source |
| --- | --- | --- |
| Vocal tags (8) | `<laugh>` (en, ja), `<gasp>` + `<laugh>` (zh), `<sigh>` (en, ko), `<gasp>` (en), `<long pause>` (en), `<whispers>` (en) | Gemini 3.8 Flash-Lite TTS, voices Leda, Kore and Puck |
| Other languages (6) | ja (plain and excited), ko, zh, es; ko through OpenAI realtime | Gemini Flash-Lite; OpenAI `gpt-realtime-2.1-mini` |
| English (3) | plain, sad, long four-sentence reply | Gemini Flash-Lite and Flash (long reply: one request per sentence) |
| English, local (4) | plain, "haha" laugh, pause, long reply | Pocket TTS `english_2026-04`, voices azelma and eve, rendered offline with the repo's runtime and the worker's 0.25 s chunk gap |

- **New paid generation:** 16 Gemini requests: 13 for 10 new test clips and 3
  calibration utterances, about 99 s of audio in total. That is roughly US$0.02 at
  the list prices in the 2026-10-09 survey (calculated). There were no 429s; the
  owner's key is on a paid tier.
- **Reused:** seven clips from the owner's 2026-10-09 speech model survey (Gemini
  and OpenAI); four Pocket TTS clips rendered locally.
- **Tags were performed, not read:** Parakeet transcripts of the English tag clips
  contain no "laugh", "sigh" or "gasp" (M).
- **ElevenLabs was not measured:** the development secrets held no ElevenLabs key
  at the time. Its timing and tag behaviour come from documentation only.

### Reference and metrics

The reference is MMS forced alignment (torchaudio `MMS_FA`) of the spoken words,
romanized per language. MMS weights are CC-BY-NC-4.0, so they are used for
evaluation only and are not a candidate. Scores are computed at 60 FPS, where
*openness* is a frame's largest vowel weight:

- **Vowel match:** on Japanese, Korean, Chinese and Spanish lines, the share of open
  frames inside a reference vowel letter whose strongest vowel matches it. English
  is excluded because its spelling is not a vowel reference.
- **Open in silence:** the share of quiet frames, inside any gap of 150 ms or more
  with no reference word (including leading and trailing silence, with 60 ms
  margins), where openness is at least 0.15. Lower is better.
- **Timing correlation:** correlation of openness with reference vowel activity.
- **Tags placed:** a tag event counts when its best intersection-over-union with any
  reference gap is at least 0.5. Gemini's 0.2 s leading silence caps the IoU of a tag
  at the start of a line at about 0.8.

Two limits of the reference:

- **Partly shared inputs:** the reference romanizes Japanese from the same
  `pyopenjtalk-plus` kana and Chinese from pinyin, as the text converters use. So
  the text methods' vowel match is partly circular; the audio-only methods are
  scored independently.
- **Romanization is not fully phonemic:** pinyin is not phonemic for *zhi/chi/shi/ri*
  or *e*, and Korean *eo*/*eu* were mapped by hand.

### Runtime

- **Machine:** Apple M5 (Mac17,2), 10 cores, 24 GB, macOS 26.6.2.
- **Runtimes:** a dedicated Web Worker in Chromium 152 (the Claude desktop app's
  browser pane) and in Electron 39.8.9, the desktop app's version. Medians of seven
  runs after a warm-up (three for ZIPA).
- **ONNX:** onnxruntime-web 1.24.2, the version of the app's Pocket TTS runtime
  asset (the Parakeet and VAD workers bundle 1.24.3), on the WASM backend with one
  thread.
  - The lab page was cross-origin isolated, but the app is not: Animama sets no
    COOP/COEP headers, so onnxruntime-web cannot use threads there. One thread is
    therefore the realistic setting, and four-thread figures are for reference.
- **Lab:** the prototypes, bench, scoring and data scripts live beside the private
  comparison page that the PR links; raw clips are not committed.

### Caveats

- **Small set:** 21 clips, with one clip for most tag kinds.
- **Tuned on the test set:** the text aligners' emission weights were tuned on these
  clips, with no held-out set, so their numbers are optimistic. The audio-only
  methods were not tuned.
- **Whole-clip alignment:** the accuracy table aligns each clip with all of its audio
  available. A streaming planner sees audio as it arrives; that case was simulated
  separately (see [Streaming and latency](#streaming-and-latency)).
- **Voice range:** no anime-pitched voice was tested. Gemini Leda is the brightest
  voice in the set.
- **Kanji readings:** Japanese kanji readings came from `pyopenjtalk-plus` run
  offline; a shipped design needs a browser-side reading source (see
  [Japanese kanji readings](#japanese-kanji-readings)).

## Current pipeline: verified gaps

1. **gruut gates TTS for finalized providers (M, function-level).**
   - `_attach_tts_speech_payload` (`product_http/chat/sse_events.py`) prepares a TTS
     segment only when gruut returns phonemes.
   - gruut is fixed to `en_US`, so Japanese, Korean and Chinese sentences return
     none. `chat/tts.py` then has no segment to send to **Gemini or Eleven v3**, and
     those sentences are shown but never spoken.
   - Spanish and tagged English pass, and `<laugh>` reaches `tts_text` unchanged.
   - This was checked by calling the function, not end to end in a running stack.
2. **No phonemes beyond English (M).** Every Japanese, Korean and Chinese line gave
   0 phoneme words. Tags became words (`<laugh>` → "laugh"), and Spanish got
   English phonemes.
3. **Drift (M).** On English clips today's plan is open in 72% of silent gaps,
   correlates 0.13 with the reference and runs about 130 ms early on average. On the
   Japanese laugh clip it stretches the single word "laugh" across the whole line.
4. **Latency cost (M).** With TTS on, the SSE path calls gruut twice per speech event
   (the speech frame, then the TTS segment). In a warm process this cost 17–69 ms
   for English, 40–79 ms for Japanese and Chinese, 227 ms for Spanish and
   294–549 ms for Korean (medians of five runs on the same text), though the Asian
   lines produce nothing. The first pass over a new sentence costs more: 32–141 ms
   for English in a single-run pass. For finalized providers this runs before the TTS request, so it adds to
   time to first audio.
5. **Packaging.** gruut and its English data are about 15 MB in the desktop runtime
   (2026-10-09 survey), and the upstream repository is archived (I, GitHub).
6. **Other consumers of gruut output** that a replacement must cover:
   - **Talking-hands beats:** `gruut-viseme-keyframes.ts` also builds the
     `SpeechGestureTimeline` (word timings, plus beats from primary-stress `ˈ`
     markers). `talking-hands-speech-planner.ts` and the lip-sync bridge consume it.
   - **SSE fields:** `tokenized_text` and `phonemized_text` on speech frames, and
     `tts_text`, `tts_phonemized_text` and `tts_text_basis` on TTS segments.
   - **Backend:** the `gruut_text_with_ws` text basis in `app/contracts/elevenlabs.py`
     and `server/finalized_speech.py`, and the desktop runtime self-check in
     `runtime/resources.py`.
   - **Prompt:** the tag ban appears three times, in `prompts/profiles.py` (twice)
     and in `app/main_structured_response.py` with different wording.

## Approaches

### 1. Audio-driven vowel classification (wLipSync / uLipSync)

wLipSync 1.3.1 (MIT, npm, 12 KB WASM) ports uLipSync's MFCC matching. It ships as
an AudioWorklet node; the prototype drove the same WASM exports from a worker so
analysis can run ahead of playback on pushed PCM.

- **Calibration:** each voice needs a profile of MFCCs for A/I/U/E/O/N.
  - The prototype recorded one TTS utterance of sustained あー いー うー えー おー んー
    per Gemini voice (one request each), and "Aaah. Eeee. …" per Pocket voice.
  - Six clean segments were found for all five voices, in 50–93 ms (M).
  - wLipSync has no calibration tool of its own; its README points to Unity (V).
- **Quirk found (M):** wLipSync 1.3.1 copies only as many MFCC coefficients into its
  compare buffer as the profile has entries. A six-entry profile therefore compares
  six of twelve coefficients. Padding profiles to twelve entries fixes it; the
  library's example profile happens to have twelve. Worth reporting upstream if
  adopted.
- **Results (M):**
  - Vowel match 33% with per-voice profiles. A profile pooled from the same five
    voices' calibrations scored 43%, which says nothing about unseen voices.
  - Open in silence 8–23%; timing correlation 0.22–0.35.
  - CPU 5.2 ms per audio second in a worker. The real AudioWorklet node in an
    OfflineAudioContext added about 7.4 ms per audio second at 48 kHz (approximate).
- **Fit:** language-independent, and it follows laughs as sound. But it cannot tell a
  laugh from speech, needs a profile for every Gemini voice and every Pocket clone,
  and is the least accurate of the vowel-classifying methods here.
- **Verdict:** not adopted. ZIPA is far more accurate at an acceptable cost.

### 2. Jaw from volume

A causal RMS follower drives "A" (with a little "O").

- **Results (M):** it has the best raw timing correlation (0.43–0.51), because the
  reference vowels coincide with loudness. But it never forms I, U, E or O (vowel
  match 26%, the share of "A" vowels), and its release tail leaves the mouth open in
  11–24% of silent gaps.
- **Verdict:** keep as the last-resort fallback for audio with no usable text and no
  model.

### 3. Phone recognition from audio (ZIPA)

[ZIPA](https://github.com/lingjzhu/zipa) small CR-CTC is a multilingual IPA phone
recognizer: 64M parameters, code MIT, weights CC-BY-4.0 (V). Its authors publish an
ONNX export with 127 tokens, 80-bin Kaldi fbank input and 20 ms output frames (V).
The prototype:

- ports the fbank front end to TypeScript (mean absolute difference 0.002 in log-mel
  from the reference `lhotse` extractor (M));
- groups IPA tokens into A/E/I/O/U and lip closures;
- takes openness from loudness.

Findings:

- **Accuracy (M):** vowel match 72% across ja/ko/zh/es, without any text or language
  setting. It decodes Japanese and Chinese phone strings close to the native
  reference, for example `okajirinasajtʃoːdoanatanokotoː…` for おかえりなさい…
- **int8 vs fp16 (M):**
  - With identical features, the int8 model in onnxruntime-web loses detail on the
    Chinese clip (aspiration and retroflexes); fp16 matches native onnxruntime
    exactly.
  - Audio-only vowel class scores the same (72%), but int8 leaks slightly more into
    silences (22% vs 18% on English).
  - In the text + ZIPA aligner, int8 misplaced the Chinese laugh, which depends on
    phone density (7 of 8 tags against 8 of 8).
- **Cost (M):**
  - 48–50 ms per audio second on one thread, about 20× real time; 21–22 ms with four
    threads.
  - Session load 0.55–0.63 s (int8) or 0.84 s (fp16), once per app session.
  - Native onnxruntime on one thread took about 8.5 ms per audio second (single run),
    so a desktop-only native path could be about six times cheaper.
- **Size (M):** 70.7 MB int8 (55.9 MB gzip) or 131.6 MB fp16 (119.3 MB gzip). The
  onnxruntime-web runtime (12.3 MB) already ships for Pocket TTS and Parakeet.
- **Limits:** it is not aware of tags on its own, and audio-only openness leaks into
  silences (18–26%) like jaw-from-volume.

Other phone or viseme models found (desk research):

| Model | Size | Licence | Notes |
| --- | --- | --- | --- |
| wav2vec2 `lv-60` / `xlsr-53` espeak CTC | 197–318 MB quantized ONNX (I) | Apache-2.0 (V) | 315M parameters; heavier than ZIPA for the same role |
| Allosaurus | (U) | code GPL-3.0 (V) | excluded |
| POWSM | 1.37 GB checkpoint (I) | CC-BY-4.0 (V) | encoder-decoder, no ONNX |
| SenseVoice-Small | 241 MB int8 ONNX (I) | FunASR Model License v1.1 (V) | word-level timestamps and a Laughter event; outputs text, not phones; ties in with the survey's CJK speech-to-text candidate |
| Rhubarb Lip Sync | 37–42 MB WASM ports (I) | MIT (V) | offline files only; an English recognizer plus a weaker phonetic one |
| wawa-lipsync | 2 KB gzip (I) | MIT (V) | frequency-band heuristics on a media element; real time only |

### 4. Text + audio hybrid (default tier)

Per-language converters turn the spoken text into units: syllables with a vowel,
lip closures, nasals, punctuation pauses and tags. An explicit-duration Viterbi
aligner places the units on 10 ms audio frames using loudness and voicing (peak
autocorrelation for 75–700 Hz). It then renders vowel identity from the text and
openness from the audio.

| Language | Converter in the prototype | Size (gzip) |
| --- | --- | --: |
| Japanese | Kana table (ー, ッ, ン, small ゃゅょ, bilabial onsets); kanji need readings | < 1 KB |
| Korean | Hangul syllable arithmetic (vowel from the medial, closures from ㅁ/ㅂ/ㅍ) | < 1 KB |
| Chinese | `pinyin-pro` 3.29.5 (MIT) finals → vowels | 145 KB, Chinese only |
| Spanish | Spelling rules | < 1 KB |
| English | gruut phonemes from the backend (prototype only) | not measured |
| French, German, Portuguese | not prototyped; spelling-rule modules like TalkingHead's (12–15 KB each per the survey) | (I) |

- **Results (M):**
  - Vowel match 48%; open in silence 0% (English), 4% (other languages) and 8% (tag
    lines); 4 of 8 tags placed.
  - The converters cost under 0.01 ms per audio second. Alignment costs about 3 ms
    per audio second, rising with segment length: 2.8 ms on a 4 s clip and 4.3 ms on
    11–13 s clips. Eleven v3's paragraph chunking makes segments longer than one
    sentence.
- **Limit found:** loudness and voicing cannot always tell a laugh or a breath from
  speech. On the Chinese clip `<gasp>真的吗？太好了！<laugh>…` it slid the sentence
  into the gasp, and the laugh over the next phrase.
- **Unscripted breaths:** TTS voices add breaths at punctuation, for example after
  「本当に？」. Letting pause units absorb quiet, unvoiced sound fixed that case.
- **English still needs a browser converter.** Options are a CMUdict subset plus
  spelling rules (CMUdict is about 2.8 MB raw per the survey (U), so a subset or a
  compact encoding is needed to fit the budget), or the ZIPA pack's audio vowels.

### 5. Tag-aware non-speech events

Tags become units with a prior duration and their own mouth and face. The prototype
used:

- **laugh, chuckle, giggle:** open "A" pulsing with the laugh's loudness, a little
  "I", and the VRM `happy` expression (eyes squint);
- **sigh:** relaxed "O" that closes through the exhale, with `relaxed`;
- **gasp:** quick open "A"/"O";
- **pauses:** mouth closed;
- **`<whispers>`:** the following syllables at 70% amplitude, with no voicing
  requirement.

In the aligner, laughs and breathy tags prefer audible frames with low voicing, or
with low phone density when ZIPA is installed.

**Results (M):** with loudness and voicing, 4 of 8 tags placed (mean IoU 0.49); with
ZIPA fp16 phone density, 8 of 8 (mean IoU 0.66); with ZIPA int8, 7 of 8 (0.59). On
the whisper clip, lower loudness already narrowed the mouth on top of the 70%
scaling. How whispering should look is still an owner choice.

### 3 + 4 + 5. Text aligned on phone posteriors (pack tier)

The same aligner with ZIPA added to its emissions:

- each vowel unit scores how much of that vowel the model hears;
- speech units and laugh, gasp and breath tags are separated by the model's phone
  density (1 − blank over about 200 ms). Density falls to 0.00–0.07 in gasps and
  breaths and 0.05–0.3 in laughs, against 0.3–0.6 in speech (M).

**Results (M):**

- **fp16:** vowel match 78% (93% on the Japanese laugh clip); open in silence 0–10%;
  all 8 tags placed. That includes the Chinese gasp (0.18–0.76 s, against a reference
  gap of 0–0.90 s) and laugh (3.37–3.96 s, against 3.03–3.97 s).
- **int8:** vowel match 77%; open in silence 0–6%; 7 of 8 tags (the Chinese laugh
  landed at 3.96–4.26 s).
- **CPU:** 51–52 ms per audio second, nearly all of it ZIPA.

### 6. Provider timing

Gemini, Pocket TTS and OpenAI realtime return no timing; Pocket gives the total
duration only. ElevenLabs returns character timing (V, documentation only):

- **TTS WebSocket** `stream-input` with `sync_alignment` (Flash v2.5,
  Multilingual v2): times relative to each chunk. It does not accept v3 or v4.
- **Text to Dialogue WebSocket** (v4 Turbo, v3 conversational): `sync_alignment`,
  present only when the model returned timing for the chunk. The API reference and
  the guide disagree about which model families it accepts.
- **`/with-timestamps` HTTP endpoints** (TTS and Text to Dialogue): character start
  and end times. Support for v3 and v4 on the plain TTS endpoint is undocumented (U).
- **Tags in alignment (U):** whether tag characters appear in the alignment, and what
  timing they get, is undocumented and needs the #471 spike.

**Fit:** character timing replaces the audio aligner's job for speech, while the text
converters still supply vowel identity, so it plugs into the same planner. Tags
still need audio evidence unless the spike shows the alignment spans them.
**Verdict:** adopt where #471 makes it available; not measured here.

### 7. Heavy audio-to-face models

- **NVIDIA Audio2Face-3D** (V/I): v3.0 has 180M parameters and a 725 MB
  `network.onnx`; v2.3 Mark is 76 MB. It needs the Audio2Face SDK with TensorRT on
  NVIDIA GPUs, and the models use the NVIDIA Open Model License. It outputs skin,
  tongue and jaw motion for its own characters, not VRM vowels.
- **LAM_Audio2Expression** (V/I): Apache-2.0, 373 MB of weights, ARKit-52 output.

**Verdict:** too heavy and the wrong output format for a browser VRM; no browser path.

## Criteria

| Criterion | Text + audio (default) | Text + ZIPA (pack) | ZIPA audio only | wLipSync | Volume |
| --- | --- | --- | --- | --- | --- |
| Accuracy | Good timing and silences; vowels from text; tags partly placed | Best vowels, silences and tags | Good vowels; leaks into silences; no tags | Weak vowels; no tags | Timing only |
| Languages | Needs a converter and the speech language; kanji need readings | Converter languages, falling back to audio-only phones | Any language, no setting | Any language with a profile | Any |
| Providers | Any provider whose PCM reaches the browser | Same | Same | Same | Same |
| Speed | 3 ms per audio s | 52 ms per audio s, 0.6–0.8 s model load | 49 ms per audio s | 5 ms per audio s | 0.04 ms per audio s |
| Cost | Free | Free | Free | One TTS request per voice to calibrate | Free |
| Download | ~5 KB + English (+145 KB zh) | +56 MB (int8) or +119 MB (fp16) | Same as pack | ~7 KB + profiles | < 1 KB |
| Licence | Own code; pinyin-pro MIT | ZIPA CC-BY-4.0 (attribution) | Same | MIT | Own |
| Fit | Shared web, Electron and self-host worker; five VRM vowels plus `happy`/`relaxed` for tags | Same, with an optional model asset | Same | AudioWorklet or worker | Same |

**No GPL code** is involved in any recommended path. espeak-ng and Allosaurus are
excluded, and none of the measured packages bundles them.

## Streaming and latency

### Providers

- **Pocket TTS:** PCM is produced in the inference worker, faster than real time,
  and can be passed to the lip-sync worker per chunk.
- **Gemini and Eleven v3/v4 finalized:** `tts.audio` PCM frames arrive per sentence
  (Eleven v3 also per paragraph) over `chat:sse`. Gemini delivers audio at about
  2.9× real time after a 0.2 s leading silence (measured in the 2026-10-09 survey).
- **ElevenLabs realtime (v4 Turbo after #471):** audio chunks arrive with optional
  character timing. Use the timing when present and the audio aligner otherwise.
- **Browser `speechSynthesis`:** its audio cannot be captured. Fall back to the text
  converters with estimated durations, anchored to `boundary` events where the voice
  emits them (platform support (U)).

### Progressive alignment (simulated)

A streaming planner must commit mouth frames before the rest of the segment has
arrived. The lab simulated this:

- re-align the units on the audio received so far every 0.25 s, letting the path end
  at any unit;
- commit only frames the playhead is about to reach.

Two arrival models were tried. *Real time* has a 0.3 s buffer, for example a live
stream; *2.9×* is Gemini's measured delivery rate. Results, scored like the
whole-clip table (M):

| Planner | Arrival | Vowel match, ja/ko/zh/es | Open in silence, English / tags | Open frames with the same vowel as whole-clip alignment (median) |
| --- | --- | --: | --: | --: |
| Text + audio | whole clip | 48% | 0% / 8% | — |
| Text + audio | 2.9× | 41% | 0% / 8% | 90% |
| Text + audio | real time, 0.3 s buffer | 30% | 0% / 9% | 51% |
| Text + ZIPA int8 | whole clip | 77% | 0% / 6% | — |
| Text + ZIPA int8 | 2.9× | 75% | 0% / 9% | 96% |
| Text + ZIPA int8 | real time, 0.3 s buffer | 67% | 0% / 3% | 78% |

- **Faster-than-real-time delivery is nearly as good as whole-clip alignment**, so no
  playback delay is needed for Gemini. Finalized ElevenLabs and Pocket also deliver
  faster than real time, but their rates were not measured here (U). Live streams
  lose accuracy unless the playback buffer grows or provider timing is available.
- **The simulation's CPU is an upper bound:** it re-aligned from the start of the
  segment and re-ran ZIPA on the whole prefix each time. That cost 21–102 ms
  (text + audio) and 480–1,520 ms (text + ZIPA) per audio second (M, Node). A
  shipped planner needs windowed re-alignment and chunked ZIPA inference, whose
  accuracy and cost are **not measured**.
- **First-chunk cost (M):** aligning a sentence against its first second of audio
  took 2.1 ms (text + audio) and 51–57 ms (text + ZIPA) in a worker. Gemini's leading
  silence alone is 200 ms.

## Recommendation

### Design

Replace the gruut planner with a browser lip-sync worker shared by web, Electron
and self-host:

1. **Tag parser:** split the spoken text into text spans and neutral tags.
2. **Converters:** text spans → units, chosen by the Anima's speech language (#385).
   Ship Japanese kana, Korean, Chinese (lazy `pinyin-pro`), Spanish and English
   first; French, German and Portuguese rules next.
3. **Evidence per TTS segment:**
   - loudness and voicing from the segment's PCM;
   - ZIPA phone posteriors when the pack is installed;
   - provider character timing when the provider returns it.
4. **Aligner:** explicit-duration alignment of units to the segment's audio,
   progressive as audio arrives. Each segment anchors to its own audio start, so
   errors never accumulate across a reply.
5. **Renderer:**
   - `vowel5` frames for the existing bridge and `ExpressionController`;
   - expression events for laughs, sighs and gasps;
   - the speech gesture timeline for talking hands, with word timings from the
     aligned units and beats from stressed syllables (English stress from the
     converter) or loudness peaks.
6. **Fallbacks:** with no usable text or converter, ZIPA audio-only if installed,
   otherwise jaw-from-volume. With no audio (browser speech), a text estimate.

### Migration path

1. **Stop gating TTS on gruut.** Prepare TTS segments from the speech text in any
   language, so Gemini and ElevenLabs speak Japanese, Korean and Chinese sentences.
   Keep gruut phonemes for English while the old planner remains.
2. **Ship the browser planner (default tier)** behind the existing bridge. It reads
   the speech text and the decoded PCM instead of `tts_phonemized_text` and the
   rescale, and emits the talking-hands timeline. During this step English keeps
   gruut phonemes as its converter input.
3. **Add an English converter in the browser** and size it. Then remove gruut and
   every consumer listed under [verified gaps](#current-pipeline-verified-gaps):
   - the backend calls and the desktop runtime self-check;
   - the SSE fields (a `local-http` contract change under the package-set version
     rules);
   - the `gruut_text_with_ws` text basis.
4. **Optional pack:** add ZIPA small as a verified model asset through the existing
   model-download path, with CC-BY attribution in the third-party notices.
5. **Provider timing:** when #471 delivers ElevenLabs v4 alignment, feed it to the
   aligner as evidence.

### Vocal tags from prompt to audio

- **Prompt:** replace the three "no bracketed audio tags" rules with a per-provider
  rule. When the selected TTS provider supports tags (Gemini; ElevenLabs v3/v4), the
  prompt lists a small neutral vocabulary the model may use in `speech`, for example
  `<laugh>`, `<chuckle>`, `<sigh>`, `<gasp>`, `<whispers>`, `<short pause>` and
  `<long pause>`. Otherwise the ban stays.
- **TTS request:** the backend maps neutral tags to each provider's syntax.
  - Gemini takes them as written; angle brackets are its documented form (V).
  - ElevenLabs uses square-bracket tags such as `[laughs]`, `[sighs]` and
    `[whispers]` (V). Pauses map to punctuation, because v3/v4 have no SSML breaks.
    The exact mapping needs the #471 spike.
  - Pocket TTS and browser speech get the text with tags removed.
- **Visible text:** chat shows the speech without tags. The owner may prefer a
  subtle laugh or sigh marker.
- **Lip-sync:** receives the speech text with neutral tags, and the provider. A tag
  the provider ignored finds no matching audio and costs nothing.

### Japanese kanji readings

Converters need kana for kanji. Options, cheapest first:

1. **LLM-supplied readings:** the structured response adds a kana reading for
   Japanese speech. No download; accuracy depends on the chat model (U).
2. **ZIPA pack:** phone posteriors give vowel identity without readings. Kanji
   without a reading can become unknown-vowel units in the aligner.
3. **Dictionary pack (I):** `kuromoji.js` (Apache-2.0, 17.8 MB gzip dictionary, last
   published 2018) or Lindera WASM with IPADIC (MIT, 17.75 MB).

## Owner decisions

1. **Direction:**
   - **A:** default tier only (text + audio, no download).
   - **B (recommended):** default tier plus the optional ZIPA pack.
   - **C:** require the ZIPA pack everywhere.
2. **Download budget:** proposed ≤ 200 KB gzip of lip-sync code in the default bundle
   (English converter included), and ≤ 125 MB for the optional pack. Should the
   desktop app download the pack by default?
3. **Model precision:**
   - fp16 (119 MB): 78% vowel match and 8 of 8 tags.
   - int8 (56 MB): 77% and 7 of 8; it decodes finer phones worse in onnxruntime-web.
   - Proposed: fp16 for the pack, revisiting int8 if a newer onnxruntime-web closes
     the gap.
4. **Visible tags:** hide tags in chat, or show a small marker?
5. **Kanji readings:** LLM-supplied readings first, or a dictionary pack?
6. **Expressions for tags:** confirm laugh → `happy` and sigh → `relaxed`, and choose
   one for gasp (for example `surprised`).
7. **Whispering:** confirm narrower mouth shapes with no extra expression.

## Draft spec outline (for `to-spec`)

**Desired outcome:** the avatar's mouth follows the TTS audio actually spoken, in
every supported language, with laughs, sighs, gasps, whispers and pauses shown
instead of read, and with no per-request cost.

**Goals and non-goals:**

- **Goals:** language-aware, tag-aware, audio-aligned lip-sync for every TTS
  provider; every sentence spoken in every language; gruut removed.
- **Non-goals:** choosing TTS or STT models, UI translation (#385), multi-speaker
  dialogue, ARKit-52 or tongue animation, and the ElevenLabs v4 migration itself
  (#471).

**Requirements:**

- **R1:** Every speech sentence reaches the selected TTS provider whatever its
  language; no phoneme step gates TTS.
- **R2:** Lip-sync is planned in the browser per TTS segment, from the speech text,
  the Anima's speech language and the segment's audio. Each segment anchors to its
  own audio start; there is no whole-reply rescale.
- **R3:** Converters cover en, ja, ko, zh and es first, then fr, de and pt. A
  language without a converter falls back to audio-only shapes.
- **R4:** Providers that support vocal tags may receive them:
  - the prompt allows a neutral tag vocabulary only for those providers;
  - the backend maps it to each provider's syntax;
  - tags are removed for other providers and from visible text;
  - no tag is phonemized as a word.
- **R5:** Tags produce non-speech mouth events and optional expressions (laugh,
  sigh, gasp). Pauses close the mouth, and whispers narrow it.
- **R6:** Talking hands keep word timings and beats from the new planner.
- **R7:** An optional phone-model pack (ZIPA small) is downloaded, verified and used
  when installed. Lip-sync works without it.
- **R8:** Provider character timing (ElevenLabs, #471) is used when present.
- **R9:** Fallbacks: without capturable audio (browser `speechSynthesis`), lip-sync
  uses text estimates; without text or a converter, it uses audio-only shapes.
- **R10:** gruut, its SSE fields and its text basis are removed once English has a
  browser converter, with contract versioning and a smaller desktop runtime.

**Constraints:**

- **Performance:** the default tier stays ≤ 5 ms CPU per audio second, and the pack
  tier ≤ 60 ms, on one worker thread on the reference Mac, including progressive
  re-alignment. No delay is added before first audio, and the bundle stays within the
  agreed budget.
- **Licence:** no GPL code in the app process; CC-BY attribution for ZIPA.
- **Privacy:** all analysis runs locally; no audio or text goes to a new service.
- **Compatibility:** the bridge and `ExpressionController` keep the `vowel5`
  contract; hosted compositions keep working without the pack.

**Acceptance (proposed):**

- On this brief's fixed test set (or a successor that adds an anime-pitched voice
  and a held-out set), scored with the same metrics and **progressive** alignment at
  each provider's delivery rate:
  - open in silence ≤ 10% on English and tag lines;
  - vowel match ≥ 40% (default tier) and ≥ 70% (pack tier) on ja/ko/zh/es for
    providers that deliver faster than real time; live streams without provider
    timing are reported, not gated;
  - tags placed ≥ 6 of 8 with the pack.
- Japanese, Korean and Chinese replies are spoken by Gemini and ElevenLabs, shown end
  to end in a running stack.
- Talking hands still gesture on speech beats in English and in at least one other
  language.
- Unit tests cover the converters, the tag parser and mapping, and the aligner on
  recorded fixtures. `pnpm check`, `pnpm web:test`, backend tests and
  `make check-test` pass.
- **Owner gate:** a side-by-side review of the new lip-sync against today's, on a
  laugh, a sigh or pause, and a ja/ko/zh line.

**Open questions:** the owner decisions above; windowed re-alignment and chunked ZIPA
accuracy (a spike before the ExecPlan); ElevenLabs tag and alignment behaviour
(#471 spike).

**Dependencies:** a per-Anima speech language (#385 or a smaller prerequisite);
#471 for ElevenLabs v4 timing and tags.

## Sources

| Key | Source |
| --- | --- |
| Gemini TTS tags | https://ai.google.dev/gemini-api/docs/speech-generation |
| ElevenLabs tags | https://elevenlabs.io/docs/best-practices/prompting |
| ElevenLabs timing | https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps, https://elevenlabs.io/docs/api-reference/text-to-dialogue/ttd-websocket, https://elevenlabs.io/docs/eleven-api/guides/how-to/websockets/tts-vs-ttd-websockets |
| wLipSync, uLipSync | https://github.com/mrxz/wLipSync, https://github.com/hecomi/uLipSync |
| ZIPA | https://github.com/lingjzhu/zipa, https://huggingface.co/anyspeech/zipa-small-crctc-300k, https://aclanthology.org/2025.acl-long.961/ |
| MMS forced alignment | https://docs.pytorch.org/audio/main/generated/torchaudio.pipelines.MMS_FA.html |
| gruut | https://github.com/rhasspy/gruut |
| pinyin-pro | https://github.com/zh-lx/pinyin-pro |
| Audio2Face-3D | https://github.com/NVIDIA/Audio2Face-3D, https://huggingface.co/nvidia/Audio2Face-3D-v3.0 |
| LAM_Audio2Expression | https://github.com/aigc3d/LAM_Audio2Expression |
| Rhubarb, wawa-lipsync | https://github.com/DanielSWolf/rhubarb-lip-sync, https://github.com/wass08/wawa-lipsync |
| SenseVoice | https://github.com/FunAudioLLM/SenseVoice |
| Japanese readings | https://github.com/takuyaa/kuromoji.js, https://github.com/lindera/lindera, https://pypi.org/project/pyopenjtalk-plus/ |
