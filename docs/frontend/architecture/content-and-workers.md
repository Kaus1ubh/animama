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
`models/browser-runtime/manifest.json` records all 35 same-origin `/onnx/` assets:
24 Pocket TTS/Smart Turn files acquired into the shared model store, nine
ORT 1.24.2 files resolved from the exact dependency alias, and two VAD 0.0.30
files resolved from its pinned package. Vite verifies their sizes and SHA-256
hashes before serving or building; it does not fetch model inputs implicitly.
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
or members of the 23-file manifest. Normal uploaded catalog URLs are unaffected.

Do not add public aliases for an Avatar, Gesture, Reaction, effect,
sound, Appearance, or other catalog item. All playable Included
and Local entries need registered file facts and protected catalog/preview/
runtime delivery.

## Included content

The readable source of truth is `content/included`. The backend scans it using
the same Content Kind registry as Local files. Included avatar portraits are
Appearance entries under
`content/included/appearances/avatar-portraits`; metadata associates each
portrait with its Avatar model. No generated frontend or backend JSON catalog
duplicates playable content.

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

Creator Save sends bounded files and an optional descriptor directly to
FastAPI. The server performs authoritative hashing, type validation, safe
atomic writes, and catalog reconciliation.

## Runtime preparation

Preview uses a `PreviewByteSession`; mounted chat uses
`RuntimeMountPreparer`/`PreparedRuntimeMount`. Both fetch protected registered
files, verify size and SHA-256, and create ephemeral Blob URLs. Preview and
runtime sessions are separate. Playback consumes prepared bytes and performs no
later typed-content request after readiness.

The browser does not persist content in Cache Storage, IndexedDB, or OPFS.
Ordinary HTTP cache entries and in-memory prepared resources are disposable and
never part of backup or package export.
