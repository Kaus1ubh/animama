# Hosted web parity coverage

Inventory source: `339878dd81bea806359e4375732070e7745ec03d`, audited on 2026-10-05.
Product authority: [#272](https://github.com/raymond-van/animama/issues/272); requirements
refer to the [spec snapshot](hosted-web-parity-spec.md). Contract handoff:
[common web contracts](../../../contracts/hosted-web.md). Paths below are repository-relative.
A1 verifies contract/schema fixtures only. Retained workflow, browser/audio and
actual hosted evidence remains pending in its assigned phases. Missing services
are delivery gaps, never additional exceptions.

## Contract handoff and concrete gaps

Use the existing Python `RuntimeCapabilities` as the single wire schema and generated TypeScript view. A1 adds the keys `chat`, `model_selection`, `model_role_selection`, `provider_credentials`, `local_filesystem_administration`, `native_features` are sufficient for the current six exclusions alongside existing `anima_creation`, `chat_file_uploads`, `user_file_processing.enabled`, `model_configuration`, `web_search.configuration`. Retained content/voice/memory workflows do not need a new family of permission booleans. Browser support/engine resource readiness and temporary failures must remain distinct from operation permission. `native_features` describes composition permission, while existing runtime-platform detection still proves actual bridge support; hosted is a web platform, not a third browser implementation.

- `packages/runtime-contracts/src/index.ts`: `ProductRuntimeCapabilities` is now the derived `Pick<generated RuntimeCapabilities, 'chat'>`, with one canonical wire schema. Keep opaque owner ID separate from session lifetime/cache key. Shared composition types can expose `RuntimeAdmission`, admitted `RuntimeSession`, transport, retry/onboarding and optional account/usage/sign-out actions without Cloud imports or browser token/owner authority.
- `web/src/app/runtime/RuntimeOwnerContext.tsx`: hardcodes `{chat:true}`, origin transport and telemetry-wrapped global fetch. Accept neutral composition inputs rather than interpreting local/hosted mode. `packages/product-ui/src/runtime/ProductRuntimeProvider.tsx` currently keys by owner ID+base URL only: same-account revocation/re-admission needs distinct lifetime key and disposal.
- `web/src/app/providers/AppProviders.tsx`, `web/src/app/router.tsx`, `web/src/routes/_app.tsx`: directly mount/use LocalRuntimeProvider; module-level API initialization and query client live beyond an admitted owner. A3 must inject readiness and ensure no product queries mount before admission. `main.local.tsx` retains local marker interception; hosted must never import/install it.
- `web/src/lib/api/configureAnimaApiClient.ts`: configures the default generated client globally once; the web query layer mostly omits an explicit client. A3 must route ALL SDK and direct private-byte/stream calls through the admitted transport, not merely product-ui's scoped client. Do not globally send arbitrary owner headers or browser bearer credentials.
- `web/src/ui/app/RuntimeFeatureGate.tsx`: missing/unreadable capability currently means enabled. The A1 contract requires an unadmitted or capability-unresolved hosted app to withhold product actions; retain meaningful unavailable messages. UI gates never replace server denial.
- `web/src/ui/settings/models/model-configuration-state.ts:473`, `web/src/ui/sidebar/ApplicationSettingsModal.tsx:430`: model defaults/roles and connection administration share `model_configuration`; split role/choice visibility from administration. Existing connection IDs and discovery/probe settings remain operator-owned; selected catalog model/voice IDs are user preferences.
- `web/src/ui/library/LibraryPage.tsx`: `chat-uploads` section remains present, including direct query-string selection; `ContentHealth` mounts host scan/repair actions. Gate only excluded operations; preserve validation/readiness/preview failure states and ordinary content edits. `query/hooks/useLibrarySharingFlow.ts` admits imported Anima results without a creation capability; reject Anima packages before install, atomically, while content ZIPs and Anima export remain.
- `web/src/ui/main/chat/ChatInterface.tsx:487`: uploader hook is still instantiated even if its UI is withheld. Selected/uploaded IDs are collected later; test capability transition and direct submit, paste/drop, existing-file selection, not only hidden attach button. Existing gate does suppress visible uploader/drop overlay/tray and disables user-file query when false.
- Existing Anima details route gates only the optional Create button, correctly preserving identity/memories/emotions/loadout/settings. No current frontend Anima deletion action was found; do not invent one. Backend deletion remains a lifecycle/empty-state requirement; no last-Anima resurrection or forced creation link.

## Every route file

TanStack IDs include pathless `/_app`; user-facing paths omit that segment. Generated router output is regenerated, never hand-edited.

| Source under web/src/routes | Route ID | Hosted disposition |
| --- | --- | --- |
| `__root.tsx` | `(root)` | Retain shared layout; inject neutral admission/session |
| `_app/$animaId/c/$chatId.tsx` | `/_app/$animaId/c/$chatId` | Retain same screen, actions and route semantics |
| `_app/$animaId/index.tsx` | `/_app/$animaId/` | Retain same screen, actions and route semantics |
| `_app/$animaId.tsx` | `/_app/$animaId` | Retain same screen, actions and route semantics |
| `_app/animas/$animaId/identity.tsx` | `/_app/animas/$animaId/identity` | Retain same screen, actions and route semantics |
| `_app/animas/$animaId.tsx` | `/_app/animas/$animaId` | Retain same screen, actions and route semantics |
| `_app/animas/index.tsx` | `/_app/animas/` | Retain same screen, actions and route semantics |
| `_app/animas.new.tsx` | `/_app/animas/new` | E1: disable action and direct deep link with explanation |
| `_app/animas.tsx` | `/_app/animas` | Retain same screen, actions and route semantics |
| `_app/avatar-effects/index.tsx` | `/_app/avatar-effects/` | Retain current redirect/deep-link behavior |
| `_app/avatar-effects.$avatarEffectId.edit.tsx` | `/_app/avatar-effects/$avatarEffectId/edit` | Retain same screen, actions and route semantics |
| `_app/avatar-effects.new.tsx` | `/_app/avatar-effects/new` | Retain same screen, actions and route semantics |
| `_app/avatar-portrait-debug.tsx` | `/_app/avatar-portrait-debug` | Development diagnostic only; retain existing production guard |
| `_app/create.tsx` | `/_app/create` | Retain same screen, actions and route semantics |
| `_app/gestures.$gestureId.edit.tsx` | `/_app/gestures/$gestureId/edit` | Retain same screen, actions and route semantics |
| `_app/gestures.new.tsx` | `/_app/gestures/new` | Retain same screen, actions and route semantics |
| `_app/idle-styles.$idleStyleId.edit.tsx` | `/_app/idle-styles/$idleStyleId/edit` | Retain same screen, actions and route semantics |
| `_app/idle-styles.new.tsx` | `/_app/idle-styles/new` | Retain same screen, actions and route semantics |
| `_app/index.tsx` | `/_app/` | Retain selected-Anima navigation; empty hosted roster must not redirect to creation or recreate deleted Anima |
| `_app/library.tsx` | `/_app/library` | Retain same screen, actions and route semantics |
| `_app/memories.tsx` | `/_app/memories` | Retain same screen, actions and route semantics |
| `_app/particle-effects.$particleEffectId.edit.tsx` | `/_app/particle-effects/$particleEffectId/edit` | Retain same screen, actions and route semantics |
| `_app/particle-effects.new.tsx` | `/_app/particle-effects/new` | Retain same screen, actions and route semantics |
| `_app/poses.$poseId.edit.tsx` | `/_app/poses/$poseId/edit` | Retain same screen, actions and route semantics |
| `_app/reactions.$reactionId.edit.tsx` | `/_app/reactions/$reactionId/edit` | Retain same screen, actions and route semantics |
| `_app/reactions.new.tsx` | `/_app/reactions/new` | Retain same screen, actions and route semantics |
| `_app/scene-effects/index.tsx` | `/_app/scene-effects/` | Retain current redirect/deep-link behavior |
| `_app/scene-effects.$sceneEffectId.edit.tsx` | `/_app/scene-effects/$sceneEffectId/edit` | Retain same screen, actions and route semantics |
| `_app/scene-effects.new.tsx` | `/_app/scene-effects/new` | Retain same screen, actions and route semantics |
| `_app/sound-effects.$soundEffectId.edit.tsx` | `/_app/sound-effects/$soundEffectId/edit` | Retain current redirect/deep-link behavior |
| `_app/sound-effects.new.tsx` | `/_app/sound-effects/new` | Retain current redirect/deep-link behavior |
| `_app.tsx` | `/_app` | Retain shared layout; inject neutral admission/session |
| `a/$.tsx` | `/a/$` | Retain current redirect/deep-link behavior |
| `a.tsx` | `/a` | Retain current redirect/deep-link behavior |
| `desktop/pip/$animaId.tsx` | `/desktop/pip/$animaId` | E6: native route unavailable hosted; retain browser PiP/fullscreen elsewhere |
| `desktop/quick-chat/$animaId.tsx` | `/desktop/quick-chat/$animaId` | E6: native route unavailable hosted; retain browser PiP/fullscreen elsewhere |
| `safety.tsx` | `/safety` | Retain same screen, actions and route semantics |
| `setup.tsx` | `/setup` | Composition onboarding: local setup retained; hosted admission replaces local bootstrap |

## Screen/action coverage groups and implementation assignment

Paths in the Source column are under `src/frontend/` unless marked backend.
Each row covers the named actions, including alternate entry points. Shared APIs
and use cases are Animama-owned; hosted HTTP authority, repositories and jobs
are consumer-owned. A2 supplies the missing neutral interfaces. All row evidence
is **pending** beyond the A1 canonical capability fixture. Route rows inherit the
workflow assignment/API/test below: chat routes → W02, Anima routes → W03/W04,
creator routes → W07, Library → W06/W08, Memory → W09, shell/index/legacy → W01,
setup/account → W12, native/browser utilities → W13, Safety → W11. The portrait
diagnostic preserves its existing development-only guard (W14). A3 owns neutral shell/transport and exact exception UI. A4 owns retained feature and lifetime verification. A5 owns static/resource artifact closure. Public fixture evidence is not real hosted acceptance.

| Group | Retained actions; narrow exclusion | Source / API contract consumers | Assignment / requirements / evidence |
| --- | --- | --- | --- |
| W01 Shell and navigation | New chat, Animas, Memory, Library, Search; Create menu; recents; account/settings dialogs; deep links; keyboard/responsive layout; preview dock | `web/src/ui/sidebar/{SidebarShell,SidebarUserMenu,SidebarCreateMenu}.tsx`; router and root layouts | A3+A4; R1–R5,R12; admission/action fixture + real browser later |
| W02 Chat/history/search | Create/select/rename/delete chats; search; streamed text/tool updates; stop/retry; Markdown; chat/avatar layouts; operator-catalog model selection; attachment button/paste/drop/reuse/IDs excluded | `web/src/ui/main/chat/{ChatInterface,useChatSession}.tsx` (hook is `.ts`); `query/hooks/useChat*`; `query/mutations/{useCreateChat,useChatSse,useSearchChatMessages}.ts`; `/v1/chats`, `/v1/animas/{id}/chat:sse` | A2+A3+A4; R1–R5,R7,R9,R12 |
| W03 Existing Anima identity | Select/adjacent Anima; identity/profile and relationship memory editor/repair; emotions; settings inheritance; image/background upload/crop/framing; no user creation/import equivalent | `web/src/ui/animas/{AnimaDetailsPage,AnimaIdentitySection,AnimaMemoriesSection,AnimaAppearanceDialog}.tsx`; `query/mutations/useUpdateAnima*`, `useRepairAnimaMemories` | A2+A3+A4; R1–R7,R10,R12 |
| W04 Loadout | Choose avatar, voice, gestures, reactions, idle style; preview, plan/review/commit, stale-revision recovery | `web/src/ui/animas/{AnimaLoadout,VoiceLoadoutSection}.tsx`; `query/hooks/useAnimaLoadout.ts`, `query/mutations/useAnimaLoadoutMutations.ts`; family plan/commit contracts | A2+A4; R4–R10,R12 |
| W05 Live companion and preview | VRM/portrait, gesture/idle/emotion/expressions, lip sync, camera/canvas controls, avatar/particle/scene effects, sound; distinct Library/creator/Anima stages | `web/src/ui/app/AnimaRouteProviders.tsx`; `ui/content-preview/`; `lib/runtime-content/`; `ui/main/`; `ui/sound/SoundProvider.tsx` | A2+A4+A5; R4,R5,R7–R12; real playback required later |
| W06 Library/catalog | All/avatars/actions/fx; search/filter; thumbnails; validation; customize/edit/delete; equipped-content handling; preview and selections; only chat uploads and host scan/repair excluded | `web/src/ui/library/{LibraryPage,LibraryContentInventory,LibraryChatUploads}.tsx`; `ui/content-health/ContentHealth.tsx`; `query/hooks/useContentCatalog.ts`; catalog/items/files, typed family APIs | A2+A3+A4; R1–R5,R9,R10,R12 |
| W07 Creators | Create hub; Gesture/Pose/Clip, Reaction, Idle Style, Avatar/Particle/Scene effects; sound upload/edit; Save/Save & Equip; imported assets, review, dependency resolution, discard/recovery | `web/src/ui/{gesture-editor,pose-editor,pose-creator,reaction-editor,creator,avatar-effect-creator,particle-vfx-creator,scene-effect-creator}/`; content/appearance mutation hooks | A2+A4; R1,R4,R5,R9,R10,R12; Pose new is in Gesture editor, sound route redirects Library; no new standalone music feature |
| W08 Sharing | Content ZIP/creator formats import/export; selection/review/collision handling/install/export download/retry/discard/recovery; Anima export kept; Anima package import rejected atomically | `web/src/query/hooks/useLibrarySharingFlow.ts`; `query/mutations/packageSharingApi.ts`; `lib/content-sharing/` | A2+A3+A4; R3–R5,R9,R10,R12 |
| W09 Memory | Virtual files/folders; create/edit/move/rename/delete, preview/conflict/history/revert/search; identity/Anima scope; user-started Memory Manager/Reflection, episode processing/approvals/undo/run continuation | `web/src/ui/memory/`; `query/hooks/{useMemoryEntries,useMemoryEpisodes,useMemoryManagerRun}.ts`; memory mutation hooks | A2+A4; R4–R6,R9,R12; virtual files are NOT host filesystem administration |
| W10 Voice | Dictation, Voice Mode, device/test/sensitivity; STT/TTS engine/model/voice selection; cloning voice samples, playback/stop/mute; stream/finalized grouping; browser assets | `web/src/lib/voice/`, `lib/anima-voice/`; `ui/animas/VoiceLoadoutSection.tsx`; `ui/animas/VoiceCloneLibrary.tsx`; voice clone/selection hooks | A2+A4+A5; R4–R9,R12; separate browser engine downloads from server-global model administration |
| W11 Safety / behavior | Shared defaults and per-Anima inheritance; emotion/memory influence/updates, AI notice/reminder and crisis resource settings; preserve authority and memory semantics | `web/src/ui/settings/{SettingsProvider,SafetySettingsSection}.tsx`; `ui/main/header/AnimaSettingsModal.tsx`; safety providers/routes | A2+A3+A4; R4–R9,R12 |
| W12 Account and admission | Sign-in/out/account/usage actions; ineligible/restricted/loading/outage/expired sessions; resource teardown, safe retry; owner never chosen by browser | new neutral interfaces in existing `packages/runtime-contracts`; composition injection into existing shell | A1 contracts, A3 consumption, consumer owns auth; R1,R2,R5,R9,R12 |
| W13 Browser utilities | DOM fullscreen and Document PiP retained; native quick chat, native windows/global shortcut/updater/key vault excluded | `web/src/platform/runtime-platform.ts`; `web/src/hooks/{useFullscreen,usePictureInPicture,useDocumentPiP}.ts` | A3+A4; R1–R3,R5,R12 |

## Capability, consumer owner and acceptance map

All cases below remain pending workflow verification. A1's Python/generated schema
fixtures establish the six exception values and retained model/role choice only.

| Coverage | Capability / support | HTTP/service and consumer assignment | Acceptance evidence |
| --- | --- | --- | --- |
| W01 | Admitted session | Readiness/owner context and route adapter, A3; consumer foundation C1/C2 and cutover C6 | Deep-link/reload/sidebar/empty-roster browser fixture; `RuntimeOwnerContext.test.tsx` and planned admission tests. |
| W02 | `chat`; `model_selection`; E2 attachments false | `/v1/chats`, messages/search, `/v1/animas/{id}/chat:sse`; shared ChatService/executor A2; history C2 and bounded turn C3 | `chat-lifecycle.test.mjs`, `ChatUploadCapability.test.tsx`; two-account history, stop/retry, terminal SSE and nested usage. |
| W03 | Existing owner; E1 creation false | Anima PATCH/settings, memory identity/repair and appearance contracts; A2; C2/C4 | Existing identity/loadout suites plus save/reload/private-portrait/stale conflict browser cases. |
| W04 | Admitted catalog choices | Loadout GET and avatar/voice/gesture/reaction/idle/appearance plan/commit; shared services A2; C4/C5 | Preview/review/commit/conflict fixtures and equipped runtime after reload. |
| W05 | Browser WebGL/audio; current engine/assets | Runtime revisions/renew/json-bundle/bytes; content/runtime ports A2; C4/C5 | Existing mount/byte-loader suites; actual creator, Library and live-Anima playback measured separately in A4/C7. |
| W06 | E2 upload false, E5 host scans false; catalog retained | Catalog/items/typed-family preview/edit/delete; A2/A3; C4 | Catalog/content-edit tests, query-string attachment denial, retained content health/error recovery. |
| W07 | E1 only Anima creation false | Typed saves, preview, staging, uploads and save/equip; A2/A4; C4 | Each existing creator's save/import/discard/stale-revision/recovery tests and browser proof. |
| W08 | E1 Anima import false; content import and Anima export retained | Package allocation/inspection/review/commit/export/receipt APIs; ContentPackageService A2; C4 | Sharing suites plus atomic Anima-package denial before installing dependencies and ambiguous receipt recovery. |
| W09 | Logical paths; admitted owner/role choice | MemoryEntry/EpisodeService, MemoryManager/Reflection APIs A2; C2/C3 | Memory/version/conflict/approval-resume suites and two-account logical-path isolation; no physical memory roots. |
| W10 | Browser mic/WebGPU/WASM/secure context and engine readiness; E4 key false | Voice catalog/clone/content/STT/TTS/model resource interfaces A2/A4/A5; C5 | Dictation/TTS/clone unit suites plus heard output, physical mic, device/browser downloads and quota/cancel C7. |
| W11 | Safety authority + saved settings | User/Anima settings and safety/crisis APIs; A2/A4; C2/C3 | Inheritance/reset/reload and server guardrail tests, shared `/safety` page. |
| W12 | Admitted session, optional account actions | Composition adapter A3; consumer login/logout/account/quotas/events C1/C6 | State mapping, same-owner reauth/cross-owner teardown, no product data before readiness; C7 real lifecycle. |
| W13 | E6 `native_features=false`; browser support separate | RuntimePlatform and browser utility hooks A3/A4 | DOM fullscreen/PiP cases; unavailable native deep links/global shortcuts/update/key vault. |
| W14 | Existing development guard in both builds | Portrait/debug only; A3/A4 | Production direct navigation is notFound; ordinary portrait capture/edit remains W03. |

## Every App Settings entry/group

Authoritative list: `web/src/ui/sidebar/ApplicationSettingsModal.tsx` (search entry definitions).
Every settings row belongs to A3 visibility/composition and A4 persistence/browser
verification. Profile/settings use C2; model roles, search and safety use C3;
voice/resources use C5. App/account settings are owner-scoped, microphone/device
preferences browser-local. Existing `model-configuration-state.test.ts`, voice
download tests and SettingsProvider regressions are reused; retained settings
save/reload/reset and excluded search-result tests are required. Evidence is pending. These search-index rows also determine discoverability and may not retain links to excluded controls.

| Section | Entries | Hosted behavior |
| --- | --- | --- |
| General | `display-name`, `volume`, `feature-packs` | Keep profile/audio; feature packs native-only excluded |
| Models | `model-connections`, `default-chat-model`, `memory-manager-model`, `compaction-model`, `embeddings-model`, `web-search` | Keep all four role choices via catalog; exclude connection/provider/endpoint and search service admin; runtime web search retained |
| API Keys | `provider-keys` | Exclude key administration |
| About | `about-version`, `updates`, `open-logs`, `copy-diagnostics` | Keep applicable version and safe summary; exclude native updater/log folder |
| Appearance | `appearance-mode`, all basic/advanced `appearance-${token.key}`, `appearance-reset-colours`, `appearance-advanced-toggle` | Keep same controls and account preferences |
| Voice input | `microphone-device`, `microphone-sensitivity`, `microphone-test`, `stt-provider`, `stt-downloads` | Keep input controls/engine selection/browser resources; hide only server-global installation/removal; device preference browser-local |
| Voice output | `tts-enabled`, `tts-stream`, `tts-provider`, `elevenlabs-key`, `elevenlabs-model`, `elevenlabs-audio-grouping`, `voice-clone` | Keep all except key; preserve supported engine choices and voice sample upload/clone |
| Shortcuts | all `shortcut-${row.action}` | Existing settings are desktop global shortcuts only; excluded. Retain existing browser keyboard behavior elsewhere, no invented browser shortcuts settings |
| Memory & Emotion | `behavior-memory_influence`, `behavior-memory_updates`, `behavior-emotion_updates` | Keep app defaults and existing inheritance semantics |
| Safety | `safety` | Keep region/reminder settings; operator authority unchanged |
| Data | `reset-app-settings` | Keep account preference reset; preserve saved Animas/chats/memory/content and existing documented reset semantics |
| Advanced | `chat-markdown`, `avatar-transform-controls` | Keep both |

Locale/timezone are specified preference semantics; no standalone current searchable settings row was found. Do not invent a missing screen merely to match the inventory wording. Existing Anima Settings are only inheritable emotion updates, memory influence and memory updates.

## Resource lifetime and transport audit checklist

A session reset must abort streams, runtime preparation, uploads/jobs polling and in-flight SDK requests; stop audio/mic/voice; unmount PiP/preview/avatar; revoke object URLs and private leases; dispose workers/private caches and recovery copies. The session key cannot be only owner ID. Keep device preferences browser-local but prevent account private data surviving cross-account access.

Existing persistence to cover: `query/hooks/useLibrarySharingFlow.ts` + `lib/content-sharing/recoveryStore`; `lib/{avatar/vfx/editor,scene-vfx/editor}/recovery.ts`; `lib/content/{particleVFXRecovery,contentEditRecovery}.ts`; query caches and `stores/{avatar-runtime,avatar-lipsync-bridge,scene-vfx,pose-creator}-store`; model download coordination; voice worker lifetimes. Recovery stores already use owner IDs in several keys, which does not by itself prove sign-out cleanup.

Private bytes must be fetched/authenticated using the same admitted transport before verified blob/object URL playback. Inspect `lib/runtime-content/{VerifiedByteLoader,RuntimeMountPreparer,PreviewByteSession}`, `query/hooks/useRuntimeContentMediaUrl.ts`, `ui/library/ParticleThumbnail.tsx` (direct fetch), `lib/avatar/VRMDocument.ts` (direct fetch), stream/upload clients, and content worker initialization. Raw `Audio`, image/VRM/WebGL consumers need private blob URLs or admitted resource URLs, not invented bearer headers. Public static sound/font/model/WASM/worker resources have distinct immutable integrity/lazy-download metadata, not account-private ownership.

## Meaningful A1 tests and follow-on evidence

A1: canonical Python schema/local capabilities roundtrip and existing shared backend boundary; generated SDK freshness; package declaration compatibility. Contract fixture table must represent all six exclusions independently and retain model/role selection, content import, voice cloning and virtual memory. Admission tests must distinguish unauthenticated/ineligible/restricted/unavailable/ready; no private UI before ready; session key changes on authority lifetime change, retry and account actions remain adapters. A1 does not need to implement A3's UI cutover.

Useful existing suites: `tests/test_runtime_capabilities.py`, `tests/test_shared_backend_boundary.py`; `web/src/app/runtime/{RuntimeOwnerContext.test.tsx,runtime-boundaries.test.ts}`; `web/src/ui/app/RuntimeFeatureGate.test.tsx`; `web/src/ui/settings/models/model-configuration-state.test.ts`; `web/src/ui/create/AnimaCreationCapability.test.tsx`; `web/src/ui/main/chat/ChatUploadCapability.test.tsx`; package `chat-lifecycle.test.mjs`. Add behavior tests for direct Library chat-uploads query, package import Anima denial before install, empty roster, global-default-client injected transport, and same-owner session reset in their implementation phases.

Commands already in A1 plan: root `uv run pytest -q tests/test_runtime_capabilities.py tests/test_shared_backend_boundary.py`; frontend `pnpm openapi-ts`, `pnpm openapi-ts:check`, `pnpm packages:check`, `pnpm packages:test`. Source/fixture checks cannot satisfy subsequent real chat/mic/voice/VRM/playback/isolation/hosted acceptance gates.

## Additional hidden/action-level rows

- Library card and preview menus (`LibraryContentInventory.tsx:240–310,717–752`, `ContentPreviewHost.tsx`): Preview/replay/stop/loop, reset camera/move preview avatar; Manage sound; Edit; Add / Manage; Use in Gesture; Use in Reaction; Avatar Draft. All retained; only Create Anima withheld. A3 gates + A4 browser checks, R1–R4,R7,R10; evidence pending.
- Voice clone (`web/src/ui/animas/VoiceCloneLibrary.tsx:112–193,214–286`): upload/change sample, local encoding/install-required continuation, cancellation, retry without losing sample, save, delete, and separate rename mutation in `query/mutations/useVoiceCloneActions.ts`. Retain these account-owned content actions; browser encoder resources are not server-global model administration. A2+A4+A5 / consumer voice/content delivery; R5,R8–R10; evidence pending.
- Provider-generated audio contracts (`src/backend/animama/server/routers/elevenlabs.py`): `/v1/elevenlabs/voices/clone`, `/text-to-speech`, `/sound-effects`, `/audio-isolation`. Shared SDK presence is not current UI reachability. This pass found the browser clone UI uses Pocket typed content; `prepareElevenLabsCloneSourceAudio` exists but no active clone/isolation web caller was found. Classify existing service contracts separately: if admitted in hosted they require bounded provider work, attribution/idempotency/ownership and no user key administration; do not silently deny as document uploads or invent new UI. A2 contract audit + consumer provider quota work, R4,R5,R8,R9; evidence pending.
- Memory debug search (`web/src/ui/debug/UploadSearchDebugTools.tsx:69` -> `query/mutations/useDebugSearchMemoryFiles.ts`): currently imported only through `LibraryChatUploadsDebugPanel.tsx:205`, behind `__ANIMAMA_DEV_BUILD__ && DEBUG_ENABLED`; its memory probe is distinct from excluded document debug search. Preserve production dev exclusion; direct memory debug API still needs ownership/bounded execution if admitted. A2+A3/A4 boundary test; R3–R5,R9; evidence pending.
- Portrait diagnostic (`web/src/routes/_app/avatar-portrait-debug.tsx:8–15`): `beforeLoad` throws TanStack `notFound()` unless `DEBUG_ENABLED`. `web/src/platform/env.ts:24` requires all three: `__ANIMAMA_DEV_BUILD__`, `import.meta.env.DEV`, and VITE_ENABLE_DEBUG_PANEL true/1. It is absent as a production capability in BOTH builds, not a new hosted exception. In development the local VRM capture makes a 512x512 portrait locally with no Anima save/upload. A3 keeps existing guard; evidence pending.
- ContentHealth catalog validation/status must remain; scan/rescan/host repair buttons only excluded. About Copy diagnostics must retain its safe, non-private summary while Open logs/native updates are excluded. Both already listed above but need separate action rows in authoritative ledger. A3+A4; R1–R3,R5,R12; evidence pending.

## A1 evidence

Schema fixture: `contracts/runtime-capabilities/hosted.json` is validated by Python
and generated TypeScript, with all six exceptions and model/role selection retained.
Runtime permission fields are required; browser support and transient failures are
separate. Full action/browser acceptance is intentionally recorded in A2–A6/C2–C7.
No provider API call, hosted tenant test or physical audio evidence is claimed here.
