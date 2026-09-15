# ElevenLabs TTS Guide

This document describes the browser-side ElevenLabs TTS runtimes in
`src/frontend/web`: direct realtime websocket speech for Flash/Multilingual
models and finalized-text `chat:sse` audio push for Eleven v3.

## Runtime Model

ElevenLabs is one of the supported TTS providers alongside browser speech
synthesis and PocketTTS. The main runtime files are:

- `src/frontend/web/src/hooks/use-tts-playback.ts`
- `src/frontend/web/src/hooks/use-elevenlabs-tts-runtime.ts`
- `src/frontend/web/src/hooks/use-elevenlabs-finalized-tts-runtime.ts`
- `src/frontend/web/src/ui/main/chat/useChatSession.ts`
- `src/frontend/web/src/stores/avatar-lipsync-bridge-store.ts`

Provider selection is stored as `"browser" | "pocket_tts" | "elevenlabs"`.
ElevenLabs model selection is stored as `tts_elevenlabs_model_id`. The Eleven
v3 finalized-audio grouping preference is stored as
`tts_elevenlabs_v3_finalized_chunking` with `"sentence"` as the default and
`"paragraph"` as the opt-in smoother long-form mode.

## Realtime Models

Realtime values are `eleven_flash_v2_5` and `eleven_multilingual_v2`.
`eleven_flash_v2_5` is the frontend default.

For realtime chat turns, `useChatSession.ts` sends explicit TTS intent in
`dispatch_options.tts`. `chat:sse` resolves the ElevenLabs realtime session and
emits `tts.session`. The frontend then opens a direct ElevenLabs websocket
using the short-lived token from that SSE event.

The `tts.session` event includes the selected voice, model, output format,
transport, and `sync_alignment`. `sync_alignment` remains `false`; Anima does
not request ElevenLabs timing metadata for realtime speech.
The backend validates ElevenLabs voice accessibility when a voice profile is
saved and keeps a short process-local runtime cache. Realtime chat still
resolves the selected voice and mints a single-use websocket token per run, but
it does not perform a fresh ElevenLabs `voices.get` call when the cache says the
voice was recently valid.

If session setup fails, `chat:sse` emits `tts.session.error` and continues
streaming assistant text. The frontend marks TTS skipped for that run.

## Eleven v3 Finalized Streaming

`eleven_v3` is not a realtime websocket model. For v3, `chat:sse` does not emit
`tts.session`. The backend uses the prepared main-structured speech text and
pushes finalized audio over the same chat SSE stream.

For main-structured TTS speech, `user.response` can include additive TTS
fields:

- `tts_text`
- `tts_phonemized_text`
- `tts_text_basis: "gruut_text_with_ws"`

All ElevenLabs chat models prefer `tts_text` over visible speech text when
`tts_text_basis` is `gruut_text_with_ws`. Realtime models send that text to the
direct websocket; Eleven v3 sends that text from the backend to ElevenLabs.

For structured speech streaming, `useChatSession.ts` sends each speech delta
into the existing TTS pipeline as it arrives. Realtime ElevenLabs models keep
one browser websocket per chat run; ordered websocket text frames provide
continuity, and completion still sends the terminal empty-text frame through
the existing runtime.

For Eleven v3 sentence grouping, the backend trusts each sentence `tts_text` as
already prepared by gruut and sends one finalized request per sentence. For
paragraph grouping, the backend keeps the same sentence-level `user.response`
events, joins visible sentence text into paragraph batches, and re-prepares
each paragraph through gruut before sending it to ElevenLabs. Paragraph batches
flush when a new paragraph starts, at four sentence segments, at about 600
visible characters, or when the speech stream closes. Before each paragraph
batch after the first, the backend inserts a 400 ms silent PCM `tts.audio` frame
so adjacent paragraph utterances have a natural gap. The ElevenLabs call uses
`model_id="eleven_v3"`, `output_format="pcm_24000"`, and
`apply_text_normalization="off"`. The backend omits `previous_text`,
`next_text`, and request-id continuity fields because the live ElevenLabs v3 API
rejects or does not support those continuity fields.
For v3, the backend resolves and validates the selected voice at most once per
chat run, then reuses the resolved `voice_id` for later sentence or paragraph
batches so per-batch voice validation is not in the streamed audio path.

Voice-structured responses also contain internal `emotional_tone` and
`emotional_intensity` fields before `speech`. The backend filters those fields
out of frontend `user.response` events. Normal `chat:sse` uses them to compute
and persist the full-state `emotion.update`; the frontend still uses that
event's `emotions` array as the avatar source of truth. For `eleven_v3` only,
the backend may also map the tone to an allowlisted ElevenLabs audio tag and
prefix only the text sent upstream to ElevenLabs. Sentence grouping prefixes
only the first upstream request; paragraph grouping prefixes every paragraph
batch. The visible `speech`, persisted messages, `tts_text`,
`tts_phonemized_text`, avatar lip-sync inputs, realtime ElevenLabs websocket
text, PocketTTS text, and browser TTS text remain untagged. Missing, blank, or
unrecognized tone metadata is handled in the backend with a warning and does
not create a frontend-visible error. Neutral, missing, blank, or unrecognized
tone metadata uses the backend-only `[friendly]` Eleven v3 provider prefix and
emits a no-op emotion update.

The backend uses ElevenLabs' plain streaming TTS API, not the timestamp API.
`chat:sse` audio events include:

- `type: "tts.audio"`
- `run_id`
- `model_id`
- `output_format`
- `audio_base64`

The stream ends with `type: "tts.done"`. If upstream streaming fails, Anima
emits `type: "tts.error"` with
`code: "elevenlabs_stream_failed"`.
Sentence and paragraph grouping use the same `tts.audio`, `tts.done`, and
`tts.error` event names and payload shape; no paragraph-specific fields are
added to public SSE events. The paragraph pause is represented as ordinary
silent PCM in a `tts.audio` event rather than as separate timing metadata.

The frontend decodes each v3 `pcm_24000` SSE audio frame into `Int16Array`
samples, converts those samples to normalized `Float32Array` audio, creates
24 kHz `AudioBuffer` objects, and schedules them with `AudioBufferSourceNode`
through a normal `GainNode`. The backend coalesces upstream PCM bytes before
emitting `tts.audio` frames so the frontend schedules fewer, larger buffers.
This finalized-v3 path bypasses the shared PCM worklet used by realtime
streaming models and lets the browser's Web Audio engine resample to the output
device rate.

When a finalized Eleven v3 run starts, the frontend prewarms the local
`AudioContext` and gain node before the first `tts.audio` frame arrives. The
audio frames still come from `chat:sse`; prewarming only reduces local playback
startup work.

## Avatar Timing

ElevenLabs audio uses the same avatar timing callbacks as the other TTS
providers:

- `onAudioStarted`
- `onAudioDurationResolved`
- `onPlaybackEndedSignal`
- `onAudioEnded`

The avatar lip-sync bridge uses gruut phonemes from SSE and the actual played
audio duration to build or recompute vowel viseme timing. For structured speech
streaming, `useChatSession` accumulates the `tts_phonemized_text` from every
speech segment that is sent to TTS, so the final run-level duration correction
uses the same text basis as the spoken audio. Lip-sync timing comes from those
phonemes and playback callbacks, not ElevenLabs alignment metadata.

## Settings

When ElevenLabs is selected, application speech settings expose a model selector.
`Flash v2.5` persists `eleven_flash_v2_5`; `Multilingual v2` persists
`eleven_multilingual_v2`; `Eleven v3` persists `eleven_v3`.

When `Eleven v3` is selected, the "Stream chunked TTS" switch is shown unchecked
and disabled because v3 uses backend-pushed finalized audio instead of frontend
text-token chunking. The saved `tts_stream_chunks` preference is not
overwritten, so switching back to Flash or Multilingual restores the previous
effective chunked behavior.

When `Eleven v3` is selected, application speech settings also show an `Audio
grouping` control. `Sentence` persists
`tts_elevenlabs_v3_finalized_chunking="sentence"` and starts audio as soon as
each sentence batch is ready. `Paragraph` persists
`tts_elevenlabs_v3_finalized_chunking="paragraph"` and waits for paragraph or
safety batches to trade first-audio latency for smoother long-form delivery.
Switching away from `Eleven v3` hides this control without changing the saved
grouping value.

Anima voice selection is resolved from
`speech.elevenlabs.primary_voice`. Legacy saved
`speech.elevenlabs.variants` maps are ignored.
