# Common web composition and hosted artifact contracts

This is the A1 contract handoff for [#272](https://github.com/raymond-van/animama/issues/272).
The shared capability schema and TypeScript interfaces are implemented; application
composition, resource delivery and artifact production follow in A2–A5. The
[coverage map](../docs/plans/hosted-web-parity/hosted-web-parity-coverage.md) assigns
all retained actions. A consumer implements these contracts without importing
local routes, installation state or a sibling checkout.

## Admission and browser lifetime

`ProductRuntimeComposition` in `@animama/runtime-contracts` supplies one transport,
`readAdmission`, bounded idempotent `repair`, and optional account actions. An
explicit entrypoint chooses the adapter before React mounts. Shared routes never
choose authority from a deployment flag. The local adapter retains backend-owned
first-run onboarding; hosted account/profile actions belong to its account adapter.

`RuntimeAdmission` is renderable before product data is admitted: loading,
sign-in-required, ineligible, restricted, recovery or unavailable. Only `ready`
contains `RuntimeSession`, complete `RuntimeCapabilities` and onboarding state.
The adapter maps its service's existing wire states into this view; the view does
not create a new identity/session HTTP authority. Local `/v1/runtime-context`
remains local. Hosted admission uses `/v1/hosted/runtime-context`, repair uses
`POST /v1/hosted/bootstrap:ensure`, and `/v1/hosted/events` signals revoked authority.
Hosted login/callback/logout, session cookies, CSRF and central account URLs remain
consumer-owned HTTP behavior.

`RuntimeSession.key` changes on every admitted browser session lifetime, including
sign-out/reauthentication to the same owner. It is an opaque browser partition key,
not a bearer token, account ID or server owner selector. Owner changes, revoked
admission and sign-out abort active browser requests/streams and dispose query
caches, creator drafts, object URLs, runtime mounts/leases, workers, microphone,
playback, audio graphs and avatar state before a later session mounts. Durable
server operations keep authoritative receipts: disconnect/sign-out does not prove
rollback. A pending or ambiguous commit is recovered by its operation identity.

Account actions provide sign-in, Cloud-scoped sign-out, account access and usage.
`RuntimeUsage` contains named user-facing used/limit/reset units; provider prices,
credentials, arbitrary endpoints and dispatch permission are never browser inputs.
Restriction/outage state and quota request errors preserve private saved data.

## Capabilities and requests

The sole wire schema is `app/contracts/runtime_capabilities.py`, exported offline
in `local-http` version **3.0.0** with capability `schema_version: 2`. The generated
TypeScript `RuntimeCapabilities` and validator are the same contract.
`ProductRuntimeCapabilities` is a derived `Pick` for the existing extracted chat
surface, not another wire schema. Both affected TypeScript packages are version
0.3.0. Consumers explicitly admit the new contract major before adoption.

Permissions are separate from browser support and temporary errors:

| Operation | Canonical permission | Hosted target |
| --- | --- | --- |
| Chat and operator-catalog model/role choice | `chat`, `model_selection`, `model_role_selection` | Retained; roles may select only admitted models. |
| Anima creation and Anima-containing package import | `anima_creation` | False; creation-equivalent imports reject atomically before installing content. |
| Chat attachment entry points, paste/drop and file APIs | `chat_file_uploads` | False; staged creator media is a separate retained API family. |
| Document ingestion/OCR | `user_file_processing.enabled` | False; no processing enqueue or document originals route is admitted. |
| Model connections/catalog administration and keys | `model_configuration`, `provider_credentials`, `web_search.configuration` | False; catalog/role reads and selections remain retained. |
| Host paths, scans, file logs and server model installation | `local_filesystem_administration` | False; virtual memory paths, creator assets and browser model downloads remain retained. |
| Electron/native controls | `native_features` | False; browser fullscreen/PiP use browser feature detection. |

`offline_speech_enabled` and its versions describe current Parakeet availability,
not permission to use voice. An absent optional set does not remove browser voice,
Pocket TTS, supported server speech, or the workflow to download a permitted set.
Content, avatar/effect runtime, memory, creators and voice stay retained without
adding blanket permissions for implementation gaps. Unknown/missing capability
responses keep hosted operations pending rather than granting permission. No
frontend flag replaces server admission.

Each SDK call uses its injected client/transport. The legacy default client is
configured only by an entrypoint adapter, never by reusable packages. All browser
API, SSE, byte and model requests stay on the application origin with cookies and
the composition's mutation CSRF header. Owner IDs in cache keys/URLs are never
trusted authority. Errors retain existing route contracts, including conflicts,
revision drift, policy limits and structured provider errors. `chat:sse` preserves
sanitized events and exactly one terminal `run.completed` after admitted success
side effects. Stop/cancel is bounded; uncertain provider billing stays accountable.
All nested provider/tool/title/compaction/search/embedding/MM/Reflection/speech
work must reserve before dispatch and settle measured or uncertain units.

Private bytes, runtime snapshots, jobs, creator/import stages, exports and event
cursors resolve the current server owner on every read/mutation. Cross-owner
references fail closed. Runtime revisions retain lease/integrity checks and
same-origin range semantics; private data is `Cache-Control: no-store` and never
enters a shared CDN/service-worker cache. Content-only package import/export,
Anima export, stale revisions, drafts and ambiguous-commit recovery retain their
existing receipts and error semantics. Anima import is denied regardless of UI.

## Static application format (A5 producer / consumer contract)

Package-set format **2** retains the format-1 source/build/packages/contracts
fields and adds exactly one `applications` record. Format-1 verification remains
supported; a format-1 set cannot establish whole-app parity. The new record names
`animama-hosted-web`, its app version, tar filename, size and SHA-256. The normal
identity is `sets/v2/<source-commit>/<canonical-manifest-sha256>/`; dirty rehearsals
use the existing development identity and cannot be promoted. `SHA256SUMS` includes
the app archive. All provenance and payloads bind the same exact tracked snapshot.

The tar contains only regular files rooted at the app directory: `index.html`,
`app-manifest.json`, build output and notices. Reject links, absolute/encoded paths,
empty/dot/parent segments, duplicate members, unknown files, size/hash drift and
unsupported manifest/contract versions before serving. Archive extraction is
bounded and verifies the complete inventory before atomically selecting a build.
No source maps, development test assets, `.env`, private accounts, keys, upload
bytes or host paths belong in it. No Cloud build reconstructs product routes.

`app-manifest.json` version **1** records `source_commit`, `app_version`,
`entry_document`, `backend_contracts` (explicit inclusive minimum/exclusive maximum
major bounds), `files`, `lazy_resources` and `notices`. The manifest does not hash
itself; its archive hash binds it. Every other file appears once with relative
`path`, `sha256`, `size`, explicit `mime_type`, `cache` (`revalidate` or `immutable`)
and `range` (boolean). `entry_document` is `index.html`; referenced entry/chunk,
worker, CSS, font, image, audio and WASM files must exist in the inventory. Only
fingerprinted build files or hash/version-bound resources gain immutable caching;
HTML revalidates. API/missing-resource requests never fall back to HTML.

Resource decisions for the full app:

| Resource | Delivery and integrity |
| --- | --- |
| Entry, chunks, workers, CSS/fonts/icons and reviewed small runtime art | Shipped in the closed app inventory; Vite dependencies and notices retained. |
| Existing 21-file browser speech runtime | Preserve every pinned engine/model variant from `models/browser-runtime/manifest.json`. Ship verified engine/runtime and baseline Pocket/Smart Turn bytes; fetch model bytes only when voice requests them. A hosted build may not pass by silently omitting its speech models. |
| Optional Pocket voice/language sets, cloning encoder and Parakeet CPU/WebGPU | Fixed, versioned lazy resource descriptors from the existing model manifests; separately admitted public model bytes from the application origin. Retain the browser download/readiness flow; no user-triggered global server install or arbitrary download URL. |
| Included avatars, loadouts, appearances/effects and content dependencies | Consumer catalog/runtime services supply reviewed immutable source versions and authenticated manifests/bytes. No blanket copy of development `content/included` into the static app. Required starter behavior is verified separately. |
| Owner VRM/image/audio/samples, drafts, exports and previews | Account-owned service bytes outside the static inventory and shared caches; ownership, quota, validation, leases and cleanup remain server-enforced. |

A `lazy_resources` entry identifies the fixed resource ID, version, manifest
SHA-256, same-origin route prefix and notice paths. It must resolve only the exact
manifest's regular files; absence is visible readiness/download state, never a
substitute engine. Optional resources are not automatically loaded at startup.
A5 binds the referenced manifest/notice bytes in the app artifact. C1/C5 supply
an admitted resource catalog and capacity evidence; publication rights are a
separate gate from a valid checksum.

The consumer reviews MIME, `nosniff`, single-range/If-Range, ETag/HEAD, cookie/CSRF,
CSP worker/media/image/font/connect sources and WASM requirements against these
inventories. Public immutable resources and private no-store bytes have distinct
cache policies. CSP never permits arbitrary provider origins or executable
uploads. Independent artifact fixtures verify route navigation, dependency
closure and hostile manifests without a Cloud checkout. C7 additionally proves
real providers, physical audio and hosted tenancy against the selected release.
