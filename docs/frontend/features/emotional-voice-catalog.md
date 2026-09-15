# Pocket Voice Catalog Guide

PocketTTS catalogs are private binary voice-embedding files used by PocketTTS
playback. The browser-side catalog builder encodes named embeddings, and
backend upload primitives validate catalog bytes. The four-step Create Anima
journey has no voice-authoring step.

Current runtime behavior:

- prepared Anima voice catalogs supply emotion/intensity-specific embeddings
- the voice-selection adapter accepts an explicit Anima catalog URL
- ElevenLabs realtime TTS does not read Pocket catalogs
- PocketTTS does not read ElevenLabs voice ids

Current files:

- `src/frontend/web/src/lib/speech/pocket/catalog-builder.ts`
- `src/frontend/web/public/tts/workers/inference-worker.js`
- `src/frontend/web/src/lib/speech/pocket/anima-voice-selection.ts`
- `src/frontend/web/src/hooks/use-tts-playback.ts`
- `src/backend/animama/server/pocket_voice_catalog.py`
- `src/backend/animama/server/avatar_uploads.py`

Catalog-building primitives do not establish a complete user-facing voice
authoring workflow. Use the [voice runtime guide](../runtime/voice.md) for
playback selection and fallback behavior.
