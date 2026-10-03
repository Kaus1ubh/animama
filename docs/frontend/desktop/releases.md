# Desktop releases and updates

The release tools build signed macOS 15+ Apple-silicon candidates and support
guarded updates, upgrade snapshots and installed-artifact smoke tests.
**No accepted public release is available.** Fresh matching artifacts, complete
starter inputs, inventory review, minimum-OS/native acceptance and a real forward
upgrade remain required. Unit tests do not approve redistribution or publication.
Windows 11 x64 has the same tooling: a signed candidate builder
([Build a signed Windows candidate](#build-a-signed-windows-candidate)), guarded
updates through its per-user installer, installed-artifact smoke and
publication. No Windows release has been published, and a real signed Windows
upgrade has not been run. Release commands use isolated native profiles; they
do not reset or create Compose stacks.

Initial publication runs manually from reviewed `main` inputs. Start with the
[maintainer release process](release-process.md) for ordered gates; this page is
the tooling reference. CI publication remains unconfigured.

## What people see

A signed, configured app checks its release feed 15 seconds after startup. Offline checks time out without blocking the application. Settings →
General also offers **Check for updates**. A notice offers **Download update**;
the separate **Restart to install** action asks for confirmation before stopping
local services. Closing the notice or quitting normally does not install a
downloaded update. Unpackaged or unconfigured builds do not offer updates.

Only the registered main window can check, download, or restart. Renderer IPC
accepts no release URL, version, token, executable, or filesystem path. It returns
bounded status, byte counts, progress, and safe error categories. The updater
uses a separate Electron network session restricted to the build's sealed
distribution (see [Distribution selection](#distribution-selection)): for R2,
only the platform's feed (`<base_url>/latest-mac.yml` on macOS,
`<base_url>/latest.yml` on Windows) and `<base_url>/v<version>/` files; for GitHub,
only the configured repository's releases and asset CDN. Archive packs follow
the same rule. Backend model-asset downloads, including Parakeet, always use the
fixed `https://downloads.animama.ai/models/` origin, with no redirects. R2 app downloads
also follow no redirects. No Animama account or token
is required for the installed application.

The pinned `electron-updater` 6.8.9 adapter sets `autoDownload=false` and
`autoInstallOnAppQuit=false`, permits stable forward updates for the build's own
platform and architecture only, and disables differential downloads and web
installers. It checks the exact approved download's size and SHA-512 and
refreshes the feed before downloading, so a changed candidate needs another
check. Each platform's update must come from its own publisher, sealed into
`runtime/update-policy.json` at staging: on macOS the Apple Team ID, on Windows
the Authenticode certificate subject and identity-validation EKU.

- **macOS** downloads `Animama-<version>-arm64.zip`. Squirrel, Electron's
  native macOS installer, performs replacement signature verification only after
  explicit Restart and successful shutdown.
- **Windows** downloads `Animama-<version>-x64-setup.exe` for build 22000 or
  later. A feed asking for elevation is refused. The installer's Authenticode
  signature must be `Valid` and carry the sealed subject and EKU, checked when
  the download completes and again just before it runs. After Restart stops the
  local services, the app starts the installer with `--updated` and quits; the
  installer replaces the per-user app without asking about data and starts the
  new version. If the installer cannot start, the services restart and the
  current version keeps running.

At startup an installed app first checks its own signature against the sealed
publisher; a build that fails offers no updates. Do not copy options from a
newer updater version without checking its API.

Before both download and restart, the supervisor checks free space, active pack
operations, document jobs, and expanded-content references. An update that would
strand referenced expanded content is blocked. The required free space is two
download archives, two installed app copies, twice the current PGDATA byte count,
and a 256 MiB reserve. Existing data or packs are never assumed reclaimable.

## Distribution selection

`release-policy.json` records two reviewed destinations: Cloudflare R2 served at
`https://downloads.animama.ai/desktop` (bucket `animama-releases`), and the GitHub
repository `raymond-van/animama-releases`. Staging and every release command
select one with `ANIMAMA_RELEASE_DISTRIBUTION=r2|github`; unset means `r2`, and
any other value fails. The choice is sealed into the staged
`runtime/update-policy.json` and archive-pack URLs, and `desktop:dist:mac` refuses
a selection that differs from the one used for staging. Installed apps never read
this variable and have no runtime override.

| Distribution | Update feed                                                 | Installers, notices and archive packs                             |
| ------------ | ----------------------------------------------------------- | ----------------------------------------------------------------- |
| `r2`         | `<base_url>/latest-mac.yml` (macOS), `latest.yml` (Windows) | `<base_url>/v<version>/<asset>`                                   |
| `github`     | The repository's release feed                               | `https://github.com/<owner>/<repo>/releases/download/v<version>/` |

Both targets share a version's folder or GitHub release, and each publishes and
promotes independently. On GitHub, a release holding only one target's files
makes the other target's update checks fail until its files are added.

An app only ever updates from the distribution it was built for, and it accepts
only a feed in that distribution's format. Moving installed users between
distributions is not supported: R2 is the distribution for releases, and a
change would require users to download the new build manually. `signing-report.json` records the
distribution sealed into the candidate, and the publisher refuses a candidate
whose recorded distribution differs from the current selection.

## Release inputs and permissions

Keep source private. A signed candidate builder uses the selected distribution
to pin future installer/update and archive-pack URLs, but does not contact it, require a
token or upload assets. A local signed build does not approve public
distribution; notarization still submits binaries to Apple. Neither path infers
a destination from the source remote or embeds a token in the app.

The publisher uses the candidate's recorded distribution. Before preparing
promotion reports or reading credentials, it checks the destination anonymously:
for GitHub, public repository access (rechecked through the authenticated API
before uploading); for R2, that the custom domain answers and the public feed
does not already name this or a newer version. If the feed already names this
version, the release is complete; verify it instead of publishing again. The destinations supply pinned future URLs, not a private download
feed. `feature-pack-releases.json` records pack policy and exact inventory
receipts; `release-policy.json` records one core inventory receipt per target
(`darwin-arm64`, `win32-x64`), since each target's inventory differs. A source or
notice change requires fresh matching review rather than reuse of an older hash.

Both publishers work without a local distribution checkout: GitHub through the
Releases API, R2 through its S3 API with a bucket-scoped token. Release assets are uploaded separately from source commits. Neither
source commits nor candidate builds publish a release. The checked-in workflow
is manually dispatched, with publishing disabled by default and separate gates.
Changing the eventual source/history or distribution arrangement requires an
explicit publication decision; these commands do not select one.

| Input                                             | Required operator decision                                                                                                                                                                                     |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `desktop/runtime/release-policy.json`             | Both distributions (R2 public base URL and bucket; GitHub `owner`/`repo`), stable channel, one human redistribution receipt per target                                                                         |
| `desktop/runtime/feature-pack-releases.json`      | Approved active-pack hashes, explicit deferred-pack status, Apple Team ID, Developer ID identity, document-helper designated requirement. Pack URLs are derived from the selected distribution, never set here |
| `feature-pack-releases.json` `windows`            | Artifact Signing endpoint, account and certificate profile, and the certificate subject and identity-validation EKU every Windows signature must carry. None is a secret                                       |
| `desktop/runtime/windows-signing.lock.json`       | The Windows SDK `signtool` and Artifact Signing client library, pinned by version and SHA-256                                                                                                                  |
| `desktop/runtime/macos-acceptance.example.json`   | Template only; a reviewer must supply the actual DMG hash, date, identity, prior signed version, and completed checks                                                                                          |
| `desktop/runtime/windows-acceptance.example.json` | The same template for the Windows installer hash and its manual checks                                                                                                                                         |
| `desktop/runtime/size-baseline.json`              | Update only from a successfully released artifact, never a partial stage or estimate                                                                                                                           |

Review the [current content gate](runtime-staging.md#current-content-gate),
third-party inputs and required notices. `NOASSERTION` and a generated inventory
are not permission to distribute. Core review binds the staged license-inventory
SHA-256, including dependency locks, source-asset hashes and notice hashes.
Changed inputs require review again; builds never fill approval fields.

The checked-in parent entitlement candidate enables JIT and microphone input;
the inherited candidate enables JIT only. Neither enables unsigned executable
memory or disabled library validation. This smaller entitlement set has **not**
passed native ONNX/Electron/input-hook/audio acceptance. Keep the release gate
closed until those exact signed binaries pass; if a specific exception is needed,
record why and repeat signing, size, and acceptance checks for the new artifact.

## Build and preserve the reviewed helper

The release input configures Team ID `9XHPMZ723L` and identity
`Developer ID Application: RAYMOND VAN (9XHPMZ723L)`, plus a pinned
document-worker designated requirement. Set the local notarization Keychain
profile name in `ANIMAMA_MACOS_NOTARY_PROFILE`; passwords and signing private
keys remain outside the repository. Configuration does not prove a successful
signed build or authorize reuse of changed inventory bytes.

Electron Builder receives the certificate name `RAYMOND VAN (9XHPMZ723L)`;
direct `codesign` calls use the full identity. The worker uses a native launcher
and explicitly signed Resources payload; see
[Runtime staging](runtime-staging.md#separate-document-worker). Core and worker
audits compare every shipped Mach-O deployment target with macOS 15. Rebuild
incompatible inputs; do not suppress timestamping or patch headers to claim
compatibility.

Run native builds on Apple silicon with the pinned toolchain from the staging
guide. Configure an existing notarization Keychain profile and set its name in
`ANIMAMA_MACOS_NOTARY_PROFILE`; never put passwords in source or shell history.
Commands below run from `src/frontend`.

```sh
pnpm desktop:runtime:document-worker -- --platform darwin --arch arm64
```

The document pack is deferred from the first release. For a future activation,
the producer freezes the helper, signs and notarizes it, staples it,
verifies its publisher, and runs the frozen conversion probe. It also
exports `desktop/release/worker-input/`: a strict archive, candidate manifest,
and `worker-review.json` marked **unapproved**. Review the payload inventory and
record its hash in the pack release inputs. Preserve that exact archive.

Rebuilding a signed helper changes signature/timestamp bytes, invalidating the
reviewed hash. To reuse the reviewed helper on another build runner, transfer the
three files together to the same derived directory and run:

```sh
node desktop/scripts/runtime/worker-input.mjs import
pnpm desktop:runtime:stage -- --platform darwin --arch arm64
pnpm desktop:runtime:audit -- --platform darwin --arch arm64
```

Import requires the recorded approval, exact archive hash/size, strict extraction,
full inventory, and pinned OS signature. It replaces only derived helper build
input after verification. It neither approves a candidate nor weakens executable
pack verification. Keep private CI artifacts available until all dependent
release builds finish; an expired artifact requires a new review of any rebuilt
bytes. The first release has no active pack: expanded Included content and
document processing are explicitly deferred from it and must be absent from its catalog and release artifacts.

To retain a pack across known compatible app versions, set its optional
`app_versions` list and immutable original `release_tag` in the pack release
inputs before building the predecessor. Keep those fields, pack version,
inventory, license references, signing identity and archive bytes identical in
the successor. The builder then emits the same manifest/pointer; a signed
successor catalog explicitly approves it for the new app. Defaults remain this
app version/tag only. Never change the bytes at an existing release URL, claim
compatibility without testing, or widen an installed manifest by hand. Reused
URLs must remain public even when the new release includes a copy of the archive.

After a complete stage, review the core license inventory and record the human
receipt. Then build the signed candidate:

```sh
pnpm desktop:dist:mac
```

This command verifies the audit and exactly the active reviewed packs (currently
none), rejects deferred entries, signs nested
Mach-O files/bundles, adds the review receipt, recomputes the runtime manifest,
and only then seals the outer app. It notarizes and staples the app, builds the
DMG/update ZIP, notarizes both, signs/staples the DMG, and verifies Gatekeeper.
Updating runtime hashes after the outer signature would invalidate the seal.
The helper and core must use the same pinned Apple Team ID.

If `notarytool submit --wait` times out, preserve its submission ID and the
already signed app. Query or wait on that exact ID before rebuilding or
submitting another copy. A timeout, `In Progress` response, or missing stapler
ticket is not acceptance. If the named Keychain profile is missing, restore it
locally with `notarytool store-credentials`; never paste its password into a
report, issue, commit, or chat.

After Apple accepts that exact app request, resume without rebuilding or
resubmitting the app:

```sh
ANIMAMA_MACOS_NOTARY_PROFILE=<profile> pnpm desktop:dist:mac -- --resume-app-notarization <submission-id>
```

This validates the preserved seal and runtime inventory, staples the accepted
ticket, recreates the signing report, and uses Electron Builder's prepackaged
path for the DMG and ZIP. The app, DMG, and ZIP are distinct notarization
artifacts; acceptance of one does not approve the others.

The resulting `desktop/release/publish/` is a candidate only. It contains the
DMG, ZIP, `latest-mac.yml`, exact runtime/pack manifests, packs, notices and review
receipt, CycloneDX SBOM, signing/size/pack reports, and checksums. The SBOM labels
its dependency coverage conservatively; it is not a claim of complete license
clearance. Reports use relative resource paths, never user profiles or keys.
Both distribution archives must be at most 750 MiB; the installed core at most
1.5 GiB. Existing component and optional-pack regression gates also apply.

## Build a signed Windows candidate

On the Windows 11 x64 build host, signing uses Azure Artifact Signing through
the pinned Windows SDK `signtool` and the pinned Artifact Signing client
library, which the build downloads into `C:\animama-build\tools`. The host
needs:

- the Windows SDK version named in `windows-signing.lock.json` (its
  `signtool.exe` must match the pinned hash), and the .NET 8 x64 runtime;
- the Azure CLI, signed in with `az login` as an account holding the Artifact
  Signing Certificate Profile Signer role on the configured profile. The client
  authenticates through that sign-in only; no credential is passed on a command
  line or stored in the repository;
- `python3` and the acquired release model sets (see
  [Commands and inputs](release-process.md#commands-and-inputs)). The build
  checks that every required set resolves before it signs anything.

After a fresh stage and audit, and once `release-policy.json` holds the
`win32-x64` receipt for that exact inventory:

```sh
pnpm desktop:dist:windows
```

This verifies the audit and receipt, refuses active feature packs (Windows
packs are not built yet), and builds the per-user installer without
electron-builder's own Windows signing. Every PE file lacking a valid embedded
signature is signed with SHA-256 file and timestamp digests, timestamped by
`http://timestamp.acs.microsoft.com`; valid embedded vendor signatures, such as
Microsoft's, are kept after `signtool verify /pa` confirms them. A file signed
only through a system catalog is signed, since a catalog verifies only on a
machine holding it. Nested code under `resources` is signed
first, deepest first. The review receipt is then added and the runtime manifest
recomputed, since signing changes file hashes, before the outer app
(`Animama.exe` last), the uninstaller and the installer are signed. A transient
timestamp or network failure is retried only for the files not yet signed and
timestamped.

`desktop/release/signing-report.json` lists every PE file with its signature,
plus the installer and uninstaller. The candidate is refused unless every file
is `Valid` and every file Animama signed carries the pinned subject,
identity-validation EKU and a timestamp. Artifact Signing certificates last
only a few days, so the timestamp is what keeps signatures valid.

The resulting `desktop/release/publish/` is a local candidate only. It contains
the installer, `latest.yml`, the runtime and pack manifests, notices and review
receipt, SBOM, signing, size and pack reports, model candidates and checksums.
Windows evidence that shares a version folder with macOS files takes a
`-win32-x64` suffix, for example `size-report-win32-x64.json` and
`SHA256SUMS-win32-x64.txt`. The installer must be at most 750 MiB and the
installed app at most 1.5 GiB.

Each candidate uses about 140 signatures from the account's monthly quota. The
report's `signed_files` counts the files signed; retried or failed requests use
more, so check the account's usage for the exact figure. Sign only intentional
candidates. To exercise signing before the
redistribution review exists:

```sh
pnpm desktop:dist:windows -- --signing-rehearsal
```

A rehearsal signs, verifies and measures the same files but embeds no review
receipt and writes no publish folder; its report says `release_ready: false`,
and no publisher accepts it.

## Installed-artifact smoke and manual acceptance

Use a dedicated fresh macOS account or a fresh CI runner for the setup smoke.
Log in normally and verify that the test account has no app/profile data; do not
impersonate its session or change HOME. A privately transferred DMG is sufficient
for the core smoke. No public GitHub visibility or signing credential is needed
in the test account.
The harness refuses an existing `Animama` or `Anima` profile or installed test app.
It never resets data, changes HOME, or sets packaged developer overrides.
Provide `ANIMAMA_SMOKE_OPENAI_KEY` explicitly for two short real starter chats;
the harness does not load developer `.env` files. Those API calls incur provider
usage. The key travels through the normal setup UI into the encrypted vault.
After checking restart persistence, the harness deletes this temporary OpenAI
credential through the normal vault API and verifies absence after another
restart. Failure paths attempt the same cleanup before shutdown; a failed
cleanup fails the smoke and reports the required manual removal. It never
changes the source key or any other account's vault. Real provider calls require
explicit authorization for the scoped smoke and its temporary credential cleanup.

```sh
pnpm desktop:smoke:mac -- --artifact desktop/release/publish/Animama-<version>-arm64.dmg --setup name
```

The smoke rejects empty and all-whitespace names before completing named setup.
Required-name evidence gates publication.
The harness checks the signed DMG and contained app, installs into the absent
`~/Applications/Animama.app`, launches with a system-only PATH, verifies child
executables belong to app resources, and tests setup, a provider key applied
without a window or backend restart, provider status, local HTTP
rejection, core capabilities, both starter chats, exact typed bytes, private
upload, restart persistence, temporary-key removal, and owned shutdown. It leaves the profile and app
intact for inspection. A missing provider or failed journey is a failure, not a
skipped success.

On Windows, use a separate standard (non-administrator) Windows account that
has never run Animama: no `%LOCALAPPDATA%\Animama`, no
`%LOCALAPPDATA%\Programs\Animama` and no `%APPDATA%\Animama`. Sign in to it
normally, with `ANIMAMA_SMOKE_OPENAI_KEY` set in that account's environment and
read access to a checkout whose dependencies are installed:

```sh
pnpm desktop:smoke:windows -- --artifact desktop/release/publish/Animama-<version>-x64-setup.exe --setup name
```

It checks the installer's signature, installs it silently for that user,
checks the installed `Animama.exe` signature and runtime inventory, and runs
the same journey with a system-only PATH. Each recorded child must run from the
installed runtime inside its process guard. After every quit, no process from
the install folder may remain. The report binds `installer_sha256` and the
runtime build ID.

`desktop/release/smoke-name/` contains sanitized smoke and categorical
renderer request/response reports. They retain no URLs, principal/chat IDs,
credentials, message bodies, or absolute host paths. Capture begins when the
harness attaches; it is not a system-wide packet trace or proof of every native
process's network behavior. Any observed second renderer host/object-store URL
fails, and successful typed bytes must be same-origin and match their descriptor.
Manual acceptance must also check native network behavior where automated
renderer capture cannot observe it.

On a clean test Mac, check avatar animation, PocketTTS, microphone permission,
PiP, quick chat, offline dictation after installing offline speech in Voice
settings (with no backend restart or window reload), any active expanded content,
document conversion, interrupted pack installation/recovery, and an actual
prompted upgrade preserving the principal, chats, content, provider status,
database, and compatible pack. Confirm no unintended provider/model downloads.
Use a normal Finder/LaunchServices app launch for macOS permission checks; a
direct automation launch's privacy context is not microphone acceptance. The
unsigned development journey does not approve the signed entitlement set.
Test migration failure/recovery with a disposable profile, preserving its dump.
Record the exact candidate DMG hash and an **older** signed test version in the
acceptance receipt. Never downgrade a profile already opened by the new app.

On a clean Windows 11 test machine, the Windows receipt
(`ANIMAMA_WINDOWS_ACCEPTANCE`, from `windows-acceptance.example.json`) records:

- avatar animation, PocketTTS, the microphone, PiP, quick chat, global
  shortcuts and offline dictation;
- SmartScreen's behavior when the installer is downloaded in a browser;
- the installer's upgrade, uninstall-keeps-data and reinstall journey;
- a prompted upgrade from an older signed version that keeps local state, and
  migration snapshot recovery;
- native network behavior.

With the current embedded catalog, pack installation needs the selected
distribution to serve anonymous public URLs before native download acceptance
can finish. A private destination does not add private download support; failures must remain recoverable and must
not block the core app. No token, feed override or unsigned-worker bypass is allowed.
Public preview and QA feeds are currently not authorized. A different private
testing transport would require separate design/approval, not a build flag.
If the owner later approves public distribution, after the required-name smoke
passes, separately approve a **public testing preview**:
the same signed app, packs and notices are published without the stable update
feed or final acceptance reports, so the installed stable updater ignores them.
On GitHub they form a prerelease that is not marked latest. On R2 they become
public app objects under `desktop/v<version>/` and shared model objects under
`models/`, permanently locked by the bucket
rule, so a preview cannot be withdrawn and its version cannot be reused. This is still public distribution, so all
source/license/signing approvals and a separate preview-publication approval
are required. Do not publish a preview merely because a build succeeded.

For a first release there is no existing signed predecessor. Build one for QA
with the same app ID/Team ID and a dedicated public QA destination (a separate
GitHub repository or R2 base URL in reviewed QA release inputs).
After explicit authorization, mirror the exact candidate ZIP/feed/packs there
to test the updater before production promotion. The candidate's own embedded
policy may point to production after replacement. The older private QA build
must contain the candidate's exact compatible pack entries, including their
production-preview URLs; otherwise it tests incompatible-pack retention, not
preservation of an active compatible pack. Configure this through reviewed QA
release inputs committed to `main`, not by changing an installed profile. Do not add a runtime feed URL
override or give installed apps a token. Creating that QA destination or
publishing to it is a separate operator action, not something this
workflow silently does. Without this native upgrade evidence, stable promotion stays
closed.

## Manual publication and future CI

The initial process uses local build/signing tools, separate fresh-account
smokes, an exact human acceptance receipt and explicit publisher commands on the
maintainer's Mac. It does not need GitHub environment secrets. Keep repository
visibility and all approval fields unchanged until their independent gates pass.
See [Release process](release-process.md) for ordering and artifact names.

`.github/workflows/release-desktop-macos.yml` is manual-dispatch only. The native
jobs use arm64 `macos-15`; backend tests use Ubuntu with Docker support. Actions
are pinned by full commit SHA, and Node, pnpm, Python, and uv versions are fixed.
The required-name smoke job uses a fresh runner profile, not a local Compose
stack. It checks blank-name rejection and successful named setup in one run.

After the maintainer/main guard, `source-validation` reuses
`.github/workflows/validate-public.yml` from the same commit. Its single
`Validation` job always executes the full backend/static and portable product
contract for release callers before either the release build or `prepare-worker`
can reach signing credentials. Local receipts and routine-change reductions are
not substitutes for this release gate. Checkout uses
the dispatch's immutable `github.sha` throughout; this gate does not consult a
previous branch run or assume a moving `main` is validated. Release secrets are
not passed to reusable source validation. Backend or asset failures block signing
instead of substituting the older reduced release check set.

This local workflow dependency does not configure branch protection, create
GitHub environments, or authorize a dispatch. Keep the following environment and
publication approvals separate from source validation.

Before enabling credential-bearing CI jobs, configure supported protected
environments and restrict their deployment branches to `main` (not tags). The
initial job already requires `refs/heads/main`, the source repository, and
`raymond-van` as both the original and rerun actor. Every other job depends on
that guard. Branch code can change a workflow guard, so it does not replace
GitHub's environment restrictions or an explicit publication approval.

Under the sole-maintainer process, `raymond-van` reviews the exact
artifacts and acceptance evidence. If protected environments are later enabled,
set that account as the required reviewer and allow self-review so the same
person can dispatch and approve. Approval remains a separate action after artifact inspection.

Before adopting CI publication, verify that the repository's GitHub plan can
provide the required protected environments and reviewer gates using
[GitHub environment documentation](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).
Keep CI publication unused and secrets unset until those controls are configured.
The standalone commands are the manual mechanism; credentials and authorization
for public distribution remain separate. Do not change visibility or billing,
or create unprotected environments, to bypass an approval gate.

| Environment                 | Secrets and purpose                                                                                                                                                                                                                       |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `desktop-macos-signing`     | `ANIMAMA_MACOS_CERTIFICATE_BASE64` (P12), `ANIMAMA_MACOS_CERTIFICATE_PASSWORD`, `ANIMAMA_APPLE_ID`, `ANIMAMA_APPLE_APP_PASSWORD`                                                                                                          |
| `desktop-macos-smoke`       | `ANIMAMA_SMOKE_OPENAI_KEY` for the explicitly requested real API smoke                                                                                                                                                                    |
| `desktop-macos-preview`     | `ANIMAMA_R2_ACCOUNT_ID`, `ANIMAMA_R2_ACCESS_KEY_ID`, `ANIMAMA_R2_SECRET_ACCESS_KEY` for model objects in both app distributions; also scoped `ANIMAMA_RELEASE_TOKEN` for GitHub app artifacts. Separate public-preview approval required. |
| `desktop-macos-publication` | The same credentials and exact human `ANIMAMA_MACOS_ACCEPTANCE` JSON; require separate `raymond-van` approval under the sole-maintainer policy.                                                                                           |

The signing helper creates a temporary CI Keychain, imports credentials without
printing them, stores the notary profile, and restores/deletes its Keychain in an
always-run cleanup step. Signing credentials are not available to test/build
steps through environment variables and are never artifact inputs.

If CI publication is configured, the initial release does not dispatch
`prepare-worker` or import a document helper because document processing is
deferred. After committing reviewed core inputs, dispatch `release`. The workflow checks/tests,
stages/audits, signs the candidate, and runs the required-name fresh-profile smoke. With
`publish=false` it stops there. With `publish=true`, a protected preview job first
requires explicit approval for public testing. It publishes the immutable
candidate assets and notices as a preview (a GitHub prerelease, or locked R2
version objects) without changing the stable feed. The stable
publication job then waits at a different protected environment while you test
native behavior and the actual upgrade. Only approve it after supplying the exact
manual receipt. Inspect artifacts at each gate; do not approve in anticipation.

For a future document-pack activation, dispatch `prepare-worker`, preserve and
review its private Actions artifact, then update the release workflow to import
that exact approved run before marking the pack active. Never reuse a helper by
filename or rebuild it after its inventory approval.

The `distribution` workflow input (default `r2`) sets
`ANIMAMA_RELEASE_DISTRIBUTION` for every job. The workflow does not yet run the
release scan, so its publish jobs refuse candidates until a reviewed scan
receipt is part of the CI candidate.

The standalone publisher requires all candidate/smoke directories above, a
passing `release-scan.json` covering every candidate file, the selected
distribution's credentials and an explicit command for the requested stage. Preview requires
the passing required-name setup smoke and explicit public-distribution approval; it does not
manufacture native acceptance:

```sh
node desktop/scripts/runtime/publish-macos.mjs --confirm-preview-publication
```

After manual acceptance, supply its JSON and promote the same bytes:

```sh
node desktop/scripts/runtime/publish-macos.mjs --confirm-publication
```

On the Windows host, `publish-windows.mjs` takes the same two options and
publishes the Windows candidate, with `ANIMAMA_WINDOWS_ACCEPTANCE` for stable
promotion. It refuses a signing rehearsal. Files whose names both targets use,
such as `backend-model-assets.json`, must match byte for byte: on R2 the
Windows publisher checks them before uploading anything.

The publisher verifies local checksums, smoke hashes, manual acceptance and scan
coverage, then uploads a fixed artifact list:

- **GitHub:** creates or resumes only a draft or testing prerelease of the exact
  version and verifies GitHub's asset digests before promotion. A stable
  promotion may also add its target's files to a release the other target
  already published, until its own feed is there; the other target's files and
  the release description are left as they are, and the feed is uploaded last.
- **R2:** uploads each file create-only (`If-None-Match: *`) to
  `<base>/v<version>/<name>`, signed with its SHA-256 so R2 rejects altered
  bytes, with `Cache-Control: public, max-age=31536000, immutable`. It then
  downloads every object through the public domain and compares SHA-256. A
  preview stops there. Stable promotion rechecks the feed and writes the
  target's own feed, `<base>/latest-mac.yml` or `<base>/latest.yml`, last
  (`Cache-Control: no-cache`), then reads it back.

Stable publication adds the feed, checksum index and acceptance reports without
replacing preview payloads. Interrupted uploads leave the previous stable feed in
place. Retry accepts only byte-identical existing objects; a differing object
stops publication for inspection. An already stable release is never replaced. If
promotion's result is uncertain, inspect the remote state before retrying. Use a
new version for corrections.

### R2 operator setup

- Connect the custom domain `downloads.animama.ai` to the `animama-releases`
  bucket and keep the `r2.dev` public URL disabled.
- Add a bucket lock rule with indefinite retention on the prefix `desktop/v`, so
  published versions cannot be deleted or overwritten. The feed
  `desktop/latest-mac.yml` stays outside the rule.
- Add a second rule with indefinite retention on the prefix `models/` before
  publishing any model object (see [Model objects](#model-objects)).
- Create an R2 API token with **Object Read & Write** on `animama-releases` only.
  Pass its account ID, access key ID and secret as `ANIMAMA_R2_ACCOUNT_ID`,
  `ANIMAMA_R2_ACCESS_KEY_ID` and `ANIMAMA_R2_SECRET_ACCESS_KEY` for the publish
  command only; never commit, print or package them.
- Versioned objects are cached at Cloudflare's edge for up to a year. Deleting
  an object from the bucket does not remove cached copies; purge the exact URLs
  (Caching → Configuration → Custom Purge) as well. The feed is served
  `no-cache`; do not add a cache rule that caches `desktop/latest-mac.yml`.

### Model objects

Model files that the app downloads at runtime are published once under
`models/<model-id>/<file-sha256>/<file-name>`, independent of app versions. A
file's key is its own SHA-256, so published objects never change and an
unchanged file is never uploaded again. The packaged backend model-asset catalog
pins these URLs for both Parakeet sets, the Pocket voices and the cloning
encoder, including notice objects in each verified model inventory (see
[downloaded model assets](../../backend/operations/model-assets.md#downloaded-model-assets)).

Signed app candidates seal the required model manifests into
`runtime/model-manifests/<modelId>.json` before the runtime inventory is signed.
Candidate construction copies each verified model set to
`desktop/release/publish/models/<modelId>/` and exports the frozen backend catalog
as `backend-model-assets.json`. Model weights remain outside the app's flat
artifact index. `pnpm desktop:release:scan` validates these bindings and scans
every model candidate as well as the app. The publisher preflights all required
model inventories and scans before credentials or writes, then publishes and
anonymously verifies missing objects before publishing app artifacts. R2 model
credentials are therefore required even for a GitHub app distribution. The
stable app feed is promoted last.

Standalone model publication remains available:

From `src/frontend`, with the set already acquired into the model store:

```sh
pnpm --filter animama-desktop models:stage --model parakeet-tdt-0.6b-v2-webgpu
ANIMAMA_GITLEAKS=<verified-gitleaks> pnpm --filter animama-desktop release:scan --candidate release/models/parakeet-tdt-0.6b-v2-webgpu
pnpm --filter animama-desktop models:publish --model parakeet-tdt-0.6b-v2-webgpu --dry-run
pnpm --filter animama-desktop models:publish --model parakeet-tdt-0.6b-v2-webgpu --confirm-publication
```

- `models:stage` copies the verified store set and its tracked `manifest.json`
  into `desktop/release/models/<model-id>/` with an artifact index; it never
  downloads.
- `models:publish` refuses a candidate that differs from the tracked manifest,
  lacks a passing scan of its exact files, or does not create every catalog URL
  under that model.
- For each file it first asks the bucket, through a signed `HEAD`, whether the
  key exists. An existing object is never uploaded again, even if the public
  domain has not served it yet; otherwise it uploads create-only with immutable
  caching. Transfers allow extra time in proportion to the file's size.
- Every object must then be served anonymously as exactly its bytes: `200`, no
  `Content-Encoding`, the exact `Content-Length` and SHA-256, the same
  conditions the app's downloader enforces.
- `--dry-run` lists the keys and scan status without reading credentials. A
  missing or stale scan is refused before credentials are read. Publishing uses
  the same `ANIMAMA_R2_*` token as releases and needs owner approval.

A corrected file has a new hash and therefore a new key; update the catalog to
it. Never replace a published object.

The canonical generated evidence is the complete tree in `desktop/release/publish`,
with `SHA256SUMS.txt` and `signing-report.json`. See the [evidence map](release-process.md#evidence-and-actual-artifact-names)
for the required-name smoke and network report paths.

## Recovery and retention

Before a changed Alembic head, the supervisor writes a private custom-format
`pg_dump`, verifies it with `pg_restore --list`, fsyncs and atomically publishes
it beneath `backups/pre-migration/<from>-to-<to>/`. Retry reuses the original
snapshot. A failed or interrupted migration marks it permanently retained.
After two distinct successful app launches on the new head, older known-successful
snapshots may be pruned; the newest snapshot, all failed/interrupted snapshots,
and unrecognized entries remain. Provider restarts and Retry clicks are not
additional launches.

The stage audit restores a real dump into a separate temporary database and
checks the principal, schema and owner-scoped rows. Component backup/retention
checks do not replace signed forward-upgrade or recovery-UI acceptance.

Recovery displays the relative snapshot location and fixed **Open Backups**,
**Open Logs**, **Retry**, and **Quit** actions. Dumps do not include local files,
the vault, or the OS keychain, so they are not complete installation backups.
Never automatically restore or downgrade a live database. Preserve the current
closed app's entire data tree before an operator-directed recovery.

A failed update check/download leaves the current app running. A failed native
signature/preparation step can restart the unchanged old services. A native
installer timeout is uncertain, so services stay stopped and recovery offers
Quit; do not resume writes while the OS may still be preparing replacement.
Every newly installed app checks its runtime manifest before PostgreSQL bootstrap.
For a bad manifest, reinstall the prior signed app only if this replacement has
not changed the database; preserve all user data and snapshots first.
