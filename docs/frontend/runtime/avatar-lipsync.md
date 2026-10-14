# Avatar Lip-Sync Pipeline (`src/frontend/web`)

Lip-sync plans each spoken reply's mouth from the audio the avatar plays and the
text sent to the voice, and drives the avatar's VRM vowel expressions on the
audio clock. The same plan supplies tag expressions (a laugh, a sigh) and the
talking-hands beats. It shares timing with [Voice](voice.md) and the
[Avatar runtime](avatar-animation.md).

## 1) Architecture

1. **Speech runtimes report what they play.**
   `lib/speech/speech-pcm-tap.ts` is a provider-neutral tap:
   - ElevenLabs, Gemini and Pocket hand it every PCM chunk they pass to
     playback, in order, with silence for any gap they schedule;
   - a Gemini chunk that starts a speech part carries the part's text;
   - players report where playback resumed after an underrun;
   - browser speech, whose audio cannot be captured, reports when each
     utterance starts and ends and, where the voice says, each word.
2. **The text reaches the planner.** `useTtsPlayback` reports the text a run's
   voice speaks so far (`onSpeechText`). `useChatSession` forwards it to the
   bridge's `setSpeechText`.
3. **The run manager** (`lib/lipsync/lipsync-runs.ts`) starts a worker run with
   each run's first audio and forwards its text, audio, provider timing and the
   end of its audio. A change of provider mid-run (ElevenLabs falling back to
   Pocket) restarts planning.
4. **The lip-sync worker** (`workers/lipsync-worker.ts`) plans each run off the
   main thread:
   - `lib/lipsync/run-planner.ts` for runs with audio;
   - `lib/lipsync/estimate-run.ts` for browser speech.
5. **The bridge** (`stores/avatar-lipsync-bridge-store.ts`) turns plans into a
   `vowel5` segment on the playback clock (`lib/lipsync/planned-segment.ts`),
   starts it when the avatar is talking, and revises it in place as plans
   arrive. It also keeps the tag events and gesture timeline.
6. **The avatar** (`lib/avatar/ExpressionController.ts`) samples the segment by
   `AudioContext.currentTime` and applies the VRM vowel expressions.

## 2) Text and audio per provider

| Provider   | Text                                                     | Audio                                                     | Timing                     |
| ---------- | -------------------------------------------------------- | --------------------------------------------------------- | -------------------------- |
| ElevenLabs | Each chunk sent to the socket, as it is sent             | Each received frame (`handleAudioChunk`)                  | Character timing           |
| Gemini     | Each speech part's text, from its first `tts.audio` frame | Each scheduled chunk, with silence for late chunks        | None                       |
| Pocket     | Each chunk, spelled out as Pocket speaks it              | Each buffer the player plays (`player.playAudio`)         | None                       |
| Browser    | Each utterance's text                                    | None: an estimate from the text                           | Utterance and word starts  |

- **Gemini parts.** The backend speaks a Gemini reply in batches, one request
  each. The first `tts.audio` frame of each batch carries `part_text` (see
  [voice and speech](../../backend/integrations/voice-and-speech.md)). The
  planner fits each part's words to that part's own audio, so a sigh or laugh
  that looks like speech cannot use up the next part's words. A reply without
  parts (an older server) is planned from its growing text instead.
- **ElevenLabs timing** is on the run clock (see
  [ElevenLabs TTS](elevenlabs-tts.md#provider-character-timing)); it bounds
  where each word and tag can sit.
- **Browser speech** runs on a performance clock
  (`lib/speech/performance-clock.ts`, shaped like an `AudioContext`). Each
  utterance's units start where the voice started it, at an average speaking
  rate. Reported word starts re-anchor them, and an utterance that has ended is
  fitted to end with it.

## 3) Planning

The planner (`lib/lipsync/planner.ts`) turns text into units: syllables, Han,
kana and Hangul characters, pauses, and tags. It aligns them to the audio's
loudness, voicing and pitch, then renders 60 FPS `A/E/I/O/U` weights whose
opening follows the loudness. The worker loads the English pronunciation
dictionary before its first plan, and the Chinese readings (a separate chunk
of about 140 KB gzip) the first time a run's text has Han characters read as
Chinese.

- **Progressive.** A run is replanned every 0.25 s of new audio, and once more
  when its audio and text are complete. Units placed two seconds behind the
  newest audio are kept, so each plan re-aligns only recent audio. Each update
  carries the frames from the first one that changed.
- **Fallbacks.** The plan says why the mouth follows the audio alone:
  - `no_text`: the text has only symbols or punctuation;
  - `no_alignment`: the text cannot fit the audio (logged once per run);
  - `planner_failed`: planning threw. The rest of the run follows the audio
    alone, the error is logged once, and speech plays on.

  An error outside planning, such as in the audio analysis, ends the run's
  plans: the mouth keeps the frames planned so far, then rests. If the worker
  itself fails, runs in flight do the same, and later runs start a fresh
  worker.
- **Cost.** The update reports CPU per second of audio, audio analysis
  included (`plannerStatsByRun`). Rendering, loudness levels and gesture timing cover
  the whole run on every plan, so their cost grows with the reply's length, as
  does the bridge's rebuild of the segment on each update.

## 4) Clock

- **Start.** `audioStartSec` is the context time of the run's first sample.
  Players that use the PCM worklet (ElevenLabs, Pocket) take it from the
  worklet's own clock. Gemini schedules buffers itself and uses the first
  buffer's start time.
- **Underruns.** When the worklet runs dry it plays silence while the context
  clock runs on. On resuming it reports the samples played so far and the
  context time (`playback-resumed`). The bridge keeps these anchors
  (`playbackAnchorsByRun`), closes the mouth through each gap, and delays what
  follows.
- **Gemini gaps.** A chunk that arrives late starts after a silent gap. The
  runtime taps silence for the gap, so the run clock stays the playback clock.

## 5) Avatar lip-sync bridge

Per run, the bridge keeps:

- the playing segment (`segmentsByRun`), rebuilt from the merged plan frames;
- tag events (`lipSyncEventsByRun`) and the gesture timeline with its phrases
  (`speechGestureTimelinesByRun`);
- playback start, resolved duration and underrun anchors;
- provider character timing (`providerSpeechTimingByRun`);
- the run's complete speech text and planner stats, for the debug view.

`markSpeechAudioDurationResolved` also tells the planner the run's audio has
ended.

### Starting and revising

`tickGate`, called from `AvatarCanvasActor`'s frame loop, starts a run's
segment only when:

- a live avatar instance is registered;
- the run has a segment and a playback start;
- the avatar is `talking`;
- the run has not already started.

Once a run has started, each new plan replaces its frames from the first changed
one (`replaceLipSyncFrames`). The mouth keeps playing without restarting.

### Tag expressions

`tickTagOverlays` shows a brief expression while a tag sounds: a laugh `happy`
0.8, a sigh `relaxed` 0.6, a gasp `surprised` 0.7. It applies them through
`setExpressionOverlay("lipsync-tags", …)` and clears them at the run's end or a
reset. Overlays ramp in over 0.15 s and out over 0.3 s, so a tag a progressive
plan shows only briefly barely registers.

Both Included Avatars set `overrideMouth` to `none`. Avatar A declares it on
its VRM 1 expressions, and three-vrm imports Avatar Y's VRM 0 expressions with
`none`. So the overlays never suppress the mouth, and the vowel shapes add to
the expression's own mouth shape.

### Talking hands

`getSpeechTimingContext` gives the procedural layers the run's elapsed time and
duration, and the planner's gesture timeline. The phrases stand in for the TTS
chunks the talking-hands layer schedules gestures by: one chunk per phrase,
with its word range. A phrase that ends with an exclamation mark uses both
hands.

Beats fall on prominent syllables, found in the audio. Where the text marks
stress (English), it decides between close candidates. Words not heard yet are
placed at the speaking rate after the audio so far, with provisional beats from
stress and length, so a gesture can start about 0.5 s before its beat even when
audio arrives just ahead of playback. Each plan replaces them with beats from
the audio as it arrives.

### Picture-in-picture

The desktop picture-in-picture window receives segments, tag events, underrun
anchors and gesture timelines with their phrases in its visual state. A run
already playing there takes revised segments, so its mouth and hands follow the
main view.

## 6) `vowel5` segments and playback

Files:

- `src/frontend/web/src/lib/lipsync/planned-segment.ts`
- `src/frontend/web/src/lib/avatar/types.ts`
- `src/frontend/web/src/lib/avatar/ExpressionController.ts`

Frames use `format: "vowel5"`, values `[A, E, I, O, U]` at `time_sec` on the
playback clock. The avatar samples by audio time: it reads
`AudioContext.currentTime`, computes `t = now - audioStartSec` and interpolates
between frames. Rendering above 60 FPS only samples more smoothly.

On load, the expression controller logs the VRM's expressions and resolves the
vowel channels. Names are matched case-insensitively, in these styles:

- `A/E/I/O/U`;
- `aa/ee/ih/oh/ou`, the common VRM style;
- fallbacks such as `ii`, `oo` and `uu`.

## 7) Start and end semantics

- **Start.** `TTSPlayback / Playback / Audio started`, then the avatar's state
  update to `talking`. The segment starts at the next frame once both have
  happened.
- **End.** The bridge clears a run when its audio ends:
  - the provider's raw playback-ended signal (`onPlaybackEndedSignal`)
    hard-stops lip-sync immediately;
  - `TTS / Audio ended` comes later, gated on run completion;
  - clearing a run ends its worker run and clears its tag overlay.

## 8) Debugging checklist

1. **Audio reaches the tap.** In the debug panel's Lip-sync view, the run shows
   audio being captured.
2. **Text is complete.** The view's plans need the run's final text (Gemini:
   its parts).
3. **Plans arrive.** Check `plannerStatsByRun` (CPU and fallback). Logs name
   `no_alignment` and planner failures once per run.
4. **The run started.** Look for `audioStartSec` and the `talking` gate.
5. **Clock.** Underruns appear as `playbackAnchorsByRun` entries; a mouth that
   runs ahead after a stall points here.

### Comparing plans in the debug panel

In a development build with `VITE_ENABLE_DEBUG_PANEL=true`, the Anima debug
panel's **Lip-sync** section shows the latest spoken reply from ElevenLabs,
Gemini or Pocket. For that reply it shows:

- its audio envelope;
- its timing evidence: words, punctuation and tags;
- the live planner's CPU per second of audio and any fallback;
- one mouth-openness curve per plan source, each the current planner
  replanning the captured reply in the worker with one combination of evidence,
  and its CPU:
  - "Text and audio": the text and the audio alone, as Gemini and Pocket replies
    are planned;
  - "With provider timing": with the provider's character timing too
    (ElevenLabs); absent when the reply has none.

  The audio arrives all at once, so a plan can differ slightly from the live
  one.

**Replay** plays the captured audio through its own `AudioContext` and drives
the avatar with that plan (`playReplaySegment`, under a replay run id), so plans
can be compared by eye and ear.

- Plans are built, and Replay is enabled, only once the captured reply has
  finished playing.
- Replay cannot start while any reply is speaking. A reply that starts
  speaking during a replay ends it.
- A capped capture is drawn and replayed on the 90 s it kept.

Capture and capture files:

- **Capture.** `SceneDebugPanel` starts the capture while the panel is enabled,
  whether or not it is open. `stores/lipsync-debug-store.ts` listens to the PCM
  tap, keeps only the latest run (capped at 90 s), copies its text, timing and
  planner stats from the bridge, and clears with the session.
- **Load capture** (development only) shows a capture file in the view instead,
  so the test lines with laughs, sighs and pauses can be compared without
  speaking them. Make capture files from the evaluation clips with
  `pnpm --dir src/frontend/web lipsync:captures --clips "$CLIPS" --out "$DIR"`.
  They hold audio, so `$DIR` must be outside the repository.
- **Plan sources** are listed in `lib/speech/lipsync-plan-sources.ts`. Another
  planner registers with `registerLipSyncPlanSource({id, label, build})`; the
  view needs no change.

## 9) Known limitations

1. **Untimed speech with voiced sighs or laughs can run ahead within a part.**
   Loudness and voicing cannot tell a voiced sigh from words, so a progressive
   plan may spend words on it. Gemini parts bound this to one part. Pocket
   replies and ElevenLabs without timing are one part, so the error can carry
   further. ElevenLabs is untimed only on hosted Animama until its timing ships.
2. **Browser speech is an estimate.** Voices that report no word boundaries
   place words at an average rate between utterance starts and ends.
3. **A worker failure mid-run** leaves that run's mouth at rest for the rest of
   the run.
4. **`TTS / Audio ended` is not raw playback end.** Use the raw playback-ended
   signal when debugging end-of-audio alignment.

## 10) Evaluating lip-sync offline

`pnpm --dir src/frontend/web lipsync:eval` scores lip-sync plan sources against
recorded speech, with no network or paid speech. It reports, per clip set:

- how often the mouth is open on spoken vowels;
- for progressive runs, word drift: how far words start from where planning the
  whole clip at once puts them, which shows a plan running ahead of or behind
  the speech (the mouth still opens with loudness when it does);
- vowel match in Japanese, Korean and Chinese (and with Spanish);
- how often the mouth is open in silent gaps, for English lines and tag lines;
- how many laughs, sighs, gasps and pauses are placed;
- planning CPU per second of audio.

Each source runs as the audio would arrive: the whole clip at once (`whole`), 2.9×
faster than real time like Gemini (`faster`), or in real time behind a 0.3 s
playback buffer (`live`). Sources live in `src/lib/lipsync/eval/sources.ts`; the
fixtures and how to rebuild them are described in
[`scripts/lipsync/README.md`](../../../scripts/lipsync/README.md).

- `aligned`: the planner the app uses, which re-aligns only the newest audio as
  it arrives.
- `aligned-full` (opt-in, `--source aligned-full`): the same planner re-aligning
  everything on every step, a reference for the windowed planner's accuracy and
  cost.

`src/lib/lipsync/eval/aligned-thresholds.test.ts` holds `aligned` to the agreed
thresholds at each provider's delivery rate. It also bounds progressive plans'
word drift and vowel opening against whole-clip plans. These bounds apply on
every set and on multi-sentence replies joined from clips, in parts as Gemini
speaks them or as one part. It also checks that English beats fall on stressed
syllables, using readings recorded from gruut before its removal. A tuning
change that breaks one fails `pnpm web:test`.
