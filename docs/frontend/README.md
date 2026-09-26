# Frontend Docs

The frontend workspace contains the Vite app in `web/` and Electron runtime in
`desktop/`. For desktop use, start with
[Installation and availability](desktop/installation.md); no signed public
release is available yet.

Start here:

- `architecture/overview.md`: source map, route/provider flow, data flow, and
  commands.
- `architecture/routing.md`: TanStack Router route ownership and conventions.
- `architecture/auth-server.md`: FastAPI local HTTP serving, request policy,
  development proxy, renderer capability, and accountless runtime-readiness seam.
- `architecture/data-layer.md`: generated client and TanStack Query patterns.
- `architecture/content-and-workers.md`: runtime content, workers, and LFS notes.
- `architecture/local-content-runtime.md`: authenticated local HTTP byte
  delivery, ephemeral prepared mounts, degraded playback, no-hot-swap, and the
  shared web/Electron boundary.

Feature guides:

- `features/custom-anima-creation.md`: four-step live creator, exact sources,
  confirmed uploads, owner-scoped draft/retry recovery, and first-chat handoff.
- `features/anima-management.md`
- `features/avatar-releases-and-appearance.md`
- `features/anima-memory.md` (filesystem workspace and Memory Manager)
- `features/user-file-uploads.md`
- `features/library.md`
- `features/user-profiles.md` (private display-name setup, 18+ confirmation,
  and personalization)
- `features/emotional-voice-catalog.md`

Runtime guides:

- `runtime/chat.md` (includes companion safety: AI notice, crisis card, Quick
  Chat mirror, Settings → Safety, and the protocol dialog and `/safety` page;
  see the [safety and crisis protocol](../safety/crisis-protocol.md))
- `runtime/voice.md`
- `runtime/elevenlabs-tts.md` (ElevenLabs realtime and v3 finalized TTS)
- `runtime/sound.md`
- `runtime/avatar-animation.md`
- `runtime/mixamo-acquisition.md`: private manual-download checklist and deferred conversion.
- `runtime/content-previews.md`
- `runtime/avatar-planner.md`
- `runtime/avatar-lipsync.md`
- `runtime/avatar-emotion.md`
- `runtime/avatar-vfx.md`
- `runtime/avatar-particle-vfx.md`
- `runtime/scene-vfx.md`
- `runtime/vrm-inspector-editor.md`

Testing guides:

- `testing/browser-journeys.md`: main-stack Playwright setup, authentication
  safety, serial execution, playback/creator journeys, exact Local-content
  cleanup, and retained evidence.

For repository ownership, see [Repository boundaries](../architecture/repository-boundaries.md).

Desktop:

- [Installation and availability](desktop/installation.md)
- [Optional feature packs](desktop/feature-packs.md)
- [Troubleshooting, storage and recovery](desktop/troubleshooting.md)
- [Maintainer release process](desktop/release-process.md)
- [Runtime architecture](desktop/overview.md)
- [Platform development builds](desktop/platforms.md)
- [Runtime staging and inventory review](desktop/runtime-staging.md)
- [Size exception decisions](desktop/size-decisions.md)
- [Redistribution source evidence and outstanding review](desktop/redistribution-review.md)
- [Signing, acceptance and publisher reference](desktop/releases.md)
- [Picture-in-picture](desktop/picture-in-picture.md)
- [Quick chat](desktop/quick-chat.md)
- [Keyboard shortcuts](desktop/keyboard-shortcuts.md)
