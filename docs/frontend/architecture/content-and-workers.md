# Content And Browser Workers

Portable playable content lives under `content/included` and `content/local`.
The browser does not own a duplicate content inventory and does not infer
playable files from root-relative public URLs. It queries the neutral Content
Catalog and prepares protected registered bytes for preview or a mounted Anima.

## Vite application resources

`src/frontend/web/public` remains the correct home for browser-engine and UI
resources that are part of the web application rather than portable content,
including:

- PocketTTS workers and audio worklets;
- Basis/transcoder support;
- fonts and UI images;
- authoring-engine templates/textures that are not independently shareable
  product content.

Large files may use Git LFS. On a fresh checkout:

```bash
git lfs install
git lfs pull
```

Speech engine payloads use a separate verified input path. The tracked
`models/browser-runtime/manifest.json` is the authoritative inventory of baseline
Pocket TTS/Smart Turn model-store inputs and exact ORT/VAD dependency files. Vite
verifies their sizes and SHA-256 hashes before serving or building; it does not
fetch model inputs implicitly.
Worker-relative imports and all reviewed ORT variants remain available.

Development serves those verified sources without a duplicate public payload
tree. Production and embedded-desktop builds copy the exact inventory into
`dist/onnx`; preview and the desktop audit verify the built inventory independently
of the developer store. These required distribution copies remain local to the
artifact and retain their notices. Parakeet is kept outside the web build:
packaged desktop and built self-host download it as backend model assets. See [shared model setup](../../backend/operations/model-assets.md)
for acquisition, platform-specific storage, offline reuse and cleanup.

Legacy operator-supplied catalogs at
`/onnx/models/pocket-tts/animas/<safe-id>_voices.bin` remain separate optional
inputs under `web/public`, using letters, digits, `_` or `-` for the ID. Vite
serves only existing regular files at those paths and preserves their build
copies; missing catalogs return 404. They are not hash-approved engine assets
or members of the baseline engine manifest. Normal uploaded catalog URLs are
unaffected.

Do not add public aliases for an Avatar, Gesture, Reaction, effect,
sound, Appearance, or other catalog item. All playable Included
and Local entries need registered file facts and protected catalog/preview/
runtime delivery.

Hosted builds address application resources under the immutable
`/_animama/static/<digest>/` prefix. Use `publicResourceUrl` from
`web/src/lib/resource-urls.ts` for build-owned resources and
`optionalModelResourceUrl` for a model's manifest-bound lazy prefix. Local builds
retain their existing root-relative paths. Optional manifests and notices ship
with the application; optional model bytes require separate verified provisioning.
Neither helper turns private catalog or API bytes into static resources. The
[hosted artifact contract](../../../contracts/hosted-web.md#static-application-format-a5-producer--consumer-contract)
owns the closed inventories, MIME/cache/range behavior and worker CSP.

## Included content

The readable source of truth is `content/included`. The backend scans it using
the same Content Kind registry as Local files. Included avatar portraits are
Appearance entries under
`content/included/appearances/avatar-portraits`; metadata associates each
portrait with its Avatar model. No generated frontend or backend JSON catalog
duplicates playable content. The hosted artifact packages a source-bound Included
seed separately from its static allowlist. The consumer verifies and admits this
seed through the neutral catalog; playable bytes retain protected delivery.

`src/backend/animama/resources/starter-loadout.v1.json` is selection policy for
new Animas, not a byte catalog. It refers to content identities resolved through
the neutral catalog.

## Browser workers

Bundled workers live in `src/frontend/web/src/workers`. Workers that must be
fetched by URL live under `web/public`; their client/protocol belongs near the
owning runtime module under `web/src/lib` or `web/src/hooks`.

Dependencies imported only by a lazily requested worker must appear in Vite's
`optimizeDeps.include` when first-use optimization would otherwise reload the
page. Worker input remains bounded and is disposed with its preview or runtime
session.

Creator Save sends bounded files and an optional descriptor through the admitted
API transport. Shared services perform authoritative hashing, type validation,
atomic publication and catalog reconciliation through the composition's storage
ports. Local persistence retains its filesystem atomicity.

## Runtime preparation

Preview uses a `PreviewByteSession`; mounted chat uses
`RuntimeMountPreparer`/`PreparedRuntimeMount`. Both fetch protected registered
files, verify size and SHA-256, and create ephemeral Blob URLs. Preview and
runtime sessions are separate. Playback consumes prepared bytes and performs no
later typed-content request after readiness.

Prepared playback bytes are ephemeral and never part of backup or package export.
Local creator recovery may persist drafts; hosted private recovery is fenced to
the admitted session and removed on sign-out or revocation. Identifier-only
operation receipts support authoritative server recovery after reentry. Immutable
application/model caches are separate from private content, which must not enter
a shared HTTP or service-worker cache.
