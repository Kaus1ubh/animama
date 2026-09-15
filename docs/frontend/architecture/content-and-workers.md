# Content And Browser Workers

Portable playable content lives under `content/included` and `content/local`.
The browser does not own a duplicate content inventory and does not infer
playable files from root-relative public URLs. It queries the neutral Content
Catalog and prepares protected registered bytes for preview or a mounted Anima.

## Vite application resources

`src/frontend/web/public` remains the correct home for browser-engine and UI
resources that are part of the web application rather than portable content,
including:

- ONNX models and ONNX Runtime support files;
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

Do not add public aliases for an Avatar, Gesture, Reaction, effect,
sound, music track, Appearance, or other catalog item. All playable Included
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
atomic writes, and catalog reconciliation. There is no browser-to-object-store
PUT, presign step, finalize projection, immutable release, or cleanup worker for
creator content.

## Runtime preparation

Preview uses a `PreviewByteSession`; mounted chat uses
`RuntimeMountPreparer`/`PreparedRuntimeMount`. Both fetch protected registered
files, verify size and SHA-256, and create ephemeral Blob URLs. Preview and
runtime sessions are separate. Playback consumes prepared bytes and performs no
later typed-content request after readiness.

The browser does not persist content in Cache Storage, IndexedDB, or OPFS.
Ordinary HTTP cache entries and in-memory prepared resources are disposable and
never part of backup or package export.
