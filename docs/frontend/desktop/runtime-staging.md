# Desktop runtime staging

Staging produces the audited resources consumed by Electron's embedded service
supervisor. Packaged builds require these resources. `desktop:dev` uses the local
application stack unless the development runtime-root override is set. See
[Overview](overview.md) for lifecycle, credentials and recovery.

For user installation and recovery use [Installation](installation.md) and
[Troubleshooting](troubleshooting.md). For initial manual publication after
signing/acceptance, use [Release process](release-process.md). This staging guide
describes build inputs and development evidence, not an available release.

## Native macOS build

Use an Apple Silicon Mac with Xcode command-line tools, `uv`, Node, and the
repository's pnpm installation. Dependency downloads require network access.
No Homebrew PostgreSQL, Docker reset, local account, or provider credential is
required. Before staging, acquire the pinned speech inputs from the repository
root:

```sh
python3 scripts/models/parakeet.py acquire
python3 scripts/models/parakeet_webgpu.py acquire
python3 scripts/models/browser_speech.py acquire
```

The WebGPU encoder is about 1.24 GB. Then run from `src/frontend`:

```sh
pnpm desktop:runtime:stage -- --platform darwin --arch arm64
pnpm desktop:runtime:audit -- --platform darwin --arch arm64
pnpm desktop:test -- runtime-packaging
```

Staging installs its pinned Python interpreter under
`/Users/Shared/animama-build/uv-python`, not in your home directory, because
the frozen backend records the interpreter's install paths. The native
PostgreSQL build likewise uses the neutral prefix `/opt/animama`. Neither
location needs to exist on the user's Mac. Staging refuses to run if
`/Users/Shared/animama-build` or its `uv-python` directory is owned by another
account or writable by others; remove or fix that directory rather than
bypassing the check.

The strict target parser rejects cross-builds and unsupported combinations before
deleting outputs or downloading dependencies. Windows native staging is unsupported. `desktop:dist:mac` and `desktop:smoke:mac` use the
[signed-release gates](releases.md), including explicit Apple, inventory and
intended repository configuration. The repository may remain private for local
signed candidates; anonymous public access is checked only at publication.
Private pack/update URLs do not become usable in the app. Windows release/smoke commands reject unsupported targets. No command treats a shell-only package as a release.

After a successful stage and audit, `pnpm desktop:mac` copies the runtime into
`Animama.app/Contents/Resources/runtime`, outside ASAR. Its prebuild gate requires
the exact audited manifest/build ID and current main/preload closure, with no
stage-failure marker. Restage and reaudit after backend, supervisor, preload, or
web or baseline SQL changes. The current Alembic head is the single
`baseline_20260908` revision. During development, update ORM/database definitions
and baseline SQL directly without adding revisions; existing databases do not
automatically receive an edited baseline. Profiles or backups whose revision is
absent from the packaged migration graph require a matching app/checkout or a reviewed recovery
procedure. Use an explicitly disposable fresh profile for incompatible test data.
The stage probe uses disposable data; it does not reset an existing installation.
Artifacts use `animama-desktop-runtime/2` and `local_http_schema_version: 1`.
Stage and audit require the frozen backend to advertise the same local HTTP
schema. The JS audit rejects Hono and frontend-server dependencies.
The saved application-port key is `gatewayPort`; it does not imply a gateway process.
The development packager disables ad-hoc signing as well as certificate signing,
and rechecks every copied runtime file after electron-builder finishes. See
[Platform builds](platforms.md) for the unsigned output and report. Production
signing uses its separate nested-sign, inventory, and outer-seal sequence.
The FastAPI static responder must serve ONNX `.mjs` modules as JavaScript with `nosniff`;
having the file in the inventory is insufficient if Chromium rejects its MIME
type.

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
   The stage filter and independent audit reject unapproved portrait copies
   listed in `desktop/scripts/runtime/desktop-web.mjs`.
   The browser-runtime manifest verifies all 21 PocketTTS, VAD, Smart Turn and
   ORT assets from the shared model store and exact dependency versions. Vite
   copies every reviewed variant into the runtime; the independent audit checks
   the built inventory and hashes without relying on a developer cache. These
   distribution copies and their existing notices remain required. Ordinary
   `pnpm web:build` also retains the Included compatibility copies.
   This is a production build: application debug imports stay excluded even
   with `VITE_ENABLE_DEBUG_PANEL=true`. Retain `.vite/manifest.json` alongside
   the coherent SPA output; packaged FastAPI uses it to identify fingerprinted
   JS/CSS eligible for immutable caching and does not serve the inventory.
   HTML validators hash the actual contents, so normalized file dates and an
   unchanged HTML length cannot keep a previous build's script fingerprints.
5. Bundles Electron main/preload with esbuild and copies only the native input
   hook's runtime closure. No other JavaScript package may resolve from a
   developer's `node_modules` at runtime.
6. Bootstraps a disposable database in a temporary directory with the staged
   PostgreSQL and frozen backend, then records its normalized schema digest as
   the manifest's `database_schema_sha256`. The directory is removed afterwards.
7. Produces normalized file inventories, license notices, pack inputs, app-matched
   catalog entries for approved inputs, a non-secret `update-policy.json`, and exact
   byte reports. The compressed feasibility archive is **not** a signed DMG or
   update ZIP. Their overhead is measured by the signed-release producer.

## Evidence and gates

The target directory contains `runtime/manifest.json`,
`runtime/licenses/inventory.json`, `runtime/licenses/THIRD_PARTY_NOTICES.txt`,
`starter-content-inventory.json`, `size-report.json`, `size-report.md`, and
`audit-report.json` after a successful full stage. `pack-inputs/` is not a public
pack catalog. No download URL is invented for an unpublished pack.
A successful stage also rewrites the ignored local
`desktop/release/review/redistribution-review.md` from those exact artifacts;
it does not reuse narrative from an older build.

Read the exact stage reports for measured bytes and audit results. Feasibility
sizes are not signed DMG/ZIP sizes. `worker-review.json` records signed worker
measurements after export; core worker fields remain null until a reviewed
worker enters the catalog. A generated license inventory requires human review.
See [redistribution review](redistribution-review.md) for source and notice
mappings and the pending artifact review.

## Verified browser engine inputs

`models/browser-speech/manifest.json` pins the ten core Pocket TTS/Smart Turn
files. `models/browser-runtime/manifest.json` binds those plus nine ORT 1.24.2
files from `onnxruntime-web-assets` and two VAD 0.0.30 files from its pinned
package. Package installation supplies dependency files; staging only verifies
and copies already acquired model inputs. It never silently downloads them or
substitutes an installed ORT version.

The complete 21-file browser engine set occupies 280,549,335 bytes before distribution
compression. It is included in `runtime/web/onnx` as independent regular files,
so clearing a developer model cache cannot break an installed application's
Pocket TTS, VAD or Smart Turn engine. Eve and Azelma are included; the other 36
voice states and the cloning encoder download separately. Ordinary web builds
and runtime staging do not require those optional inputs. The model-store workflow does not replace signing, redistribution or native
acceptance gates.

Use the [model-store workflow](../../backend/operations/model-assets.md) for
`ANIMAMA_MODEL_ROOT`, Windows `%LOCALAPPDATA%\Animama\models` and WSL/Linux
defaults. Windows model acquisition support does not enable Windows native
runtime staging.

## Verified Parakeet producer inputs

Before producing the Parakeet packs, run `python3 scripts/models/parakeet.py acquire`
and `python3 scripts/models/parakeet_webgpu.py acquire` from the repository root,
or import previous source copies using the
[model-store workflow](../../backend/operations/model-assets.md). Set the absolute
`ANIMAMA_MODEL_ROOT` only when selecting a different store. Staging consumes the
tracked manifests and verifies each local file; it does not query Hugging Face or
infer weights from Git's tracked-file list. `parakeet-stt` requires its seven
pinned files and `parakeet-stt-webgpu` its FP16 encoder, each with exact payload
hashes and attribution. An active pack whose inputs are missing fails staging.
Inventory review, signing, hosting and native acceptance remain separate gates.

For a cold release store before new objects exist, use the explicit
[release bootstrap](../../../scripts/models/README.md#release-only-bootstrap)
from the repository root. It uses pinned upstream inputs and verifies regenerated
voice hashes without accepting changes. A signed release needs these optional
model inputs to prepare its publication candidates; an ordinary web build does not.

This developer/producer cache is not an installed app model directory. Installed
models remain under the app-owned `packs/` lifecycle in Application Support, with
separate temporary `downloads/` and the existing verification/activation recovery.
Clearing a developer cache must not affect an installed application's speech pack.

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
require no initial-release approval. The two Parakeet packs are active; each ships
only when bound to its owner-approved exact digest. A null or changed digest produces a
review report, not an installable catalog entry. Do not fill in approval hashes
without reviewing redistribution
rights and required notices. No files are uploaded by this command.

Pack inputs permit an explicit compatible `app_versions` list and original
`release_tag` per pack. Keeping the exact approved manifest across those tested
versions preserves its installed pointer through an application update. Omitted
fields still target only the current app/version tag. Keep reused archive URLs
immutable and available; changed payloads need a new pack version and review.

Approved Parakeet inputs produce `animama-model-pack/1` catalog entries in
`runtime/pack-catalog.json`, referencing the shared content-addressed raw objects.
Each inventory includes weights, configuration and notices; the producer emits
no Parakeet archive or duplicate weight copy. Download/installed sizes and peak
free-space requirements come from those exact files in `pack-build-report.json`.

Archive packs retain `.tar.zst` outputs under `feature-packs/`. The Python writer
emits only regular USTAR members with normalized modes/timestamps; the real
installer re-extracts and verifies each candidate. PAX, GNU long names, sparse
files, links and special entries are unsupported. Their disk requirement includes
two expanded payloads, archive bytes and a 64 MiB reserve. Existing installed
versions are never assumed reclaimable. No mutable latest-pack feed exists.

The current release input contains the Apple publisher and approved Parakeet
digest. A matching stage therefore emits only that pack in the installable
catalog; both deferred packs remain absent. Existing development model/content
files are not approval, and a changed Parakeet input returns to review-required.

Browser production-preview checks and an `embedded-desktop` Vite build prove
web policy only. They do not replace a fresh stage/audit, renderer capability
tests, or signed/native acceptance. Restage the entire matching web/backend
output after a cache-policy or frontend change; do not copy individual chunks
into an audited runtime.

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
that exact inventory before producing its pack. The producer also exports an
unapproved review archive/manifest to `desktop/release/worker-input/`. Reuse
these exact signed bytes on release runners with
`node desktop/scripts/runtime/worker-input.mjs import` after recording the
approved inventory. Re-signing a rebuilt helper changes its digest and
invalidates approval for different bytes. See [Releases](releases.md#build-and-preserve-the-reviewed-helper).
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
minimum fails. Failed core audits invalidate their success receipt. Build flags,
app/helper metadata, runtime admission and update feeds target macOS 15. Rebuild
rather than relabel artifacts, and retain the macOS 15 runtime-acceptance gate.
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
socket-path limit. Ownership checks protect the database files; connections
require SCRAM authentication.

During a pack transition, Electron remembers the validated main-app route,
destroys every product window to dispose browser workers, and shows its
independent recovery page. The session blocks product requests while unavailable,
revokes the transient renderer cookie and closes remaining connections. Private
quiescence precedes pointer changes; a busy result restarts the unchanged prior
configuration. After exact owned readiness, Electron installs the capability
and recreates the main app at its remembered route. API/model/content failures
remain bounded errors.

Native pack acceptance requires real download, cancellation, connection loss,
quit/resume, installation, offline dictation, restart, removal and reinstallation.
Verify catalog/ETag-bound resume and bounded `pack_download_failed` and
`pack_cancelled` results. Expanded-content tests must check Anima references and
live preview leases; closing a preview does not immediately revoke its lease.
Retain the owner and chat across transitions. Fixture downloads and generated
speech do not establish production transport or physical microphone acceptance.
Keep results with the exact signed candidate and its
[release gates](release-process.md#release-gates-in-order).

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

The core starter models are Annie (`AvatarSample_A_1_New.vrm`) and Caitlyn
(`AvatarSample_R1.vrm`), with renderer-captured portraits. Their provenance and
distinct permission terms are recorded in `content/included/licenses/inventory.json`
and [source notices](../../../licenses/third-party/art-NOTICES.md). Annie is a
VRoid preset; Caitlyn is authored by Raymond Van using VRoid Studio. Existing
starter receipts and adoption identifiers remain valid compatibility data; they
do not authorize restoring excluded bytes or silently changing an Anima.

The source checkout excludes Mixamo-derived `.vrma` files from tracking and
Docker contexts. The [optional Local installer](../runtime/mixamo-acquisition.md)
adds manually converted motions to the Local library, outside staged content.
The starter closure contains 21 authored gestures, 72 reactions and no required
Idle Style. The tracked-only staging gate still fails on an unavailable selected
dependency, even if an ignored local copy exists. Full native stage and packaged
acceptance remain separate checks; do not infer them from a passing content test.

Content with `distribution: excluded` is omitted from core and expanded inputs.
An excluded required dependency fails closure resolution. User-imported Local
Music, Appearance, voice content and Sound Effects remain supported. Built-in
background, BGM and SFX fallback palettes are empty. Speech-engine models and
built-in voices are separate from imported example recordings.

An existing profile referencing unavailable Included content needs explicit
replacement/repair before accepting a new core. Preserve its Anima and stored
receipts; a fresh-profile test does not establish upgrade compatibility.

Build output and caches are disposable. Correct a failed input and rerun staging,
which starts from an empty target. Database backups and installed user state must
never enter a build. Review the exact dependencies, notices and artifacts before
public distribution; [release acceptance](release-process.md#release-gates-in-order)
is separate from source preparation.
