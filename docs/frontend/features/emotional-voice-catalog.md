# Pocket Voice Catalog Guide

PocketTTS catalogs are private binary voice-embedding files used by PocketTTS
playback. The browser-side catalog builder and backend upload primitives still
exist, but the old custom anima create/profile-edit submit path was retired
during memory filesystem Phase 3.

Current runtime behavior:

- bundled public anima catalogs still work
- anima-specific catalog URLs can still be resolved from existing metadata
- ElevenLabs realtime TTS does not read Pocket catalogs
- PocketTTS does not read ElevenLabs voice ids

Current files:

- `src/frontend/web/src/lib/speech/pocket/catalog-builder.ts`
- `src/frontend/web/public/tts/workers/inference-worker.js`
- `src/frontend/web/src/lib/speech/pocket/anima-voice-selection.ts`
- `src/frontend/web/src/hooks/use-tts-playback.ts`
- `src/backend/animama/server/pocket_voice_catalog.py`
- `src/backend/animama/server/avatar_uploads.py`

Custom voice authoring should return with a memory-file-backed anima editor
instead of the retired `POST /v1/animas/custom` and
`PUT /v1/animas/{anima_id}/profile` routes.
