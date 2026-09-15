# macOS releases and updates

Phase 4 adds signed-release tooling, guarded updates, migration snapshot retention,
and an installed-artifact smoke harness. **No accepted release has been produced.**
The unlicensed decorative SFX, downloaded voice samples, Tokyo backgrounds and
thumbnails, and BGM examples/metadata are excluded. The remaining
initial core/Parakeet reviews and native signing/notarization are complete; the
signed candidate still requires fresh-profile and manual native acceptance. On
2026-09-03 the owner confirmed
enrollment and explicitly declined public repository visibility. Local candidate
builds are allowed; public publication is not. Unit tests cannot approve
redistribution, notarization, native audio, or an actual upgrade.

This guide covers macOS 15+ on Apple silicon. The owner has this MacBook on
macOS 26.6 available; `sw_vers` reports 26.6.2 (25G83). That is not clean-machine
or minimum-supported-OS evidence. The owner explicitly approved macOS 15 as
the new minimum on September 3; macOS 15 acceptance remains required.
Personal microphone, voice, window and shortcut acceptance remains unknown.
Windows packaging is Phase 5.
The main Compose stack at `http://localhost:8000` is unrelated to release testing;
these commands neither reset it nor create another Compose stack.

Initial release publication will be run manually by `raymond-van` from reviewed
`main` inputs. Start with the [maintainer release process](release-process.md)
for the ordered gates and future commands; this page is the tooling reference.
The CI deployment workflow remains unconfigured for this initial path.

## What people see

A signed, configured app checks the public GitHub release feed 15 seconds after
startup. Offline checks time out without blocking the application. Settings →
General also offers **Check for updates**. A notice offers **Download update**;
the separate **Restart to install** action asks for confirmation before stopping
local services. Closing the notice or quitting normally does not install a
downloaded update. Unpackaged or unconfigured builds do not offer updates.

Only the registered main window can check, download, or restart. Renderer IPC
accepts no release URL, version, token, executable, or filesystem path. It returns
bounded status, byte counts, progress, and safe error categories. The updater
uses a separate Electron network session restricted to the configured public
GitHub repository and its asset CDN. No Animama account or GitHub token is
required for the installed application.

The pinned `electron-updater` 6.8.9 adapter sets `autoDownload=false` and
`autoInstallOnAppQuit=false`, permits stable forward arm64 updates only, and
disables differential downloads. It checks the exact approved ZIP size/SHA-512
and refreshes the feed before downloading so a changed candidate needs another
check. Squirrel, Electron's native macOS installer, performs replacement
signature verification only after explicit Restart and successful shutdown.
Do not copy options from a newer updater version without checking its API.

Before both download and restart, the supervisor checks free space, active pack
operations, document jobs, and expanded-content references. An update that would
strand referenced expanded content is blocked. The required free space is two
download archives, two installed app copies, twice the current PGDATA byte count,
and a 256 MiB reserve. Existing data or packs are never assumed reclaimable.

## Release inputs and permissions

Keep source and the distribution repository private. A signed candidate builder
uses explicitly configured repository coordinates to pin future installer/update
and pack URLs, but does not query GitHub, require a GitHub token or upload assets.
Only preview/stable publication checks anonymous public repository access, before
preparing promotion reports or making authenticated API calls. It then rechecks
visibility through the authenticated API before uploading. A local signed build
does not approve public distribution; notarization still submits binaries to Apple.
Neither path infers the repository from the source remote or embeds a token in the app.

On 2026-09-02 the owner selected **`raymond-van/animama-releases`**, private
initially, and authorized its creation. GitHub accepted the private creation
request; the initial credential readback returned 404. The owner subsequently
confirmed that the repository exists with one README commit. A later read-only
API check returned HTTP 200 and private visibility for both source and
distribution repositories, with administrative access through the normal Git
credential helper. This resolves the earlier readback uncertainty, but it does
not configure a scoped CI publishing token. The source repository has Actions
enabled, read-only default workflow-token permissions, and no environments yet.
The owner selected `raymond-van` as the sole release approver and `main` as the
release branch. The workflow now rejects other branches, forks, dispatchers and
rerun actors before credential-bearing jobs. This checked-in guard is not a
GitHub environment protection rule or an approval to publish.
The read-only account lookup reports the Free plan, which cannot provide the
planned approval environments for this private source repository. Environment
setup/scoped CI access is not required for the chosen initial manual process.
The owner explicitly accepted manual publication on 2026-09-02; configure
supported CI protections only if later choosing CI deployment. No application
source or release assets were uploaded, and the manual choice does not approve
public visibility, a credential, or a particular candidate.
`feature-pack-releases.json` records the future release URL and the approved
Parakeet inventory. `release-policy.json` records the owner's exact approval of
the regenerated core inventory after the provenance update. The private
preparation repository is not a working download/update feed.
The owner explicitly declined public visibility on 2026-09-03. This is no longer
a candidate-build prerequisite. Under the existing public-download architecture,
preview/stable publication still requires a new explicit decision authorizing
public access; it is not an action to take now. Signing and inventory review
remain required for candidates, and no approval hash is filled automatically.

No local `animama-releases` checkout was created or is required for publishing.
The release workflow lives in the source repository and uploads installers,
packs, notes, and update metadata through the GitHub Releases API. Those files
are release assets, not binary files committed to the distribution repository.
Release publication can create version tags without adding source commits.
The initial README commit came from repository initialization; future README
edits can use GitHub or an optional local clone. Ordinary source commits do not
publish a release: the checked-in workflow is manually dispatched, with
publication disabled by default and separate approval gates.

Public open-source projects can keep source and releases in one public
repository. This separate distribution repository is useful because Animama's
source is private; release visibility follows repository access. Public downloads
will require an explicitly authorized visibility change to this repository, or
a separately designed public distribution host, not making the source public.

| Input                                           | Required operator decision                                                                                                                                                                           |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `desktop/runtime/release-policy.json`           | Intended GitHub `owner`/`repo` (may remain private while building), stable channel, human redistribution receipt                                                                                     |
| `desktop/runtime/feature-pack-releases.json`    | The same repository and exact `v<app-version>` release URL, approved active-pack hashes, explicit deferred-pack status, Apple Team ID, Developer ID identity, document-helper designated requirement |
| `desktop/runtime/macos-acceptance.example.json` | Template only; a reviewer must supply the actual DMG hash, date, identity, prior signed version, and completed checks                                                                                |
| `desktop/runtime/size-baseline.json`            | Update only from a successfully released artifact, never a partial stage or estimate                                                                                                                 |

The ignored starter SFX and downloaded example media are intentionally excluded, as described in
[Runtime staging](runtime-staging.md#current-content-gate). Do not restore them
as release inputs. Review every remaining third-party
dependency/model/asset and its required notices; `NOASSERTION` and a generated
inventory are not permission to distribute. The core review receipt binds the
SHA-256 of staged `runtime/licenses/inventory.json`. That inventory includes
dependency locks and exact source-asset hashes. Changed inputs require review
again. A build never fills approval fields automatically.

The checked-in parent entitlement candidate enables JIT and microphone input;
the inherited candidate enables JIT only. Neither enables unsigned executable
memory or disabled library validation. This smaller entitlement set has **not**
passed native ONNX/Electron/input-hook/audio acceptance. Keep the release gate
closed until those exact signed binaries pass; if a specific exception is needed,
record why and repeat signing, size, and acceptance checks for the new artifact.

## Build and preserve the reviewed helper

Verified Apple metadata (2026-09-03): Team ID `9XHPMZ723L` and signing identity
`Developer ID Application: RAYMOND VAN (9XHPMZ723L)`. The owner reports that
`notarytool history` succeeds with profile `animama-notary`. Those public values,
a matching document-worker signature requirement, and the intended private
repository coordinates are now configured in the release inputs.
The profile name goes in `ANIMAMA_MACOS_NOTARY_PROFILE`; passwords
and signing private keys remain in the maintainer's Keychain, never in this repository.
The exact Parakeet inventory and regenerated core inventory are approved;
configuration alone is not proof of a successful signed build.
Electron Builder receives the certificate name `RAYMOND VAN (9XHPMZ723L)`
because version 26 rejects the certificate-kind prefix in its selector. Direct
nested and DMG `codesign` calls continue to use the full configured identity.
The earlier required-timestamp/HTTP-404 retry blocker was resolved by interactive
command approval; the targeted signature succeeded. A subsequent bundle-layout
failure is corrected with a native launcher and explicitly signed Resources
payload; see [Runtime staging](runtime-staging.md#separate-document-worker).
The corrected full producer passed Developer ID signing, Apple notarization,
stapling, Gatekeeper and its frozen local-PDF probe. It exported
`worker-review.json` with the exact unapproved inventory and size measurements;
this does not approve or publish the worker.
Native verification also caught a missing `=` prefix on literal `codesign -R`
arguments. All worker/core/smoke/updater checks now pass literal source; the
pinned publisher/identifier requirements are unchanged.
The independent deployment-target
audit also found current core/worker libraries require macOS 14 despite the
earlier macOS 13 target. The owner approved macOS 15 instead. Build settings,
runtime admission and updater metadata now use that target; a fresh guarded
build is required. Do not suppress timestamping or patch dependency headers to
claim compatibility.

Run native builds on Apple silicon with the pinned toolchain from the staging
guide. Configure an existing notarization Keychain profile and set its name in
`ANIMAMA_MACOS_NOTARY_PROFILE`; never put passwords in source or shell history.
Commands below run from `src/frontend`.

```sh
pnpm desktop:runtime:document-worker -- --platform darwin --arch arm64
```

The document pack is deferred from the first release. For a future activation,
the Phase 3 producer freezes the helper, signs and notarizes it, staples it,
verifies its publisher, and runs the frozen conversion probe. Phase 4 additionally
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
bytes. Review the active Parakeet inventory through the existing pack producer.
Expanded Included content and document processing are explicitly deferred from
the first release and must be absent from its catalog and release artifacts.

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
Parakeet only), rejects deferred entries, signs nested
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

## Installed-artifact smoke and manual acceptance

Use a dedicated fresh macOS account or a fresh CI runner for the setup smoke.
The owner has prepared the account display name **Animama Test**. Arrange a real
login and confirm its clean profile; do not infer the short name or home path,
impersonate its session, or change HOME. A privately transferred DMG is sufficient
for the core smoke. No public GitHub visibility or signing credential is needed
in the test account.
The harness refuses an existing Animama/legacy profile or installed test app.
It never resets data, changes HOME, or sets packaged developer overrides.
Provide `ANIMAMA_SMOKE_OPENAI_KEY` explicitly for two short real starter chats;
the harness does not load developer `.env` files. Those API calls incur provider
usage. The key travels through the normal setup UI into the encrypted vault.
After checking restart persistence, the harness deletes this temporary OpenAI
credential through the normal vault API and verifies absence after another
restart. Failure paths attempt the same cleanup before shutdown; a failed
cleanup fails the smoke and reports the required manual removal. It never
changes the source key or any other account's vault. Owner authorization for
the September 3 run covers two short calls and this temporary-copy cleanup only.

```sh
pnpm desktop:smoke:mac -- --artifact desktop/release/publish/Animama-<version>-arm64.dmg --setup name
```

The smoke rejects empty and all-whitespace names before completing named setup.
There is no Skip variant; required-name evidence gates publication.
The harness checks the signed DMG and contained app, installs into the absent
`~/Applications/Animama.app`, launches with a system-only PATH, verifies child
executables belong to app resources, and tests setup, provider status, gateway
rejection, core capabilities, both starter chats, exact typed bytes, private
upload, restart persistence, temporary-key removal, and owned shutdown. It leaves the profile and app
intact for inspection. A missing provider or failed journey is a failure, not a
skipped success.

`desktop/release/smoke-name/` contains sanitized smoke and categorical
renderer request/response reports. They retain no URLs, principal/chat IDs,
credentials, message bodies, or absolute host paths. Capture begins when the
harness attaches; it is not a system-wide packet trace or proof of every native
process's network behavior. Any observed second renderer host/object-store URL
fails, and successful typed bytes must be same-origin and match their descriptor.
Manual acceptance must also check native network behavior where automated
renderer capture cannot observe it.

On a clean test Mac, check avatar animation, PocketTTS, microphone permission,
PiP, quick chat, offline dictation after Parakeet installation, any active expanded content,
document conversion, interrupted pack installation/recovery, and an actual
prompted upgrade preserving the principal, chats, content, provider status,
database, and compatible pack. Confirm no unintended provider/model downloads.
Use a normal Finder/LaunchServices app launch for macOS permission checks; a
direct automation launch's privacy context is not microphone acceptance. The
unsigned development journey does not approve the signed entitlement set.
Test migration failure/recovery with a disposable profile, preserving its dump.
Record the exact candidate DMG hash and an **older** signed test version in the
acceptance receipt. Never downgrade a profile already opened by the new app.

With the current embedded catalog, pack installation needs anonymous public URLs
before native download acceptance can finish. Keeping the repository private
does not add private download support; failures must remain recoverable and must
not block the core app. No token, feed override or unsigned-worker bypass is allowed.
Public preview and QA feeds are currently not authorized. A different private
testing transport would require separate design/approval, not a build flag.
If the owner later approves public distribution, after the required-name smoke
passes, separately approve a **public testing preview**:
the same signed app, packs and notices become a GitHub prerelease, without the
stable update feed or final acceptance reports. It is not marked latest and the
installed stable updater ignores it. This is still public distribution, so all
source/license/signing approvals and a separate preview-publication approval
are required. Do not publish a preview merely because a build succeeded.

For a first release there is no existing signed predecessor. Build one for QA
with the same app ID/Team ID and a dedicated public QA distribution repository.
After explicit authorization, mirror the exact candidate ZIP/feed/packs there
to test the updater before production promotion. The candidate's own embedded
policy may point to production after replacement. The older private QA build
must contain the candidate's exact compatible pack entries, including their
production-preview URLs; otherwise it tests incompatible-pack retention, not
preservation of an active compatible pack. Configure this through reviewed QA
release inputs committed to `main`, not by changing an installed profile. Do not add a runtime feed URL
override or give installed apps a private-repository token. Creating that QA
repository or publishing to it is a separate operator action, not something this
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

Before enabling credential-bearing CI jobs, configure supported protected
environments and restrict their deployment branches to `main` (not tags). The
initial job already requires `refs/heads/main`, the source repository, and
`raymond-van` as both the original and rerun actor. Every other job depends on
that guard. Branch code can change a workflow guard, so it does not replace
GitHub's environment restrictions or an explicit publication approval.

The owner selected a sole-maintainer process: `raymond-van` reviews the exact
artifacts and acceptance evidence. If protected environments are later enabled,
set that account as the required reviewer and allow self-review so the same
person can dispatch and approve. This supersedes the earlier two-person/no-self-
approval requirement; approval must still be a separate action after inspection.

GitHub currently offers private-repository environments on Pro/Team/Enterprise,
but required reviewers on private repositories require Enterprise. The current
personal Free account cannot enforce this setup; upgrading only to Pro would
not supply the required reviewer gate. See [GitHub environment availability](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).
Leave CI publication unused and secrets unset. The standalone commands below
are the owner-approved initial mechanism without claiming GitHub environment
approvals; credentials and public-distribution authorization remain separate.
Do not make
source public, change billing, or create an unprotected environment as a workaround.

| Environment                 | Secrets and purpose                                                                                                                                                                       |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `desktop-macos-signing`     | `ANIMAMA_MACOS_CERTIFICATE_BASE64` (P12), `ANIMAMA_MACOS_CERTIFICATE_PASSWORD`, `ANIMAMA_APPLE_ID`, `ANIMAMA_APPLE_APP_PASSWORD`                                                          |
| `desktop-macos-smoke`       | `ANIMAMA_SMOKE_OPENAI_KEY` for the explicitly requested real API smoke                                                                                                                    |
| `desktop-macos-preview`     | Scoped `ANIMAMA_RELEASE_TOKEN`; require separate approval to expose test binaries/packs publicly, without a stable feed                                                                   |
| `desktop-macos-publication` | Scoped `ANIMAMA_RELEASE_TOKEN` for the public distribution repo and exact human `ANIMAMA_MACOS_ACCEPTANCE` JSON; require separate `raymond-van` approval under the sole-maintainer policy |

The signing helper creates a temporary CI Keychain, imports credentials without
printing them, stores the notary profile, and restores/deletes its Keychain in an
always-run cleanup step. Signing credentials are not available to test/build
steps through environment variables and are never artifact inputs.

The initial release does not dispatch `prepare-worker` or import a document
helper because document processing is deferred. After committing reviewed
Parakeet/core inputs, dispatch `release`. The workflow checks/tests,
stages/audits, signs the candidate, and runs the required-name fresh-profile smoke. With
`publish=false` it stops there. With `publish=true`, a protected preview job first
requires explicit approval for public testing. It uploads immutable candidate
assets/notices as a prerelease, leaving the stable feed private. The stable
publication job then waits at a different protected environment while you test
native behavior and the actual upgrade. Only approve it after supplying the exact
manual receipt. Inspect artifacts at each gate; do not approve in anticipation.

For a future document-pack activation, dispatch `prepare-worker`, preserve and
review its private Actions artifact, then update the release workflow to import
that exact approved run before marking the pack active. Never reuse a helper by
filename or rebuild it after its inventory approval.

The standalone publisher requires all candidate/smoke directories above, the
scoped token and an explicit command for the requested stage. Preview requires
both passing setup smokes and explicit public-distribution approval; it does not
manufacture native acceptance:

```sh
node desktop/scripts/runtime/publish-macos.mjs --confirm-preview-publication
```

After manual acceptance, supply its JSON and promote the same bytes:

```sh
node desktop/scripts/runtime/publish-macos.mjs --confirm-publication
```

It verifies local checksums, smoke hashes and manual acceptance, creates/resumes
only a draft or testing prerelease of the exact version, uploads a fixed artifact
list, and verifies GitHub's asset digests before promotion. Stable publication
adds the feed, checksum index and acceptance reports without replacing preview
payloads. Interrupted uploads leave a draft or preview without stable promotion.
Retry accepts only byte-identical completed assets; conflicts need inspection.
An already stable release is never replaced. If promotion's result is uncertain,
inspect the remote state before retrying. Use a new version for corrections.

The canonical generated evidence is the fixed set in `desktop/release/publish`,
with `SHA256SUMS.txt` and `signing-report.json`. Both setup-mode reports remain
distinct. See the [evidence map](release-process.md#evidence-and-actual-artifact-names)
instead of inventing the earlier plan's `checksums.sha256` or `.txt` signing report.

## Recovery and retention

Before a changed Alembic head, the supervisor writes a private custom-format
`pg_dump`, verifies it with `pg_restore --list`, fsyncs and atomically publishes
it beneath `backups/pre-migration/<from>-to-<to>/`. Retry reuses the original
snapshot. A failed or interrupted migration marks it permanently retained.
After two distinct successful app launches on the new head, older known-successful
snapshots may be pruned; the newest snapshot, all failed/interrupted snapshots,
and unknown/legacy entries remain. Provider restarts and Retry clicks are not
additional launches.

The 2026-09-02 native development check exercised the actual `PrivatePostgres`
and `MigrationBackup` services against disposable data. It verified reuse of the
original dump after a deliberately failed SQL transaction, restore of the
principal and pre-failure rows into a different database, interrupted-snapshot
preservation, and pruning only after two distinct launch IDs. It used synthetic
transition labels and launch IDs; this is not a signed-app forward upgrade or
an end-to-end migration-recovery UI test. The normal stage audit now also
requires a real restored database rather than only `pg_restore --list`.

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
