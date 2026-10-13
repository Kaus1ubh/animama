# ElevenLabs TTS Guide

This document describes the browser-side ElevenLabs TTS runtimes in
`src/frontend/web`: admitted realtime websocket speech for Eleven v4 Turbo and
finalized-text `chat:sse` audio push for Eleven v4.

## Runtime Model

ElevenLabs is one of the supported TTS providers alongside browser speech
synthesis and PocketTTS. The main runtime files are:

- `src/frontend/web/src/hooks/use-tts-playback.ts`
- `src/frontend/web/src/hooks/use-elevenlabs-tts-runtime.ts`
- `src/frontend/web/src/hooks/use-elevenlabs-finalized-tts-runtime.ts`
- `src/frontend/web/src/ui/main/chat/useChatSession.ts`
- `src/frontend/web/src/stores/avatar-lipsync-bridge-store.ts`

Provider selection is stored as `"browser" | "pocket_tts" | "elevenlabs" | "gemini"`
([Gemini TTS](gemini-tts.md)).
ElevenLabs model selection is stored as `tts_elevenlabs_model_id`. Saved
retired ids read as their replacement: Flash v2.5 and Multilingual v2 as
`eleven_v4_turbo`, and `eleven_v3` as `eleven_v4`. The finalized-audio grouping
preference keeps its original key, `tts_elevenlabs_v3_finalized_chunking`.
`"paragraph"` is the settings default and `"sentence"` the faster-starting
choice; the backend uses `"sentence"` when a request names no grouping.

## Realtime Model

The realtime model is `eleven_v4_turbo`, the frontend and server default. It
speaks only on ElevenLabs' Text to Dialogue WebSocket
(`/v1/text-to-dialogue/stream-input`); the Text to Speech socket rejects v4.
Saved `eleven_flash_v2_5` and `eleven_multilingual_v2` preferences read as
`eleven_v4_turbo` (`toElevenLabsTtsModelId`), and the chat request contract maps
the same retired ids, so a tab opened before an upgrade still gets its reply.

For realtime chat turns, `useChatSession.ts` sends explicit TTS intent in
`dispatch_options.tts`. `chat:sse` resolves the ElevenLabs realtime session and
emits `tts.session`. The local composition opens a direct ElevenLabs websocket
using the short-lived token from that SSE event when provider connection authority
is available. A hosted consumer instead sends `transport: "server"` and
`websocket_url`, a path under `/v1/` on the admitted application origin. The browser
uses its session cookie, accepts no URL credentials, query or fragment, and never
falls back to a provider socket. The consumer must bind the stream to its admitted
run, validate the current session and Origin, reserve bounded speech work and
settle usage/cancellation. Frontend fixture success does not establish that server
boundary or real speech delivery.

The `tts.session` event includes the selected voice, model, output format,
transport, and `sync_alignment`. Local sessions set `sync_alignment: true`, so
ElevenLabs returns character timing with the audio; the browser does not use it
yet.

The direct socket protocol (`use-elevenlabs-tts-runtime.ts`):

- The URL carries `model_id`, `output_format`, `sync_alignment`, an optional
  `language_code` and the single-use token. The voice is not in the path.
- The first message registers the voice: `{"voices": [voice_id]}`.
- Each text chunk is sent as `{"inputs": [{"text": "<chunk> ", "voice_id": ...}]}`.
  The runtime restores the separating space that the chunker trims.
- After the run's first chunk the runtime sends one `{"flush": true}`. A short
  first sentence then starts speaking without waiting for the provider's
  buffer of about 40 characters and 8 words. Later chunks are not flushed, so
  the rest of the reply stays in one prosody turn.
- ElevenLabs closes a socket after 20 s without a client message. The runtime
  sends `{"keep_alive": true}` after 10 s without one, until the reply's text
  ends.
- Completion sends `{"close_socket": true}`, and the run ends on
  `{"is_final": true}`. A `{message, error, code}` message ends that reply's
  speech with the usual notice.
- Each open socket holds an ElevenLabs dialogue session, so cancel, a
  superseding run and stop close it at once.

The hosted server transport keeps the frames its consumer validates:
`{"text": " "}` on open, `{"text": chunk}` per chunk, and `{"text": ""}` at the
end, with no flush or keep-alive frames. It ends on `isFinal` or `is_final`.

Loadout → Voices saves the Anima voice ID without contacting ElevenLabs, even
when another provider is selected. The backend checks voice accessibility when
starting ElevenLabs playback and keeps a short process-local runtime cache. Realtime chat still
resolves the selected voice and mints a single-use `ttd_websocket` token per run
(the dialogue socket refuses `tts_websocket` tokens), but
it does not perform a fresh ElevenLabs `voices.get` call when the cache says the
voice was recently valid.

If session setup fails, `chat:sse` emits `tts.session.error` and continues
streaming assistant text. The frontend marks TTS skipped for that run, except
that a hosted `speech_allowance_exhausted` decline (on this frame or a
finalized `tts.error`) moves the run to [Pocket TTS](voice.md#elevenlabs-tts)
where it is supported.

## Eleven v4 Finalized Streaming

`eleven_v4` is the finalized model. For it, `chat:sse` does not emit
`tts.session`. The backend speaks each finished sentence or paragraph through
ElevenLabs' Text to Dialogue HTTP streaming with timestamps, and pushes the
audio over the same chat SSE stream.

For main-structured TTS speech, `user.response` can include additive TTS
fields:

- `tts_text`
- `tts_phonemized_text`
- `tts_text_basis: "gruut_text_with_ws"`

gruut prepares speech whose letters are all ASCII, which is treated as English,
whatever its punctuation, symbols or emoji: `tts_text` is its normalized text,
with numbers spelled out, and `tts_phonemized_text` is its phonemes. Speech with
other letters carries no TTS fields and is spoken as written, in any language.
This includes Japanese, Korean, Chinese and accented Spanish, and English with an
accented loanword. All ElevenLabs chat
models prefer `tts_text` over the visible speech text when `tts_text_basis` is
`gruut_text_with_ws`. Realtime sends it to the admitted websocket; finalized v4
sends it from the backend.

For structured speech streaming, `useChatSession.ts` sends each speech delta
into the existing TTS pipeline as it arrives. Realtime ElevenLabs speech keeps
one browser websocket per chat run; ordered input frames provide continuity,
and completion ends the stream as described under the realtime model.

**Grouping:**

- **Sentence:** the backend sends one finalized request per sentence, using
  its prepared text.
- **Paragraph:** the backend keeps the same sentence-level `user.response`
  events. It joins visible sentence text into paragraph batches and prepares
  English paragraphs through gruut; other paragraphs are spoken as written.
  - A batch flushes when a new paragraph starts, at four sentence segments, at
    about 600 visible characters, or when the speech stream closes.
  - Before each batch after the first, the backend inserts a 400 ms silent PCM
    `tts.audio` frame, so adjacent paragraphs have a natural gap.

**The request:**

- It uses `model_id="eleven_v4"` and `output_format="pcm_24000"`.
- `apply_text_normalization` is `"off"` for text gruut prepared and `"auto"`
  for text sent as written, which ElevenLabs normalizes in its own language.
- A request carries at most 2,000 characters, Text to Dialogue's documented
  limit. A longer segment is spoken as consecutive requests that continue from
  each other.
- Each request after the first continues the reply's delivery:
  - it sends `previous_request_ids`: up to the last three request ids of the
    run, from each response's `request-id` header;
  - with no id known, it sends `previous_text`: up to 100 characters of the
    preceding text.

The backend resolves and validates the selected voice at most once per chat
run. Later sentence or paragraph batches reuse the resolved `voice_id`, so
voice validation is not in the streamed audio path.

Voice-structured responses also contain internal `emotional_tone` and
`emotional_intensity` fields before `speech`. The backend filters those fields
out of frontend `user.response` events. Normal `chat:sse` uses them to compute
and persist the full-state `emotion.update`; the frontend still uses that
event's `emotions` array as the avatar source of truth. For `eleven_v4`, the
backend also maps the tone to an allowlisted ElevenLabs audio tag and prefixes
only the text sent upstream to ElevenLabs. Sentence grouping prefixes
only the first upstream request; paragraph grouping prefixes every paragraph
batch. The visible `speech`, persisted messages, `tts_text`,
`tts_phonemized_text`, avatar lip-sync inputs, realtime ElevenLabs websocket
text, PocketTTS text, and browser TTS text remain untagged. Missing, blank, or
unrecognized tone metadata is handled in the backend with a warning and does
not create a frontend-visible error. Neutral, missing, blank, or unrecognized
tone metadata uses the backend-only `[friendly]` provider prefix and emits a
no-op emotion update.

The timestamp stream's character timing is not forwarded yet. `chat:sse` audio
events include:

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

The frontend decodes each finalized `pcm_24000` SSE audio frame into `Int16Array`
samples, converts those samples to normalized `Float32Array` audio, creates
24 kHz `AudioBuffer` objects, and schedules them with `AudioBufferSourceNode`
through a normal `GainNode`. The backend coalesces upstream PCM bytes before
emitting `tts.audio` frames so the frontend schedules fewer, larger buffers.
This finalized path bypasses the shared PCM worklet used by realtime
streaming models and lets the browser's Web Audio engine resample to the output
device rate.

When a finalized Eleven v4 run starts, the frontend prewarms the local
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
`Eleven v4 Turbo` persists `eleven_v4_turbo`; `Eleven v4` persists `eleven_v4`.

When `Eleven v4` is selected, the "Stream chunked TTS" switch is shown unchecked
and disabled, because v4 uses backend-pushed finalized audio instead of frontend
text-token chunking. The saved `tts_stream_chunks` preference is not
overwritten, so switching back to Eleven v4 Turbo restores the previous
effective chunked behavior.

When `Eleven v4` is selected, application speech settings also show an `Audio
grouping` control. `Sentence` persists
`tts_elevenlabs_v3_finalized_chunking="sentence"` and starts audio as soon as
each sentence batch is ready. `Paragraph` persists
`tts_elevenlabs_v3_finalized_chunking="paragraph"` and waits for paragraph or
safety batches to trade first-audio latency for smoother long-form delivery.
Switching away from `Eleven v4` hides this control without changing the saved
grouping value.

Anima voice selection is resolved from
`speech.elevenlabs.primary_voice`. Legacy saved
`speech.elevenlabs.variants` maps are ignored.
