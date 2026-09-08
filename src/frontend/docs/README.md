# Frontend Docs

These docs describe the current `src/frontend` workspace: the Vite web app in
`web/`, the Hono local frontend server in `server/`, and the Electron
desktop runtime in `desktop/`. For desktop use, start with
[Installation and availability](desktop/installation.md); no signed public
release is available yet.

The frontend is the user-facing AI Avatar Desktop Companion experience: anima
selection and management, `/v1/chats` history, direct `chat:sse` streaming,
client-side STT/VAD, TTS playback, avatar rendering/animation, user-file upload
debugging, and desktop PiP/fullscreen behavior.

Start here:

- `architecture/overview.md`: source map, route/provider flow, data flow, and
  commands.
- `architecture/routing.md`: TanStack Router route ownership and conventions.
- `architecture/auth-server.md`: trusted local gateway, request policy,
  transport proxy, renderer capability, and accountless runtime-readiness seam.
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
- `features/user-profiles.md` (private display-name setup and personalization)
- `features/emotional-voice-catalog.md`

Runtime guides:

- `runtime/chat.md`
- `runtime/voice.md`
- `runtime/elevenlabs-tts.md` (ElevenLabs realtime and v3 finalized TTS)
- `runtime/sound.md`
- `runtime/avatar-animation.md`
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

Architecture and implementation references:

The local product and these durable guides belong in `animama`; see
[Repository boundaries](../../../docs/architecture/repository-boundaries.md).
Full execution plans and their approval history are privately retained, including
plans for local features. Contributors need no private planning checkout. Use
these implementation and operational references:

- [Trusted local gateway](architecture/auth-server.md) and
  [backend operations](../../backend/docs/operations/development.md): accountless
  startup, the installation owner, loopback access and optional local admin tools.
- [Local content runtime](architecture/local-content-runtime.md),
  [content previews](runtime/content-previews.md) and
  [Library](features/library.md): content custody, prepared bytes and editable
  Local content behavior.
- [Custom Anima creation](features/custom-anima-creation.md) and
  [Anima management](features/anima-management.md): current creation, ownership,
  saved-state and recovery contracts.
- [Anima memory](features/anima-memory.md): current memory workspace and Memory
  Manager behavior.
- [Browser journeys](testing/browser-journeys.md): isolated targets, mutation
  ownership, cleanup and manual verification expectations.
- [Discover public contracts](../../../docs/architecture/discover-contract-ownership.md):
  proposed optional online client/portable-package boundaries. The identifiers
  remain unratified; local builds and use need no operated service.

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

Active docs describe the current Vite/TanStack frontend. Superseded migration
narratives and retired plans remain available in Git history.
