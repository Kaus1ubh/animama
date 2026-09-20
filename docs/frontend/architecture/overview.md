# Frontend Architecture Overview

This document is the entry point for the current `src/frontend` workspace.
The frontend contains the browser app in `web/`, reusable packages and the
Electron shell in `desktop/`. FastAPI serves the production React build.

## Runtime Shape

Core packages:

- `web/`: Vite + React + TanStack Router browser frontend.
- `desktop/`: Electron windows, the embedded macOS service supervisor, encrypted
  credential vault, and guarded preload bridge. `desktop:dev` may still use the
  external local stack; packaged builds require an audited embedded runtime.
- `shared/`: serializable desktop runtime/credential contracts without Electron
  imports. See [Desktop overview](../desktop/overview.md) for lifecycle and the
  current packaged-validation gate.

The local React composition is accountless. FastAPI prepares the installation
at process startup; React reads its bounded runtime context at the application origin and
requests bootstrap only if the backend reports a repair is needed. It then
supplies the generated principal to shared features through a neutral owner
context. The generated client and protected-byte loaders use the application origin
without browser bearer tokens.

## Web Source Map

Main browser code lives under `src/frontend/web/src`:

- `routes/`: TanStack Router file routes and route guards.
- `app/`: router setup, global providers, local runtime readiness, neutral owner
  context, and query client.
- `ui/`: feature UI, shell layout, sidebar, chat, canvas, settings, and debug
  surfaces. The route-independent User Profile editor lives under `ui/profile`.
- `query/`: TanStack Query keys, options, read hooks, and mutations.
- Generated OpenAPI methods and types live in the sibling
  `packages/runtime-contracts` package, not in the web source tree.
- `hooks/`: orchestration hooks for dictation, TTS, user-file uploads,
  websocket, fullscreen, PiP, sound, and VRM editor sessions.
- `stores/`: Zustand runtime state for avatar, scene VFX, voice debug, and
  related browser state.
- `lib/`: browser runtime modules for API client wiring, avatar engine, speech,
  voice, sound, settings, telemetry, and shared utilities.
- `workers/`: browser workers for smart-turn, viseme processing, and
  incremental content hashing.
- `platform/`: Vite/browser platform adapters such as env and image rendering.

Large browser-engine assets such as ONNX models and TTS resources live under
`src/frontend/web/public`. Typed product content lives under the repository
`content/included` and `content/local` roots, is registered by Animama, and is
delivered through the FastAPI Content API. A narrow Vite compatibility plugin
still exposes scene backgrounds and effect textures that the browser rendering
engine and editors address directly; it does not expose VRM, VRMA, portrait,
voice, or starter-Anima product catalogs.

## Route And Provider Flow

Global startup:

- `src/frontend/web/src/main.local.tsx` mounts the local React composition.
- `src/frontend/web/src/app/providers/AppProviders.tsx` configures the Anima
  API client and wraps theme, TanStack Query, local runtime, and toaster
  providers.
- `src/frontend/web/src/app/local-runtime/LocalRuntimeProvider.tsx` reads runtime
  readiness, repairs only when needed, shares concurrent initialization, exposes
  loading/ready/recoverable-error states, and supplies the principal through
  `RuntimeOwnerContext`.
- `src/frontend/web/src/app/router.tsx` creates the TanStack Router and gates
  route rendering on local runtime readiness.
- `src/frontend/web/src/routes/__root.tsx` owns root document head, scroll
  restoration, scripts, and not-found rendering.

`web/src/lib/feature-flags.ts` currently disables `themeSelection` for web and
desktop. The theme provider forces the default light theme from startup, and
the user menu hides the entire theme section and custom-theme editor. Browser/system
preferences and saved backend themes do not override light while this flag is
off. Theme synchronization pauses without deleting saved preferences or custom
colors; enabling the flag restores the existing selection behavior. Toasts use
the same forced theme.

Primary routes:

- Launch selection: the `/a/` index waits for saved settings and owned Animas,
  then opens the last visited Anima at `/a/$animaId`, falling back to the first
  in creation order (Annie on fresh installs). It offers Retry for failed reads
  and opens creation if none remain. Existing deep links keep their destination.
- `/`: `src/frontend/web/src/routes/index.tsx`; sends incomplete first run to
  `/setup` and a ready installation to `/a`.
- `/setup`: `src/frontend/web/src/routes/setup.tsx`; required private display
  name and Continue, with no Skip action. Embedded desktop also offers optional
  provider-key setup through status-only main-process IPC.
- `/a`: `src/frontend/web/src/routes/a.tsx`; accountless app shell with
  `SettingsGate`, `AppShell`, the route-independent content Preview Dock provider,
  and `SidebarShell`. The sidebar Create control links to the creator hub and
  opens a hover/focus popout for Anima, Gesture, Reaction, Particle VFX, and
  Sounds authoring routes in both expanded and collapsed states. Its expanded
  Chats section lists the installation owner's recent conversations across all
  Animas and identifies each row with that Anima's portrait. Compact menus on
  the Animas and Chats section headings control Anima ordering and per-Anima
  chat filtering without changing the active route. The default Recently used
  Anima order promotes the live or remembered last-active Anima before falling
  back to persisted Anima update recency.
- `/a/create`: `src/frontend/web/src/routes/a/create.tsx`; creator hub for
  Anima, Action, and Effects authoring.
- `/a/animas/new`: `src/frontend/web/src/routes/a/animas.new.tsx`; the four-step
  live creator under `ui/create-anima`, with typed sources, one selected-Avatar
  preview, owner-scoped draft recovery, and strict idempotent submission.
  Existing entry links and logical Avatar search/auth handoffs remain. Only
  confirmed Saves persist content; Create commits one Anima before preparing
  its first runtime. Cancel exits to the creator hub, not the roster resolver.
- `/a/memories`: `src/frontend/web/src/routes/a/memories.tsx`; local memory
  library for user-scope markdown entries and installation-owned upload/debug
  workflows.
- `/a/library`: `src/frontend/web/src/routes/a/library.tsx`; protected Library
  composing typed product catalogs and Chat Uploads.
- `/a/animas`: `src/frontend/web/src/routes/a/animas/index.tsx`; compatibility
  resolver that replaces the URL with the first owned Anima's management route,
  or sends an installation with no Animas to `/a/animas/new`.
- `/a/animas/:animaId`:
  `src/frontend/web/src/routes/a/animas/$animaId.tsx`; anima details and
  management. `/a/animas/:animaId/identity` opens the anima-scoped
  `IDENTITY.md` memory editor modal.
- `/a/avatar-portrait-debug`:
  `src/frontend/web/src/routes/a/avatar-portrait-debug.tsx`; explicitly opted-in
  development VRM portrait-capture harness. Production builds return not found.
- `/a/:animaId` and `/a/:animaId/c/:chatId`:
  `src/frontend/web/src/routes/a/$animaId.tsx` owns the anima runtime shell,
  `AnimaRouteProviders`, `MainShell`, and `ChatInterface`. The child chat
  route is intentionally minimal so URL changes do not remount the avatar,
  TTS, or SSE runtime.

The sidebar Personalization action opens a private display-name modal over the
active route. Application settings remain separate. Neither action navigates or
remounts chat/avatar runtime state.

## Data And Runtime Flow

- Generated SDK methods come from `@animama/runtime-contracts/sdk`; their
  generated source lives under `src/frontend/packages/runtime-contracts/src/generated`.
- API base URLs and browser flags come from `src/frontend/web/src/platform/env.ts`.
- `configureAnimaApiClient.ts` uses `window.location.origin`; the global local
  local request interceptor adds only the CSRF marker to mutating `/v1` requests.
- TanStack Query state uses `src/frontend/web/src/query/keys.ts` and the hooks
  under `query/hooks` and `query/mutations`.
- Runtime-local state that is not server state lives in Zustand stores under
  `src/frontend/web/src/stores`.

Chat flow:

1. `ChatInterface` owns text input, dictation integration, and submit/stop UI.
2. `@animama/product-ui/chat` owns the existing `useProductChatSession` state,
   optimistic messages, `chat:sse`, revision fences, and cache reconciliation.
   Local `useChatSession` supplies settings, mounted-content readiness, TTS and
   avatar effects through typed adapters.
3. The package owns `useChatSse`, shared Anima selection, `ChatConversation`, and
   composer primitives. Local route links, file/model/microphone controls, and
   desktop shell placement compose those same shared views.
4. Avatar, lip-sync, emotion, and voice updates flow through stores and runtime
   hooks before reaching `AvatarCanvasActor`.

User-file upload flow:

1. Chat composer and Library's Chat Uploads management panel create a scoped
   Uppy instance through `useUserFileUpload`.
2. Uppy calls generated API mutations to initialize a admitted local
   upload, PUTs bytes through FastAPI, finalizes the atomically promoted file,
   and usually enqueues processing.
3. `useUserFiles` lists current-user files and polls while uploads or processing
   jobs are active.
4. Library's Chat Uploads management remains available in production; keyword,
   semantic, and hybrid retrieval inspectors load only with development debug
   opt-in. Chat attachments send only backend-owned file IDs to `chat:sse`;
   original bytes stay beneath the private `data/user-files` root.

## Production Loading

`platform/env.ts` exposes one effective `DEBUG_ENABLED` flag. It requires an
actual Vite development server and explicit `VITE_ENABLE_DEBUG_PANEL=true`
(or `1`). All builds, including `embedded-desktop`, exclude the inspector
imports even when that input is inherited as true. The literal
`__ANIMAMA_DEV_BUILD__` guard at dynamic-import sites lets the bundler remove
unreachable debug chunks; a cross-module flag alone is insufficient. Production
registers no avatar inspector targets, face/spring-bone helpers, animation
snapshot polling, or voice diagnostic recording. Development debug dialogs
load when opened, and inspector state does not remount the avatar. Health,
bounded errors, recovery, browser DevTools, and the operator `dev-tools` profile
are unaffected.

Vite emits `.vite/manifest.json` as a server-side build inventory. FastAPI
uses it to grant one-year immutable caching only to successful fingerprinted
JS/CSS. HTML revalidates and missing chunks remain 404. A failed route offers
an explicit **Reload page** action, with an unsaved-changes warning and no
automatic reload. The app handles Vite preload errors before the router's
built-in refresh attempt. See [Local HTTP boundary](auth-server.md).

An ordinary new tab may show cached HAR rows while transferring no app JS/CSS.
DevTools **Disable cache** and hard reload are different experiments. Private
content still revalidates ownership; the runtime manifest uses scoped gzip
while issuing a fresh lease. Do not compare total row counts as if each row
were a download. Evaluate startup changes using transferred bytes and first-frame timings
with the same cache conditions, content and optional packs.

## HTTP Serving

FastAPI's local boundary lives in `src/backend/animama/local/http`, composed by
`src/backend/animama/server/local_http.py`. It owns admission, installation
principal resolution, static/model responses, telemetry and desktop quiescence.
Vite owns development serving and a closed proxy to the private backend;
production has no frontend Node service. Browser modules import neither backend
configuration nor Electron internals.

The browser retains UI/SSE metric calls and API trace propagation through
`@opentelemetry/api`, but its startup does not register telemetry providers or
export OTLP signals.
The bounded FastAPI forwarder remains, disabled by default in Compose and
always disabled in embedded desktop with a 204 response. Compose no longer
bundles a collector or the retired `obs` stack. Local logging remains available.
Future hosted observability requires its own explicit provider, collector, and
privacy-safe payload configuration.

## Commands

Run from `src/frontend`:

- `pnpm web:dev`
- `pnpm web:check`
- `pnpm check`
- `pnpm web:lint`
- `pnpm web:test`
- `pnpm web:build`
- `pnpm verify:tts-assets`
- `pnpm openapi-ts`

`pnpm openapi-ts` exports the local FastAPI schema offline to a temporary file,
generates the client, and removes the temporary schema. Client generation never
requires a running stack or exposes FastAPI documentation over HTTP.

### Local Docker Dependency Cache

The Compose `web` service keeps its Linux `node_modules` trees and pnpm store
in stack-scoped named volumes. Normal `./reset.sh` preserves both these caches
and application data, and the startup `pnpm install` reconciles
them with the current lockfile. Normal source edits and dependency updates do
not require rebuilding the Node image; remove the frontend dependency volumes
only when intentionally troubleshooting a corrupted or platform-incompatible
install.

## Where To Edit

- Add or change routes in `src/frontend/web/src/routes`.
- Add route-independent feature UI in `src/frontend/web/src/ui`.
- Add API reads/mutations in `src/frontend/web/src/query`.
- Change generated API contract only by updating backend OpenAPI output and
  rerunning `pnpm openapi-ts`.
- Change memory-entry and user-file upload UI through
  `src/frontend/web/src/ui/memory`, `src/frontend/web/src/hooks/useUserFileUpload.ts`,
  and the chat-input upload button.
- Change avatar/speech/chat runtime carefully; see the runtime docs in
  `docs/frontend/runtime`.
