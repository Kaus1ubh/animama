# Desktop runtime staging

Phase 1 provides build and audit tools; Phase 2 wires their output into
Electron's embedded service supervisor. Packaged builds no longer fall back to
an external web URL. `desktop:dev` still uses the local application stack unless the
explicit development runtime-root override is set. See [Overview](overview.md)
for lifecycle, credentials, and recovery.

For user installation and recovery use [Installation](installation.md) and
[Troubleshooting](troubleshooting.md). For initial manual publication after
signing/acceptance, use [Release process](release-process.md). This staging guide
describes build inputs and development evidence, not an available release.

## Native macOS build

Use an Apple Silicon Mac with Xcode command-line tools, `uv`, Node, and the
repository's pnpm installation. Dependency downloads require network access.
No Homebrew PostgreSQL, Docker reset, local account, or provider credential is
required. Run from `src/frontend`:

```sh
pnpm desktop:runtime:stage -- --platform darwin --arch arm64
pnpm desktop:runtime:audit -- --platform darwin --arch arm64
pnpm desktop:test -- runtime-packaging
```

The strict target parser rejects cross-builds and unsupported combinations before
deleting outputs or downloading dependencies. Windows native staging is gated
on Phase 5. `desktop:dist:mac` and `desktop:smoke:mac` now use the Phase 4
[signed-release gates](releases.md), including explicit Apple, inventory and
intended repository configuration. The repository may remain private for local
signed candidates; anonymous public access is checked only at publication.
Private pack/update URLs do not become usable in the app. Windows release/smoke commands still fail at
the Phase 5 gate. No command treats a shell-only package as a release.

After a successful stage and audit, `pnpm desktop:mac` copies the runtime into
`Animama.app/Contents/Resources/runtime`, outside ASAR. Its prebuild gate requires
the exact audited manifest/build ID and current main/preload closure, with no
stage-failure marker. Restage and reaudit after backend, supervisor, preload, or
web or migration changes. The consolidated frozen schema head is
`baseline_20260908`; an earlier component proof is not a substitute for a fresh
complete runtime stage. Old profiles and backups stamped with removed revisions
require their matching old app/checkout or an explicitly disposable fresh profile.
The stage probe uses disposable data; it does not reset an existing installation.
New artifacts use `animama-desktop-runtime/2` and `local_http_schema_version: 1`.
Stage and audit require the frozen backend to advertise the same local HTTP
schema. The JS audit rejects bundled Hono or retired frontend-server source.
Saved port/vault formats and the accountless database schema remain unchanged.
The development packager disables ad-hoc signing as well as certificate signing,
and rechecks every copied runtime file after electron-builder finishes. See
[Platform builds](platforms.md) for the unsigned output and report. Production
signing uses its separate nested-sign, inventory, and outer-seal sequence.
The FastAPI static responder must serve ONNX `.mjs` modules as JavaScript with `nosniff`;
having the file in the inventory is insufficient if Chromium rejects its MIME
type. Provider marks use local initials rather than fetching logos from a CDN.

Each staging pass clears only `desktop/.desktop-runtime/darwin-arm64`, then:

1. Resolves starter specifications and the full recommended typed dependency
   closure. Only tracked distribution inputs may enter the stage; optional
   portraits use the same presentation contract as installation bootstrap.
2. Builds pinned PostgreSQL 16.15 and pgvector 0.8.6 sources with portable arm64
   flags. The runtime retains required language, encoding, and text-search
   modules, but no headers, static archives, or development tools. Symbols stay
   in a separate output directory.
3. Freezes Python 3.12.13 and the locked server dependencies with PyInstaller
   6.22.2. The build environment is separate from the repository's `.venv`.
4. Builds Vite in `embedded-desktop` mode, without duplicate Included aliases.
   Removes the copied legacy `korone-pfp.png`, `marine-pfp.png`, and
   `gojo-pfp.png` files; the independent audit rejects their reintroduction.
   Their private development source files remain unchanged.
   All current PocketTTS, VAD, smart-turn, and ONNX variants remain. Ordinary
   `pnpm web:build` still writes the compatibility copies.
   This is a production build: application debug imports stay excluded even
   with `VITE_ENABLE_DEBUG_PANEL=true`. Retain `.vite/manifest.json` alongside
   the coherent SPA output; packaged FastAPI uses it to identify fingerprinted
   JS/CSS eligible for immutable caching and does not serve the inventory.
   HTML validators hash the actual contents, so normalized file dates and an
   unchanged HTML length cannot keep a previous build's script fingerprints.
5. Bundles Electron main/preload with esbuild and copies only the native input
   hook's runtime closure. No other JavaScript package may resolve from a
   developer's `node_modules` at runtime.
6. Produces normalized file inventories, license notices, pack inputs, app-matched
   catalog entries for approved inputs, a non-secret `update-policy.json`, and exact
   byte reports. The compressed feasibility archive is **not** a signed DMG or
   update ZIP. Their overhead is measured separately in Phase 4.

## Evidence and gates

The target directory contains `runtime/manifest.json`,
`runtime/licenses/inventory.json`, `runtime/licenses/THIRD_PARTY_NOTICES.txt`,
`starter-content-inventory.json`, `size-report.json`, `size-report.md`, and
`audit-report.json` after a successful full stage. `pack-inputs/` is not a public
pack catalog. No download URL is invented for an unpublished pack.
A successful stage also rewrites the ignored local
`desktop/release/review/redistribution-review.md` from those exact artifacts;
it does not reuse narrative from an older build.

The fresh 2026-09-03 macOS-15 core stage passed the file, frozen-resource, native
database, starter-closure, and size audits. Its compressed feasibility payload
is 417,458,667 bytes and its installed estimate is 1,007,160,249 bytes, below the initial
ceilings without an exception. Read the report for exact bytes; these are not
signed DMG/ZIP measurements. Apple signing/notarization inputs are now configured and
the separate document-worker producer has now passed signing, notarization,
stapling, Gatekeeper and its frozen local-PDF probe. `worker-review.json` records
its signed measurements after successful export; the core size report's
worker fields remain null until a reviewed worker enters its pack catalog.
License inventory export is complete but still requires human review.
See [redistribution review](./redistribution-review.md) for the traced speech
and Included-content sources, exact hash matches, included notices and remaining
human review.

## Optional Pack Producer

`desktop/scripts/runtime/feature-pack-build.ts` is shared by staging and:

```sh
pnpm desktop:runtime:packs -- --platform darwin --arch arm64
```

It can consume the derived Parakeet model/configuration input, expanded
Included content outside the core closure, and the separately signed worker
input. `desktop/runtime/feature-pack-releases.json` fixes the release URL,
versions, license references, explicit `active`/`deferred` release status, and
approved inventory digest for each supported ID. Expanded Included content and
document processing are `deferred` for the first release: their development
inputs remain but they produce no archive/catalog entry or release size gate and
require no initial-release approval. Parakeet is the only active pack and remains
bound to its owner-approved exact digest. A null or changed digest produces a
review report, not an installable catalog entry. Do not fill in approval hashes
without reviewing redistribution
rights and required notices. No files are uploaded by this command.

Phase 4 permits an explicit compatible `app_versions` list and original
`release_tag` per pack. Keeping the exact approved manifest across those tested
versions preserves its installed pointer through an application update. Omitted
fields still target only the current app/version tag. Keep reused archive URLs
immutable and available; changed payloads need a new pack version and review.

Approved inputs produce `.tar.zst` archives in the target's `feature-packs/`
directory and `runtime/pack-catalog.json`. The Python writer emits only regular
USTAR members with normalized modes/timestamps. The actual installer re-extracts
each candidate and rechecks its inventory before the builder accepts it. PAX,
GNU long names, sparse files, links, and special entries are not supported.
`pack-build-report.json` records exact archive SHA-256, payload bytes, and
required free space. Installed bytes mean the sum of inventoried payload files;
the disk requirement adds two expanded payloads, archive bytes, and a 64 MiB
reserve for bookkeeping/filesystem overhead. Old versions already occupy disk
and are not assumed reclaimable. No independently mutable latest-pack feed exists.

The current release input contains the Apple publisher and approved Parakeet
digest. A matching stage therefore emits only that pack in the installable
catalog; both deferred packs remain absent. Existing development model/content
files are not approval, and a changed Parakeet input returns to review-required.

Browser production-preview checks and an `embedded-desktop` Vite build prove
web policy only. They do not replace a fresh stage/audit, renderer capability
tests, or signed/native acceptance. Restage the entire matching web/backend
output after a cache-policy or frontend change; do not copy individual chunks
into a previously audited runtime.

### Separate Document Worker

The executable pack uses its own Python environment and PyInstaller spec:
`src/backend/packaging/desktop/animama-document-worker.spec`. It includes
lightweight parsers, Docling/Torch, dependency notices, fixed Docling layout/table
models, and a tiktoken cache. Runtime resource configuration is frozen-only and
forces offline model loading; OCR/VLM model families are not included.

Before invoking the builder, configure the reviewed Apple Team ID, Developer ID
Application identity, and designated requirement in the release input file.
Use the same Team ID for the eventual core app. Put notarization credentials in
a Keychain profile and set only its name in `ANIMAMA_MACOS_NOTARY_PROFILE`:

```sh
pnpm desktop:runtime:document-worker -- --platform darwin --arch arm64
```

Without these prerequisites the command stops before building or signing. It
never enables an unsigned worker, including in development. With them, it
builds `Animama Document Worker.app`, checks Mach-O architecture and native
dependency containment, signs nested Mach-O files and the bundle, notarizes and
staples it, verifies the pinned publisher and Gatekeeper assessment, then runs
the frozen resource/PDF-conversion audit. The signed input lives under
`desktop/.desktop-runtime/document-worker/darwin-arm64/signed-input`. Review
that exact inventory before producing its pack. Phase 4 also exports an
unapproved review archive/manifest to `desktop/release/worker-input/`. Reuse
these exact signed bytes on release runners with
`node desktop/scripts/runtime/worker-input.mjs import` after recording the
approved inventory. Re-signing a rebuilt helper changes its digest; an earlier
approval does not apply. See [Releases](releases.md#build-and-preserve-the-reviewed-helper).
The pipeline and refusal gates
have component coverage; an actual signed artifact, native conversion, and
measured worker size remain required acceptance evidence.

The native audit reads Mach-O load commands so a dylib's own `LC_ID_DYLIB` is
not mistaken for a missing dependency. Before signing, the builder replaces
references to proven PyInstaller Torch aliases with contained loader-relative
paths and removes those duplicate copies. Other native aliases are retained
for possible Python/ctypes lookups, with their original search locations
preserved after materialization. The resulting pack still contains only regular
files; missing libraries, external search paths and size overruns fail the build.
`Contents/Resources/NATIVE_LIBRARIES.json` records the dependency audit and
relocations.
The app's `Contents/MacOS/animama-document-worker` is a small native launcher;
the intact frozen Python tree lives in `Contents/Resources/document-worker`.
The launcher uses a bundle-relative absolute path and `execv`, preserving the
supervisor's PID/signals without a shell, PATH dependency or helper process.
The producer explicitly signs and verifies every payload Mach-O before signing
the outer app. The pack installer independently checks every native signature
after extraction, as well as the full sealed bundle. No non-code signature is
stored only in extended attributes, and the archive still rejects links.
Core and worker audits also inspect each shipped arm64 Mach-O deployment
minimum before runtime probes or signing. They compare deployment versions,
not SDK versions; an absent/foreign target or a requirement above the advertised
minimum fails. Failed core audits remove the previous success receipt. On
September 3 this exposed macOS 14 requirements in the current worker and core
NumPy inputs. The owner then approved macOS 15 as the minimum. Build flags,
app/helper metadata, runtime manifest admission and update feeds now use that
target; stale staged manifests are rejected. Rebuild rather than relabel old
artifacts, and retain the separate macOS 15 runtime-acceptance gate.
The private `document-worker/darwin-arm64/notarization-response.log` retains the
Apple submission response, including on a timeout; inspect it before submitting
again. It is build-cache evidence, not a publication or approval receipt.

## Native verification

Unpackaged supervised tests can supply an absolute fixture catalog through
`ANIMAMA_DESKTOP_DEV_PACK_CATALOG_PATH`; only that mode permits loopback HTTP
fixture archives. Packaged builds reject the override and use their embedded
catalog. This is not permission to mount unreviewed release content or run an
unsigned executable pack.

The native database listens only on authenticated loopback TCP. Unused Unix
sockets are disabled so a long application-data path does not exceed macOS's
socket-path limit. Database files, ownership checks, and SCRAM authentication
remain unchanged.

During a pack transition, Electron remembers the validated main-app route,
destroys every product window to dispose browser workers, and shows its
independent recovery page. The session blocks product requests while unavailable,
revokes the transient renderer cookie and closes remaining connections. Private
quiescence precedes pointer changes; a busy result restarts the unchanged prior
configuration. After exact owned readiness, Electron installs the capability
and recreates the main app at its remembered route. API/model/content failures
remain bounded errors.

On 2026-09-02 a disposable native profile passed actual Parakeet archive
installation, speech recognition, offline restart, removal, and reinstallation.
A generated WAV replaced microphone capture; VAD, the model worker, UI, gateway,
and private PostgreSQL/FastAPI services were real. Three dictation runs produced
the expected sentence. During the offline restart, renderer Internet requests
were blocked and the local download server was stopped; the installed model
files still loaded through the local gateway. Removal disabled dictation and
returned 404 for the former model URL. Reinstallation recovered the same chat
route automatically and restored dictation. The owner stayed unchanged and all
owned processes stopped on exit. No paid provider/chat request was made.

The later Janna/R1 follow-up also exercised real Settings cancellation, a dropped
HTTP connection, quitting during download, and catalog/ETag-bound range resume
across app launches. All resumed into the verified Parakeet installation. A
network failure now reports `pack_download_failed`, not a runtime-start error;
cancellation still reports `pack_cancelled`. Expanded Included content installed
as selectable entries without changing the existing loadout. Native removal
rejected an Anima reference and, separately, a still-valid preview lease. Closing
a preview does not revoke its issued lease immediately; allow it to expire
before retrying removal. Once it expired, removal restored the original 173
valid core entries, and a further restart retained both Animas, the owner, and
Parakeet. That checkpoint's expanded pack included a BGM example that the owner
subsequently excluded. Its archive/hash is historical and must not be reused for
new distribution; rebuild from the current inventory. These are development
fixture downloads, not a GitHub release or a redistribution approval.

This is development evidence, not a production download, signed-app acceptance,
or physical microphone/visual-quality approval. The ordinary desktop profile,
saved provider key, existing unsigned app bundle, and main Compose stack were
not changed. The generated evidence lives under the ignored
`desktop/.desktop-runtime/phase3-native/` and `phase34-native/` directories; the
[release process](release-process.md#release-gates-in-order) records the remaining
gates; preserve the exact report paths with the candidate review. A fresh complete
stage/audit and the final native recheck include the corrected code, so later
packaging can consume the audited stage.

The audit detects changed, missing, extra, or non-portable files; checks the
bundled Electron zstd API; executes the frozen resource/content audits; and
creates one **temporary native** PostgreSQL cluster on an unused loopback port.
That cluster verifies pgvector, migrations, stable principal ownership across
repeated bootstrap, and a real custom-format dump restored into a separate fresh
database. The restored principal, Alembic head, pgvector extension, and exact
owner-scoped marker rows must match the snapshot. It is stopped and removed in
`finally`; it does not create or alter any Compose stack.

Hard caps are 750 MiB compressed core and 1.5 GiB installed core. Five-percent
component regressions are compared with the last **released** baseline. There
is no released baseline yet. Exceptions require explicit owner approval, a
dated/version-bounded record in `runtime/size-exceptions.json`, and a
matching explicit approval in `runtime/size-approvals.json`. See
[size exception decisions](size-decisions.md). License inventory records and `NOASSERTION` values
are review evidence, not permission to redistribute. Release commands remain
closed while provenance, required notices, or owner approvals are missing.

## Current content gate

The owner corrected Caitlyn's replacement on 2026-09-02 to the model associated
with **Janna**, `AvatarSample_R1.vrm`, then confirmed it has no external components
and reports it rendered correctly. The version-3 starter and its matching
generated portrait are in core. The earlier R2/Gwen authorship claim is
withdrawn. Existing starter receipts and historical adoption identifiers are not rewritten.
`content/included/licenses/inventory.json` now links Annie's official pixiv
preset terms and records the owner's R1 provenance separately from release
approval. Its first matching `distribution: excluded` rule removes the former
Chibi 2 and mistaken R2 models and their portraits/metadata from both core and expanded inputs.
An excluded required dependency fails typed closure resolution. Private source
files and existing desktop data are not deleted. The owner confirmed Annie's
exact model is an unmodified VRoid free preset with no external assets. The
preset terms are not CC0; product-use restrictions and final notices still need
release review, but the preset/modification question is resolved.

The same owner decision excludes downloaded voice samples (`voices/*`), BGM
(`music/*`, including metadata), and the four Tokyo background originals with
their thumbnails from both partitions. Legacy frontend background/BGM fallback
lists are empty, so they cannot point at absent example URLs. Generated avatar
portraits, speech-engine models and built-in voices remain included, and
user-imported Local Music, Appearance and voice content remain supported.
The private source files are retained; this desktop filter does not make them
safe to put in a future public source repository.

Preserving a starter receipt does not preserve a removed Included model in a
new bundle. An existing development profile referencing Chibi 2 or R2 needs an explicit
avatar replacement/repair before accepting the updated core; profiles using the
now-excluded background, music or voice examples likewise need explicit repair.
Do not silently
overwrite its Anima or claim upgrade compatibility from fresh-profile tests.
The earlier R2 screenshot's material artifacts are historical, not a blocker for
the now-excluded replacement. R1 and its portrait render in a fresh native
development profile; the owner's reported successful render is recorded, while
full desktop/audio acceptance remains unknown. No binary model or
texture was rewritten during either substitution or the speech tests.

On 2026-09-02 the owner confirmed that the private comedy SFX have no
distribution license and authorized their exclusion. The tracked Avatar Effects
and shy-finger-poke gesture now retain their visuals/animation without those
decorative audio cues; the corresponding creator definitions are consistent.
The legacy built-in SFX palette is empty. Typed owner-provided Sound Effects are
still supported.

The original 18 required sounds and 18 metadata files (1,343,670 bytes) remain
ignored under `content/included/sfx/comedy/1/`; they are neither copied nor
deleted. Strict staging admits tracked inputs only, including for expanded
content. Both starters must resolve with zero diagnostics without the private
files. This changes the source content intentionally; the stage still fails on
any missing required dependency. There is no development-only copy path or
release bypass. Remaining dependency/asset inventories still require review
before public distribution.

Build outputs and caches are disposable. Fix a failed input and rerun the stage;
it starts from an empty target. Database backups and installed user state do not
live here and must never be copied into a build. The user requested Phase 2
implementation while this gate remained open; that did not approve SFX
redistribution or complete Phase 1. The later exclusion decision removes that
input blocker. Full staging and the unsigned native core journey have since
passed; signed-worker measurement, user verification, and release approval
remain separate. See the [release process](release-process.md#release-gates-in-order)
for current acceptance requirements and preserve fresh evidence with the candidate.
