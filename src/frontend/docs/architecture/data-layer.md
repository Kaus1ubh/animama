# Data Layer Guide

The web app uses generated OpenAPI client methods plus TanStack Query.

## Generated client

Generated files live in `src/frontend/packages/runtime-contracts/src/generated`.
Do not hand-edit this directory. Consumers import `@animama/runtime-contracts/sdk`
for methods and `@animama/runtime-contracts/api-types` for types. `pnpm openapi-ts` asks the backend's deterministic offline exporter
to write a temporary schema, generates from that file, and always removes it.
Public HTTP OpenAPI routes are disabled. The former server-side
starter SDK was deleted with auth-triggered onboarding.

The generated client exposes infrastructure-only Content Catalog operations,
typed product List/Get/Save/Preview methods, package import/export,
registered-file delivery, typed Anima loadout commands/runtime closures,
Avatars, appearances, and the rest of the product API. Gesture, Reaction,
effect, sound, idle, music, Avatar, Appearance, and voice hooks consume their
generated discriminated contracts while retaining the one catalog item
identity underneath.

Phase 5 also generates `AnimaSpec`, strict direct creation/options/validation,
backend starter ensure/repair, and Avatar portrait Save contracts. Direct
`POST /v1/animas` no longer accepts the old Avatar-only payload. Creation retries
must reuse the complete frozen spec and body idempotency key; replay resolves
before revalidating current sources. Typed preview responses expose the complete
creation-compatible `expected_source_revisions` map, including supports; it is
revision evidence, not a preview or runtime pin.

Phase 7 adds generated `resolveContentEvidence` and `prepareContentPreviews`
methods. The former is a metadata-only batch read; the latter creates one
ephemeral protected-file lease for a successful root union. They remain
separate so a revision refresh cannot acquire files or write preview state.

`query/hooks/useAnimaCreation.ts` owns owner-scoped typed source/options reads,
Local Avatar/Appearance Save, exact protected preview, whole-draft validation,
and strict creation. Step components call these adapters rather than fetching
the backend directly. The creator freezes and durably saves its command before
dispatch; mutations never automatically retry or run on mount. Unknown outcomes
replay before any mutable-source read. Shared preview metadata uses its own
query cancellation signal; prepared bytes are consumer-owned. Onboarding uses
the generated starter-only SDK, and the bulk route is removed.

Actions-to-Review sends one evidence request containing all unique selected
roots and fixed Idle, applies nothing from a partial response, compares prior
support evidence, then calls whole-spec validation. It does not issue typed
previews. `useActionComponentPreviews` instead keys one bundled preparation by
owner and the canonical unique component-source set. Repeated aliases map to
the same closure locally; focus/reconnect renew only a lease already near
expiry.

## Typed loadout queries

`useAnimaLoadout` owns the server-composed typed loadout read model.
`useAnimaLoadoutMutations` exposes Gesture, Reaction, Idle Style, Music Track,
Avatar, Appearance, and voice plan/commit commands. A plan carries the current
optimistic revision and typed intent; commit repeats it with the reviewed plan
digest and idempotency key. Successful mutations narrowly invalidate the
affected Anima's loadout and next runtime mount. Pose Clips, VFX, and SFX have
no direct equipment mutation.

`useAnimaRuntimeCatalog` loads one exact closure descriptor.
`AnimaRouteProviders` prepares every admitted byte once, verifies size/digest,
creates mount-scoped object URLs, freezes the resulting revision, and passes
that same revision to chat. It never silently retries a message against a newer
revision; `runtime_remount_required` preserves the unsent text and offers a
fresh Avatar-session mount.

After creation, `CreateAnimaCompletion` prepares one mount and seeds the same
runtime query key. The owner/revision-scoped `creationRuntimeHandoff` lease
lets `AnimaRouteProviders` claim those prepared bytes instead of preparing them
again. Unclaimed offers expire; released leases dispose after StrictMode effect
replay. Runtime failure never retries creation or creates a Chat row.

## Private file delivery and previews

Browser runtime code receives registered FastAPI file URLs and never a host
storage locator. `VerifiedByteLoader` fetches each admitted member through the
same-origin application route, checks its declared size and digest, and hands the bytes
to `RuntimeMountPreparer` or `PreviewByteSession`. Images, VRMs, VRMAs, JSON,
and audio become mount-owned Blob URLs or decoded resources. Runtime playback
does not perform another API capability exchange or typed-content fetch.

Typed preview hooks resolve deliberate Included or Local catalog items into
short-lived exact preview closures. Gesture and Reaction previews include their
complete effect and sound dependencies. The Action editor reuses a loaded
saved root closure initially and prepares one bundled lease only when its
dependency set changes. The Library Preview Dock and Anima
management stage own the existing Canvas; dialogs pass targets and callbacks
rather than mounting another WebGL renderer. Preview state never mutates the
Anima loadout or the live runtime catalog.

## API Configuration

`src/frontend/web/src/lib/api/configureAnimaApiClient.ts` configures the
generated client once during provider startup. It uses the current application origin
and trace context only. A browser-wide interceptor adds `X-Animama-CSRF: 1` to
same-origin mutating `/v1` fetches and never adds identity or desktop secrets.

Frontend env access should go through `src/frontend/web/src/platform/env.ts`.

## Query Conventions

- Query keys are owned by `@animama/product-ui/query`; the local `query/keys.ts`
  path re-exports them.
- Read hooks live under `src/frontend/web/src/query/hooks`.
- Mutations live under `src/frontend/web/src/query/mutations`.
- Use narrow cache invalidation or explicit cache updates after mutations.
- Keep server state in TanStack Query; keep transient runtime/UI state in
  Zustand stores.

## Packed product boundary

`@animama/product-ui` owns the existing Anima selection, chat session, SSE
classification, transcript, and composer primitives. It exports query hooks via
`/query`, session and pure stream helpers via `/chat`, presentation via
`/components`, and compiled `/styles.css`. The original local paths re-export
these implementations, so the ordinary application uses the packed core.

`ProductRuntimeProvider` takes an explicit `RuntimeOwner`, chat capability,
`ProductApiTransport`, and optional diagnostics adapter. The host provides a
TanStack `QueryClientProvider`; queries partition by owner and the generated
client is created separately for each transport. Changing owner or base URL
remounts the product subtree and aborts its previous session. No installation
readiness, local account policy, desktop bridge, router, or settings provider is
imported by the package. Runtime image URLs resolve against this transport and
keep owner-scoped Blob leases; they never assume the consuming page's origin.

The local `RuntimeOwnerProvider` adapts the ready installation principal to this
provider, supplies the same-origin application transport and trace headers, and keeps
browser-wide CSRF handling in the local composition. Local hooks outside the
extracted surface continue to use the neutral generated default client configured
by `configureAnimaApiClient.ts`. New shared hooks must take the provider's client.

## Local Runtime And Profile

`LocalRuntimeProvider` first calls `GET /v1/runtime-context`. A ready backend
does not need another content scan or defaults ensure. Only a `repair_required`
response triggers `POST /v1/runtime/bootstrap:ensure`; its returned context is
used directly without another GET. The provider shares concurrent initialization
requests but retains no completed-context cache. It exposes loading, ready, and
recoverable-error states; Retry makes a fresh context read and repairs only if
needed. Network/authorization failures are surfaced without issuing repair
mutations. Only a ready provider supplies `installation_principal_id` to shared
features through `RuntimeOwnerContext`. First-run state remains local to the
local composition.

`/` chooses `/setup` or `/a` from the backend's `first_run_complete` boolean.
Continue requires a nonblank private name and calls
`POST /v1/runtime/onboarding:complete`; repeating the request after a lost
response returns the completed context. `/a/` shares the owned Anima and user
settings queries, waits for both, and opens the remembered owned Anima or the
first in stable creation order. Desktop PiP
and quick-chat windows wait for readiness without rendering setup.

`useUserProfile` reads the minimal private profile and
`useUpdateUserProfile` writes its required nonblank display name; only the
pre-setup bootstrap placeholder may be null. Successful updates
publish the authoritative response under the principal-scoped profile query
key. There are no browser profile-ensure, username, creator-resolution, public
visibility, or account-session operations. Installation bootstrap and the
guarded `profile.md` preferred-name update belong to FastAPI.

## Chat Search

Sidebar chat search uses the generated `POST /v1/chats/search` client through
`useSearchChatMessages`. The modal keeps query text, pagination, and open/close
state locally because search results are transient navigation data rather than
cached chat state. It shares the user-scoped `useAnimas` list query to map each
result's `anima_id` to its lightweight display name and profile thumbnail,
instead of resolving one complete runtime catalog per result. The endpoint
paginates distinct chats, not individual message hits. Search rows show the
anima name under the avatar, show the matching message date beside the chat
title, and highlight matching query terms in snippets on the client by
rendering escaped text fragments as React nodes.

## Anima presentation and typed catalogs

`useAnimas` returns `PyAnimaListItem` rows. Management navigation and chat
search render the required bounded `presentation` projection and load private
thumbnails with `useAnimaPresentationImage`. That hook fetches protected local
bytes through the application origin, owns the Blob URL, and revokes it on change or
unmount. Built-in portraits load from same-origin
Included compatibility URLs. These surfaces never fetch a full runtime
snapshot or load a VRM merely to show a thumbnail.

Content family hooks call the typed product routes and adapt only at legacy
creator-view boundaries that have not yet been redesigned. They preserve
source, search, sort, and family-specific presentation while retaining the
catalog item ID used by Preview, Edit, and typed loadout commands. Included
entries are read-only; Local entries are ordinary editable files. Runtime
projection remains handler-owned on the backend, so frontend code does not
derive playable semantics from an arbitrary metadata dictionary.

## User Files

Installation-owned uploaded files use the generated `/v1/files` client methods plus
thin TanStack wrappers:

- `useUserFiles`: list current-user files and optionally poll while upload or
  processing state is active.
- `useInitUserFileUpload`: request a backend-generated file ID and private
  API-relative `PUT` target.
- `useFinalizeUserFileUpload`: mark atomically promoted local bytes durable
  after backend verification.
- `useProcessUserFile`: enqueue or reuse a processing job.
- `useDeleteUserFile`: delete/tombstone a file and remove its chunks from debug
  search.
- `useDebugSearchMemoryFiles`: run the AI memory-tool debug path over
  user-scope markdown memory.
- `useDebugUserFileSearch`: run keyword, semantic, or hybrid chunk search.

`useUserFileUpload` combines these mutations with Uppy. The browser PUTs the
original bytes through the application origin to FastAPI, which bounds and atomically
promotes them beneath `data/user-files`; server state is refreshed by
invalidating `queryKeys.userFiles`. Chat uploads send known backend `file_id`
values through `useChatSse` as `attached_file_ids`; the backend validates them
and exposes `search_uploaded_files` only for attached searchable uploads.

## Library source composition

The `/a/library` route presents family-specific views over the one catalog.
Gesture, Reaction, typed effect/sound, Idle Style, Music Track, and Avatar
hooks use their typed product responses while sharing stable catalog
identities.

`ActionManageDialog` reads every selected Anima's current catalog loadout and
equips or unequips the selected action against its exact revision with a
per-target idempotency key. Successful targets remain committed if another
target fails.

Chat Uploads remain separate through `useUserFiles({ pollActive: true })`;
polling runs only while upload or processing work is active. Creator Save calls
the matching typed product API. The backend stages and atomically replaces the
normal readable file or directory under `content/local`, validates it through
the kind handler, reconciles the changed entry, and returns its discriminated
typed response. Temporary upload targets never enter
TanStack Query, Zustand, route state, toasts, or telemetry.

Avatar and appearance previews use their registered catalog files through the
same preview-byte session. Live Appearance and Avatar changes invalidate their
loadout/runtime and revision-bearing Anima/identity views. Name or identity
edits refresh definition views without remounting runtime. Shared helpers
`invalidateAnimaDefinition` and `invalidateAnimaLoadoutAndRuntime` keep these
boundaries owner-scoped.

## Memory Entries

Markdown memory files and directories use generated `/v1/memory/entries`
methods wrapped by `useMemoryEntries`, `useMemoryEntry`,
`useMemoryEntryByPath`, `useCreateMemoryEntry`, `usePatchMemoryEntry`, and
`useDeleteMemoryEntry`. `useMemoryEntryVersions` wraps the newest-first
cursor-paginated history list, while `useMemoryEntryVersion` loads one exact
version's adjacent detail. Query keys are scoped under
`queryKeys.memoryEntries` by user, nullable `anima_id`, parent, path, entry ID,
and immutable version history.

The `/a/memories` page uses those hooks for user-scope markdown entries. Anima
details use the same hooks for the selected anima's `identity.md` editor route.
The shared editor keeps draft state local to the modal and saves with the
draft's `expected_version`. Anima identity responses also provide
`aggregate_revision`, captured as `baseAggregateRevision` and sent as
`expected_aggregate_revision` on saves and Revert. A name/equipment change can
therefore conflict even when the memory version is unchanged. The editor
detects `409`, refetches current state, and preserves a dirty draft and its
original guards until the user explicitly chooses latest state or overwrites
against freshly fetched guards. Clean drafts resynchronize automatically.

Generated Anima responses expose `display_name`, `aggregate_revision`, and
`identity_status`. `getAnimaDisplayName` uses live authority and never falls back
to editable Avatar metadata. Typed loadout plans fence the aggregate revision
inside their reviewed digest; existing plan/commit request shapes are retained.

Version-list pages contain content-free summaries and use `before_version` as
their cursor. Version detail is adjacent-only: selecting Version N asks the
backend for the immutable Version N snapshot, the N-1-to-N unified diff, and
structured path/description changes. Version 1 uses an empty Version 0
creation baseline. The query layer has no arbitrary two-version comparison or
history mutation method in this phase.

Memory-manager runs use generated `/v1/memory/episodes` and
`/v1/memory/manager` methods. `useMemoryEpisodes` fetches pending episode
counts for `/a/memories`; `useMemoryManagerRun`,
`useCreateMemoryManagerRun`, `useProcessMemoryEpisodes`,
`useAppendMemoryManagerMessage`, and `useDecideMemoryManagerApproval` wrap the
manager run/message/approval API.
Query keys live under `queryKeys.memoryEpisodes` and
`queryKeys.memoryManager`. Approval decisions update the returned run and
invalidate affected memory-entry state because an approved patch is an
authoritative backend write.

## Streaming

Normal chat SSE is implemented by `useChatSse`. It is a mutation-style runtime
transport for `POST /v1/animas/{anima_id}/chat:sse`, not a normal cached
query. Route and chat code should coordinate stream lifecycle through
`useChatSession`.
