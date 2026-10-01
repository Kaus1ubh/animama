# Maintainer release process

The manual release process builds and reviews exact artifacts from `main`, then
uses separate preview and stable publication commands. `raymond-van` is the
configured maintainer. CI publication is not configured as the release path.

No public release is accepted. A local signed candidate can be built before the
selected distribution serves anything: its builder does not contact the
destination or upload release assets. Signing, notarization, complete
starter inputs and exact inventory review are still required. Public preview and
stable publication require distinct approval and anonymous download availability.
The commands below are a runbook; they do not authorize publication or visibility
changes. Core native acceptance, minimum-OS tests and a real forward upgrade
remain pending for the exact current candidate.

## Release gates, in order

| Gate                          | What must be true before continuing                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inputs                        | Apple Team ID, Developer ID identity and local notarization Keychain profile are configured; content/dependency terms and notices are reviewed. Keep credentials out of source and chat.                                                                                                                                                                                        |
| Candidate coordinates         | Select the app distribution with `ANIMAMA_RELEASE_DISTRIBUTION` (default `r2`) and keep it identical for stage, audit and `desktop:dist:mac`. Archive-pack and update URLs derive from it; model objects always use `downloads.animama.ai/models/`. No token, visibility check or upload is needed to build.                                                                    |
| Reviewed packs                | No pack is active: expanded content and document processing are explicitly deferred from the first release. Preserve the signed/notarized worker as future review input without advertising or approving it. The required model objects, including both Parakeet sets, are scanned with the candidate.                                                                          |
| Candidate                     | From reviewed release inputs on `main`, stage, audit and build the local signed DMG/ZIP. Check sizes, hashes, signatures, notarization and notices. A build never uploads to GitHub; notarization sends the binaries to Apple.                                                                                                                                                  |
| Automated acceptance          | Run the required-name setup smoke on a fresh macOS account/runner. It rejects blank input before named completion. Explicit provider-key approval is needed for real chat calls. Never reset the maintainer's normal desktop profile.                                                                                                                                           |
| Distribution / public preview | Currently not authorized. The publisher requires the selected destination to serve anonymously (a public GitHub repository or the R2 custom domain), a passing release scan and separate approval of the exact candidate/packs. A private destination cannot serve installed-app downloads; a different private testing transport would require a separate design and approval. |
| Native acceptance             | Check physical microphone/audio, windows/shortcuts, in-place offline speech install/removal and offline dictation, packs/document conversion, failures/recovery and a real forward signed upgrade. Record supported OS and compatible app/pack versions actually exercised.                                                                                                     |
| Stable promotion              | `raymond-van` reviews the exact DMG-bound manual receipt and required-name smoke/network reports, then runs the final publisher command.                                                                                                                                                                                                                                        |

Windows native packaging is deferred. macOS 15 is the declared minimum; actual
minimum-OS, clean-machine and signed acceptance require separate evidence.
Run native audits against matching current inputs and preserve their receipts.

Use a separate macOS test account, log in normally and verify that no Animama or
`Anima` profile or test app exists before running smoke. Do not fake HOME, reset
another profile or copy signing private keys into the test account. A locally
transferred DMG can test fresh-profile installation without a public URL; this
does not prove a clean machine or minimum-OS compatibility.

## Commands and inputs

Build details, helper reuse, token scope and first-release upgrade QA are in
[Release tooling](releases.md). Set the release version only in
`desktop/package.json`: it versions the packaged app, and the web build reports
it in About. First prepare complete release model inputs from the repository root:

```sh
python3 scripts/models/release_inputs.py \
  --root /absolute/release-model-store \
  --work-dir /absolute/voice-producer-work
export ANIMAMA_MODEL_ROOT=/absolute/release-model-store
```

This explicit producer command can bootstrap unpublished objects from pinned
upstream inputs. It checks existing encoded voice hashes and rejects generated
inventory drift; it never changes approvals or publishes. To reuse a verified
complete voice inventory, add `--import-voices /absolute/import-voice-set`.
See [model tooling](../../../scripts/models/README.md#release-only-bootstrap).
Ordinary web builds do not need optional voices or the cloning encoder.

From `src/frontend`, the candidate sequence is:

```sh
pnpm desktop:runtime:stage -- --platform darwin --arch arm64
pnpm desktop:runtime:audit -- --platform darwin --arch arm64
pnpm desktop:dist:mac
```

The signed helper and reviewed pack/core inputs must already be configured.
Public visibility and release-repository API availability are not candidate build
preconditions; dependency downloads and Apple notarization still need network access.
The embedded update and pack URLs remain pinned and anonymous:
until the selected destination serves them publicly, those network features cannot succeed. Core
startup and local functionality must still work. Do not embed tokens, add runtime
feed/catalog overrides, or call a manually copied pack a verified download.
Do not rebuild while an exact candidate is under acceptance: a signature or
input change invalidates its old hashes and receipts. Preserve
`desktop/release/publish` and the matching helper input outside disposable build
outputs before starting another candidate; `desktop:dist:mac` replaces its derived
candidate directory, not user data.

Use the exact candidate DMG on a fresh test account:

```sh
pnpm desktop:smoke:mac -- --artifact desktop/release/publish/Animama-<version>-arm64.dmg --setup name
```

Collect the resulting `desktop/release/smoke-name` directory alongside
the unchanged candidate on the publishing Mac. Reports must agree on the DMG
hash and runtime build ID. `<version>` is a placeholder, not a literal filename.
The smoke removes its temporary OpenAI credential and verifies that removal
survives restart. If its sanitized report asks for manual cleanup, remove that
test-account copy before continuing; do not clear the maintainer's normal vault
or change the original provider key.

Scan the exact candidate for secrets and private text before any upload. Use
the Gitleaks binary pinned in `scripts/repository-boundary/scanner-pins.json`,
verified against its archive digest; the command never downloads a scanner:

```sh
ANIMAMA_GITLEAKS=<verified-gitleaks> pnpm desktop:release:scan
```

Run it on the staged build machine: expanding the frozen backend uses the build
interpreter from `desktop:runtime:stage`. The scan mounts the DMG and expands the
update ZIP and archive feature packs, then every nested archive named `.zip`, `.whl`,
`.jar`, `.tar.gz`, `.tgz`, `.tar.zst` or `.asar`, and any PyInstaller executable.
Other compressed formats are scanned only as raw strings. Gitleaks must first
detect a generated canary token. It then scans every expanded file under a
neutral numbered name and header line, so its built-in path and file-type
exclusions (such as `node_modules/`, `*.dist-info` and SQLite or PDF headers) do
not apply; binaries are scanned as their printable strings. ONNX model weights
are excluded from Gitleaks because quantized tensors produce chance token
matches; the receipt counts them. Every expanded file, including ONNX, is also
byte-searched for this machine's home directory, the Git author email and any
extra values in `ANIMAMA_SCAN_PRIVATE_TEXT` (one per line; keep them out of
source and shell history). A symlink fails the scan when its target is absolute
or escapes its artifact, except an installer's `/Applications` link.

`release-scan.json` records the scanned file hashes, coverage counts, rule IDs
and locations, never matched values. Errors print only fixed messages; set
`ANIMAMA_SCAN_DEBUG=1` to see the underlying error locally. Do not publish a
candidate whose scan fails. Review each finding; add an accepted false positive
to `desktop/runtime/release-scan.gitleaks.toml` only as an exact placeholder
value or a known non-secret field. The receipt records that file's hash. The
home-directory search only catches the scanning machine's paths: scan on the
machine that built the candidate. The same command verifies candidate bindings
and scans every required `models/<modelId>/` directory as well as the app,
writing a receipt in each directory. Preserve all receipts with the candidate.
The release workflow does not install a verified scanner automatically, so its
publication steps remain fail-closed without these valid receipts.

After distinct preview approval, run:

```sh
node desktop/scripts/runtime/publish-macos.mjs --confirm-preview-publication
```

After actual native acceptance and the maintainer's final approval:

```sh
node desktop/scripts/runtime/publish-macos.mjs --confirm-publication
```

Both commands run from `src/frontend` with the same `ANIMAMA_RELEASE_DISTRIBUTION`
used to build the candidate. Both app distributions require the narrowly scoped
model credentials `ANIMAMA_R2_ACCOUNT_ID`, `ANIMAMA_R2_ACCESS_KEY_ID` and
`ANIMAMA_R2_SECRET_ACCESS_KEY`. A GitHub app distribution also requires
`ANIMAMA_RELEASE_TOKEN`
([operator setup](releases.md#r2-operator-setup)). Stable publication also
needs `ANIMAMA_MACOS_ACCEPTANCE` containing the reviewed JSON itself, not a path.
Load these privately for the command; do not commit them, print them, place literal
secrets in shell history or bundle a GitHub token into the app. Clear the release
credential from the shell when finished. The example acceptance JSON is an
unapproved template and must never be filled automatically from test success.

Under the currently implemented transport, installed pack testing and first-release
upgrade QA still require preview/QA feeds in
[Release tooling](releases.md#installed-artifact-smoke-and-manual-acceptance).
Real network acceptance and public-distribution approval remain pending. Core
candidate tests can proceed privately; production
download/upgrade acceptance stays open unless the owner later approves a feed
or separately scopes a secure private testing transport.
Manual publication does not bypass those feeds, native checks, licensing,
signatures or the older-signed-version requirement.

## Evidence and actual artifact names

The canonical candidate/publisher directory is `desktop/release/publish`.
The publisher uploads a fixed list of flat assets (GitHub Release assets, or
objects in the R2 version folder plus the root `latest-mac.yml` at stable
promotion), not a source commit or an arbitrary directory. These files are produced only after their
corresponding gates; their names here are not evidence that a release exists.
The private `models/<modelId>/` subdirectories contain separate raw model
candidates and their scans. Keep the complete candidate tree for handoff; model
directories are not flattened into the app artifact index. The publisher checks
all model bindings, inventories and scan receipts before credentials or writes,
then publishes and anonymously verifies required model objects before app
artifacts. Stable feed promotion remains last.

| Evidence                                                 | Actual output                                                                                             |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Installer and update archive                             | `Animama-<version>-arm64.dmg`, `Animama-<version>-arm64.zip`                                              |
| Exact resource/pack identities                           | `runtime-manifest.json`, `pack-catalog.json`                                                              |
| Frozen backend model catalog                             | `backend-model-assets.json`                                                                               |
| Required model candidates and scans                      | `models/<modelId>/` with raw files, manifest, integrity index and `release-scan.json`                     |
| Component and pack sizes, including pack peak free space | `size-report.json`, `pack-build-report.json`                                                              |
| Dependencies, source review and notices                  | `sbom.cdx.json`, `THIRD_PARTY_NOTICES.txt`, `REDISTRIBUTION_REVIEW.json`, `redistribution-inventory.json` |
| Publisher/signature verification                         | `signing-report.json`                                                                                     |
| Local setup evidence before promotion                    | `desktop/release/smoke-name/{smoke,network}-report.json`                                                  |
| Stable acceptance assets                                 | `smoke-name-report.json`, `network-name-report.json`, `manual-acceptance.json`                            |
| Stable feed and integrity index                          | `latest-mac.yml`, `release-artifacts.json`, `SHA256SUMS.txt`                                              |
| Archive feature packs                                    | Exact archive filenames in `pack-catalog.json` (none while every pack is deferred)                        |

Preview omits
the stable feed and final acceptance assets. Network reports cover renderer
events after harness attachment, not every native process; the separate human
native-network check remains required.

After actual release, verify remote asset hashes against the local index and
retain the exact reviewed artifacts and test notes, including the tested OS and
app/pack version matrix. Only then update `desktop/runtime/size-baseline.json`
from the released size report and record any approved exception. Do not turn
unsigned staging sizes, synthetic recovery tests or unbuilt worker estimates
into a release baseline or completed acceptance report.

## Failure and handoff

The publisher can resume byte-identical uploads for the same GitHub draft or
testing prerelease, or the same R2 version folder. If publication times out, inspect remote state before retrying; do
not replace conflicting assets or an already stable release. Rebuilding creates
a new candidate that requires fresh review, not permission to reuse old receipts.
For a notarization timeout, preserve the exact Apple submission ID and signed
app, then query that same request after restoring any missing Keychain profile.
Do not create duplicate submissions merely because a bounded wait expired. Once
that request is accepted, resume the preserved app from `src/frontend` with:

```sh
ANIMAMA_MACOS_NOTARY_PROFILE=<profile> pnpm desktop:dist:mac -- --resume-app-notarization <submission-id>
```

The resume command verifies the current staged review and preserved app seal,
waits on only that UUID, staples and rechecks the app, then gives Electron
Builder the app through its prepackaged input. It does not invoke the app signing
hook or upload another app copy. The DMG and update ZIP still receive their own
required notarization submissions. Notary waits are bounded at 60 minutes; an
unresolved Apple request remains pending rather than being treated as accepted.

For installed-app failures use [Troubleshooting](troubleshooting.md), especially
its backup, principal/vault, saved-port and migration warnings. Preserve data and
bounded evidence before proposing a repair. Normal Retry is not a reset, and
rollback of app files is not permission to downgrade a migrated database.

To resume, review the [open release gates](#release-gates-in-order),
apply the verified signing metadata and review the exact inputs, then prepare the
signed helper and private candidate. Keep the acceptance receipt with the exact
candidate hashes, app/pack versions, operating system, tested journeys, remaining
limits and the maintainer's decision. Public-distribution approval is separate. Do not dispatch CI, change visibility
or publish as part of candidate preparation.
