# AGENTS.md

Guidance for AI coding agents working in `src/frontend`.

## Mission

Ship production-grade frontend changes for Animama's AI Avatar Desktop
Companion app with:

- correct behavior first
- minimal regressions in chat, avatar, speech, auth, and realtime flows
- maintainable typed code that matches the current Vite/TanStack architecture

Prefer boring, local changes that fit existing patterns.

## Project Snapshot

- Workspace root: `src/frontend`
- Product surface: avatar companion chat, anima management,
  memory, voice/TTS, realtime avatar rendering, and desktop wrapper behavior.
- Normal chat backend: `POST /v1/animas/{anima_id}/chat:sse` with
  `/v1/chats` history.
- Package manager: `pnpm`
- Web app: `web/` using Vite, React, TanStack Router, TanStack Query, Zustand,
  Tailwind CSS, React Three Fiber, and `@pixiv/three-vrm`
- Application serving: FastAPI serves the production React build and owns
  local request admission, installation ownership, static/model delivery and
  telemetry. Compose development publishes Vite with HMR and a closed
  same-origin proxy to private FastAPI. There is no frontend server workspace.
- Optional Compose `dev-tools` exposes only pgAdmin (`localhost:5050`) and
  Dozzle (`localhost:9999`) on literal loopback for local operators. These are
  separate from the app origin: no React configuration, application routes, or
  desktop packaging may depend on them. Use `./reset.sh --profile dev-tools`
  from the repository root; disabling preserves data and requires no purge.
- Desktop: `desktop/` using Electron, the embedded macOS runtime supervisor,
  and electron-builder. Unpackaged `desktop:dev` still supports the external
  local stack; packaged mode requires audited runtime resources.
- Public packages: `packages/runtime-contracts`, `packages/product-ui`, and
  `packages/discover-client`; authored package imports stay within their own
  `src` tree or use declared package dependencies.
- Generated API client: `packages/runtime-contracts/src/generated`, regenerated
  offline and exported through `@animama/runtime-contracts/sdk`, `api-types`,
  and `validators`.
- Runtime assets: small tracked files in `web/public`; verified speech inputs
  selected by `models/browser-runtime/manifest.json`.
- Docs entrypoint: `../../docs/frontend/README.md`

Start with:

- `../../docs/frontend/architecture/overview.md`
- `../../docs/frontend/architecture/routing.md`
- `../../docs/frontend/runtime/chat.md`
- `../../docs/frontend/runtime/avatar-animation.md`
- `../../docs/frontend/runtime/voice.md`
- `../../docs/frontend/desktop/platforms.md`
- `electron-guide.md`

## Non-Negotiable Rules

1. Do not hand-edit generated SDK files under
   `packages/runtime-contracts/src/generated/**` or generated
   TanStack Router output such as `web/src/routeTree.gen.ts` when present.
2. Do not edit vendored PocketTTS internals unless the task explicitly targets
   that runtime:
   - `web/src/lib/speech/pocket/core/**`
   - `web/src/lib/speech/pocket/audio/**`
   - `web/src/lib/speech/pocket/index.js`
3. Preserve browser/server boundaries:
   - browser code stays in `web`
   - request admission, Postgres and telemetry forwarding stay in
     `src/backend/animama/local/http` and the local backend composition
   - browser-exposed env values must be `VITE_*`
4. Keep the accountless runtime-owner, local HTTP request policy, and telemetry
   wiring intact unless the task explicitly targets those systems.
5. Prefer existing query hooks, mutations, stores, and helpers over introducing
   parallel data paths.

## Architecture Map

- `web/src/routes/**`: TanStack Router file routes, route guards, params, and
  search parsing.
- `web/src/app/**`: router setup, global providers, local runtime readiness,
  neutral owner context, and stable query client.
- `web/src/ui/**`: feature UI, app shell, sidebar, runtime shell, chat, canvas,
  settings, and debug surfaces.
- `web/src/query/**`: query keys, options, hooks, and mutations.
- `web/src/hooks/**`: orchestration hooks for dictation, TTS, websocket,
  fullscreen, PiP, sound, and editor sessions.
- `web/src/stores/**`: Zustand runtime state.
- `web/src/lib/**`: browser runtime modules for API client configuration,
  avatar, speech, voice, sound, settings, telemetry, and utilities.
- `web/src/workers/**`: Vite-bundled browser workers.
- `web/public/**`: Vite-served runtime assets.
- `web/vite.config.ts`: development serving and closed application proxy.
  Preserve original Host/Origin/Fetch Metadata; Vite does not grant ownership.
- `desktop/src/**`: Electron main/preload code, secure window creation,
  guarded navigation, runtime supervision, encrypted credentials, fullscreen,
  PiP, quick chat, and shortcut IPC.
- `shared/desktop-runtime.ts`: neutral serializable runtime/credential types;
  no Electron imports in browser modules.
- `desktop/electron-builder.yml`: embedded Apple Silicon macOS resources;
  Windows/Linux package commands remain gated, despite legacy target entries.

Critical route composition:

- `web/src/main.local.tsx` -> `AppProviders` -> `LocalRuntimeProvider` ->
  `AppRouter`
- `web/src/routes/a.tsx` -> first-run gate + settings + app shell + sidebar
- `web/src/routes/a/$animaId.tsx` -> anima providers + main shell + chat
  runtime
- `web/src/routes/a/$animaId/c/$chatId.tsx` is intentionally minimal so
  chat-id URL changes do not remount runtime effects.

## Frontend Review Guidance

Follow this guide and the checked-in React/Vite/TanStack documentation. Imported
agent skills are optional local tools and are not included as contributor or
build prerequisites.

For component changes, preserve clear APIs, keyboard access and semantic HTML.
Measure rendering or loading problems before optimizing them. Before adding
transitions, verify support in the installed React and browser runtimes and
respect reduced-motion preferences.

## Implementation Patterns

### Library Documentation

Use Context7 when frontend work needs the latest documentation or API reference
for a library already in use. Resolve the library ID first, then query the
current docs before relying on memory for version-sensitive APIs, configuration,
or migration behavior.

### Code Comments

- Annotate new or changed methods, hooks, components, and important helpers with
  JSDoc-style `/** ... */` comments when their purpose, inputs, side effects, or
  invariants are not immediately obvious.
- Add concise inline comments for important non-obvious lines, guard clauses, or
  browser/runtime constraints. Explain intent and constraints instead of
  restating what the code already says.

### Data Fetching And Mutations

- Use generated SDK methods from `@animama/runtime-contracts/sdk` and DTOs from
  `@animama/runtime-contracts/api-types`. Shared product providers create one
  client from their injected `ProductApiTransport` and pass it to each operation.
  Only the local web adapter configures `@animama/runtime-contracts/default-client`
  for legacy feature calls; reusable providers must not read or mutate it.
- Wrap API access in `web/src/query/hooks/*` or
  `web/src/query/mutations/*`.
- Use `queryKeys` from `web/src/query/keys.ts`; do not create ad-hoc key
  shapes.
- Gate owner-scoped queries with local runtime readiness and the neutral owner
  context. Shared feature code must not import the local provider or
  installation endpoints.
- On mutation success, update or invalidate caches narrowly.
- Keep server state in TanStack Query and transient runtime state in Zustand.

### Routing

- Use TanStack Router primitives directly: `Link`, `useNavigate`,
  `Route.useParams`, `Route.useSearch`, and `beforeLoad`.
- Keep route params and search parsing in route files when possible.
- Pass plain ids and callbacks into feature components.
- Do not add router compatibility facades.

### Local Principal And API Client

- FastAPI owns the production application origin. Development Vite proxies
  application traffic without rewriting browser metadata into trusted identity.
  API and byte requests stay same-origin without an Animama bearer token.
- `LocalRuntimeProvider` reads bounded runtime context first and requests
  backend-owned bootstrap only for a reported repair. It shares in-flight
  initialization, owns first-run state, and supplies the generated principal
  through `RuntimeOwnerContext` only after FastAPI admits the request.
  Feature code must not accept or invent owner IDs.
- The OpenAPI client is generated offline into
  `packages/runtime-contracts/src/generated` with `pnpm openapi-ts`; do not expose
  private FastAPI documentation or point client generation at a running URL.
  Build package artifacts after regeneration. The package itself has no origin
  or credential defaults; local configuration and telemetry stay in `web`.
- Public package builds emit ESM/declarations and enforce that bundled inputs
  stay inside their own source tree. Cross-package imports use declared exports;
  no package may import `web`, `server`, `desktop`, `@/`, or `@web/` code. Keep
  runtime imports explicit and ship any package CSS/assets through its exports.

### Chat And SSE Runtime

- `useChatSession` orchestrates submit lifecycle, chat selection,
  optimistic messages, SSE, TTS, avatar state, and cache reconciliation.
- `useChatSse` owns the active `chat:sse` stream and abort/cleanup behavior.
- New stream events must tolerate missing or partial payloads.
- Keep run-id checks intact across chat, TTS, avatar, and lip-sync code.

### Avatar And Speech Runtime

- The avatar pipeline is UI/store -> `AvatarCanvasActor` -> `Avatar`.
- Gesture, emotion, and interaction-phase changes should flow through
  `avatar-runtime-store`.
- STT is coordinated by `use-dictation` and provider/runtime helpers under
  `web/src/hooks/voice` and `web/src/lib/voice`.
- TTS is coordinated by `use-tts-playback`, provider helpers, Pocket runtime,
  and ElevenLabs runtime.
- Respect browser feature detection and secure-context requirements.

### VRM Models

- VRM files are glTF extensions. When working with VRM models, prefer
  `@pixiv/three-vrm` classes, methods, accessors, and types whenever possible
  instead of manually traversing raw glTF extension data.
- Keep the VRM spec and model version in mind. VRM uses right-handed Y-up
  coordinates, metric units, and a T-pose orientation contract. VRM 0.x and
  VRM 1.0 differ: VRM 0.x stored forward as Z- with right as +X and required
  normalization to T-pose, while VRM 1.0 stores forward as Z+ and relaxes the
  normalization restrictions while making T-pose a required condition.
- Use the canonical spec when behavior is version-sensitive:
  https://github.com/vrm-c/vrm-specification/tree/master/specification
- Additional VRM 0.x and VRM 1.0 API/runtime differences are documented here:
  https://vrm.dev/en/api/api_update/

### Assets And Workers

- Public runtime assets belong in `web/public`.
- Hydrate tracked LFS audio/avatar inputs. Speech engine payloads use the verified
  shared store and exact dependency files described in
  `../../docs/backend/operations/model-assets.md`; do not restore ONNX payloads to
  `web/public` or substitute different runtime versions.
- Vite verifies the 58 browser engine files before serving/building and copies
  them into built artifacts. Keep every variant, same-origin URL and notice;
  installed artifacts must not depend on a developer cache.
- Use root-relative public URLs for runtime fetches.
- Run asset verification when changing public runtime assets.

### Desktop Shell And Platform Builds

- Keep Electron code isolated in `desktop`; do not import desktop modules into
  browser code.
- Packaged mode supervises PostgreSQL and FastAPI at the saved loopback origin,
  serving the production React build after private readiness verification.
  Independent Electron recovery remains available while FastAPI is unavailable.
  Never restore a packaged
  external-web fallback or put user data in application resources.
- Runtime staging writes to the ignored `desktop/.desktop-runtime/` directory.
  Use `pnpm desktop:runtime:stage -- --platform darwin --arch arm64` and the
  matching `desktop:runtime:audit` command on Apple Silicon. Read
  `../../docs/frontend/desktop/runtime-staging.md` for the source/licensing gate. Never force
  ignored third-party assets into a release or substitute a wrapper package
  for a verified self-contained runtime.
- Only unpackaged external-stack development loads `ANIMAMA_DESKTOP_WEB_URL`
  or `http://localhost:8000`. Explicit `ANIMAMA_DESKTOP_DEV_RUNTIME_ROOT` and
  `ANIMAMA_DESKTOP_DEV_USER_DATA` support isolated supervised testing; packaged
  builds reject web-URL, development, and sandbox overrides.
- The version-2 preload exposes runtime actions and status-only credentials.
  Provider values travel only into main, encrypted storage, and provider child
  environments; no readback, arbitrary paths/commands, or browser persistence.
- Use exact child handles for shutdown, never a discovered port or stale PID.
  Recovery must preserve the vault, database, owner, and stable origin.
- Optional packs use the embedded app-matched catalog and fixed IDs only.
  Renderer IPC must not accept pack URLs, paths, versions, hashes, or commands.
  Keep the strict zstd/USTAR inventory checks and atomic transition/rollback
  barrier. The separate document-worker pack must pass pinned OS-signature
  verification on install and every launch, even with an unsigned development
  core; never add an unsigned-worker bypass. See the staging guide for release
  input approvals, producer commands, and the outstanding native artifact gates.
- Platform dev builds are documented in `../../docs/frontend/desktop/platforms.md`.
- `pnpm desktop:mac` requires a complete fresh stage and audit, explicitly skips
  ad-hoc signing, and rechecks the packaged inventory. Unlicensed decorative SFX
  are excluded from tracked runtime definitions; never restore their ignored
  bytes or metadata as build inputs. Component tests are not substitutes for
  packaged acceptance. Windows and Linux self-contained packaging are deferred.
  Signing, updates and installed-artifact smoke tools require exact source/input
  review, matching artifacts and native acceptance. Read
  `../../docs/frontend/desktop/releases.md` before using those commands.
  Never auto-fill approval receipts, embed a token or R2 credential, run smoke
  against an existing user profile or publish as part of an ordinary build.
  `ANIMAMA_RELEASE_DISTRIBUTION` (default `r2`) is read only by build and
  release tooling and sealed into the app; the installed app never reads it, so
  never add a runtime override. Signed candidate builds do
  not contact the distribution. Preview/stable publication requires a passing
  `pnpm desktop:release:scan` receipt, anonymous destination checks and explicit
  approval. A destination that is not publicly served cannot deliver packs or
  updates. Do not add bypasses or change visibility to finish tests.
  Native smoke uses a separate macOS account with verified absent app/profile
  data. Initial publication is manual by `raymond-van` from reviewed `main`
  inputs; CI publication is unconfigured. Follow
  `../../docs/frontend/desktop/release-process.md` and provide the exact command
  only after signing, artifact, native-acceptance and publication gates pass.
  User guides are `../../docs/frontend/desktop/installation.md`,
  `../../docs/frontend/desktop/feature-packs.md` and
  `../../docs/frontend/desktop/troubleshooting.md`; the latter owns safe support/recovery guidance.
- Keep preload APIs small, typed, and exposed through `window.animamaDesktop`.
  Do not expose Node APIs directly to the React renderer.
- Global Press-to-talk uses the first-party N-API addon under
  `desktop/native/global-input-hook`: listen-only CoreGraphics on macOS and
  low-level keyboard/mouse hooks on Windows. Native code receives only one
  validated binding and emits only down/up transitions. Do not restore
  `uiohook-napi`, forward raw global input to JavaScript, suppress events, or
  skip the target-native build/audit/signing checks.

## Validation Checklist

Run from `src/frontend`:

- Build/check the public artifacts: `pnpm packages:build` and `pnpm packages:check`.
- Run package boundary fixtures: `pnpm packages:test` after building.
- Create unpublished tarballs: `pnpm packages:pack` (optional `--destination`).
- Local web dev/build/check/test commands build their package dependencies first.
  After changing package source during an active dev session, rerun the package
  build so Vite receives fresh artifacts.
- Type-check web, packages and desktop: `pnpm check`
- Lint web: `pnpm web:lint`
- Test web: `pnpm web:test`
- Build web and packages: `pnpm build`
- Check formatting: `pnpm prettier:check`
- Verify TTS assets: `pnpm verify:tts-assets`
- Check desktop only: `pnpm desktop:check`
- Build desktop main/preload only: `pnpm desktop:build`

Run `pnpm desktop:test` for supervisor/vault/IPC/packaging checks. Native package
validation currently targets macOS arm64 only: stage, audit, then
`pnpm desktop:mac`. Do not use a wrapper launch to claim packaged acceptance.

If backend schemas changed:

- Read the backend agent guide before regenerating clients.
- Regenerate client: `pnpm openapi-ts`
- Format generated output: `pnpm prettier`

For smaller changes, run the smallest meaningful subset and state what was not
run.

## Accountless Browser Checkpoint

The supported local browser journey starts at the sole application origin. A fresh
installation opens `/setup`; a completed installation opens `/a` without an
account or session. Do not create a local account, restore the deleted seed
script, add browser Authorization callbacks, expose private services, or add a
configuration switch that turns the local runtime into a hosted identity service.
Validate runtime/provider behavior with web tests and the boundary with
`uv run pytest -q tests/test_local_http_*.py` from the repository root.
Exercise both named Compose selections for rendered browser acceptance.

## High-Risk Areas

Prefer minimal, surgical diffs in:

- `web/src/ui/main/chat/useChatSession.ts`
- `web/src/query/mutations/useChatSse.ts`
- `web/src/hooks/use-dictation.ts`
- `web/src/hooks/use-tts-playback.ts`
- `web/src/hooks/use-elevenlabs-tts-runtime.ts`
- `web/src/hooks/use-pocket-tts-runtime.ts`
- `web/src/ui/main/canvas/AvatarCanvasActor.tsx`
- `web/src/lib/avatar/**`
- `web/src/lib/speech/**`
- `web/src/lib/voice/**`
- `web/src/app/local-runtime/**`
- `web/src/app/runtime/**`
- `web/src/lib/api/**`
- `web/src/lib/telemetry/**`
- `desktop/src/main.ts`
- `desktop/src/preload.cts`
- `desktop/src/main-process/**`
- `desktop/electron-builder.yml`
- `desktop/scripts/**`

## File Edit Guidelines

- Keep import style, aliases, naming, and component patterns consistent with
  nearby code.
- Reuse existing utilities such as `createLogger`, `queryKeys`, `cn`, env
  helpers, settings helpers, and provider helpers.
- Prefer existing dependencies. If adding a dependency is necessary, update the
  lockfile and explain why the new package is warranted.
- Avoid broad renames or moves unless requested.
- Update `../../docs/frontend/` when useful guidance becomes missing or misleading;
  follow the [reader-value standard](../../AGENTS.md#documentation).

## Change Summary Expectations

When reporting work:

1. State what changed and why.
2. List touched areas by responsibility.
3. List validations run and results.
4. Call out risks, assumptions, and anything not validated.
