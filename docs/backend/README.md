# Anima Backend Docs

This directory is the current documentation entry point for the FastAPI backend in
`src/backend/animama`.

## What This Backend Does

The FastAPI backend owns installation admission, persistence, local content,
file processing, memory, and direct chat through
`POST /v1/animas/{anima_id}/chat:sse`. The frontend owns browser UI, avatar
rendering, and client-side speech recognition.

## Docs Map

- [Architecture overview](architecture/overview.md): package layout, boundaries,
  dependency flow, app startup, configuration, and auth.
- [Local content storage and self-hosted trust](architecture/local-content-storage.md):
  approved Included/Local/private-data layout, creator and manual-file
  lifecycle, single-owner operator boundary, direct byte delivery, degraded-runtime policy, and
  reset and backup boundaries.
- [HTTP and realtime API](architecture/http-api.md): routers, endpoint groups,
  admission, ownership, chat SSE, and reserved event streams.
- [Data model](architecture/data-model.md): ORM entities, relationships,
  migrations, and database conventions.
- [Direct chat SSE runtime](runtime/chat.md): supported `chat:sse` endpoint,
  direct model-client chat flow, primary-derived emotion updates, SSE frames,
  side effects, cleanup, and unsupported graph behavior.
- [Model clients and providers](runtime/model-client-providers.md): shared direct
  model clients, catalog provider rows, prompt-only maintenance calls, and chat
  persistence.
- [Adding AI model support](runtime/adding-ai-models.md): end-to-end model
  integration map and contributor workflow for adding catalog rows, compatible
  vendors, provider clients, public capabilities, seed data, frontend exposure,
  and verification.
- [Model catalog](model-catalog.md): supported provider/model pairs exposed by
  `/v1/model-providers`.
- [Memory](features/memory.md): scoped markdown memory entries, anima identity
  prompt assembly, seeded user profile entries, and memory tool boundaries.
- [User files](features/user-files.md): installation-owned uploads, parser worker,
  chunk storage, debug search, and current MVP limits.
- [Local User Profile](features/user-profiles-and-usernames.md): required private
  display-name personalization for the generated installation principal, with
  nullable bootstrap placeholders before setup.
- [Typed content and local packages](features/typed-content-and-marketplace.md):
  editable catalog domains, dependency safety, prepared runtime mounts, and
  local package import/export boundaries.
- [Custom animas and typed content](features/custom-animas-and-content.md):
  catalog-backed Anima loadouts, reviewed changes, and chat runtime revision
  fencing.
- [Voice and speech](integrations/voice-and-speech.md): ElevenLabs TTS, voice
  storage, and the client-side speech-processing boundary.
- [Shared model setup](operations/model-assets.md): verified Parakeet acquisition,
  worktree reuse, persistent self-host storage and explicit recovery.
- [Local model servers](operations/local-models.md): Ollama, LM Studio,
  llama.cpp and vLLM setup, context windows, Compose host access and connection
  keys.
- [Development and operations](operations/development.md): local commands,
  migrations, tests, workers, and deployment guidance.
- [Local HTTP components](operations/local-http-components.md): FastAPI
  admission, static assets, telemetry, bounded transport and private drain
  behavior used by the desktop and self-host compositions.
- [Embedded desktop backend](operations/desktop-runtime.md): owned native
  services, frozen CLI, private environment, mounts, vault/token distinctions,
  migration snapshots and the separate Compose boundary.

## Architecture, contracts and operations

These guides describe the local product. See
[Repository boundaries](../architecture/repository-boundaries.md) for ownership,
[Memory Manager](features/memory-manager-and-episodic-memory.md) for maintenance
and approval semantics, and
[Desktop backend packaging](../../src/backend/packaging/desktop/README.md) for
frozen-runtime inputs.

## Important Source Files

Start with `server/app.py` for composition, `server/routers/` for delivery,
`app/services/` for use cases, and `app/chat/` for direct turns. The
[architecture overview](architecture/overview.md#package-layout) maps the package
boundaries; feature guides identify their implementation entrypoints.

## Backend Conventions

Follow the [backend agent guide](../../src/backend/AGENTS.md) for change rules
and the [development guide](operations/development.md) for commands. Shared
services receive explicit owners and ports; local composition owns installation
identity, database resources, and HTTP admission.
