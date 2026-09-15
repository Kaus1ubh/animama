# Maintainer release process

**Initial policy (2026-09-02): `raymond-van` builds/reviews from `main` and runs
publication manually on their Mac.** This resolves the private GitHub Free-plan
approval limitation without exposing source or configuring unprotected CI secrets.
The checked-in CI workflow is future tooling, not the initial release path.

**Privacy decision (2026-09-03): do not publish or make the repository public.**
The owner has completed Apple enrollment; a valid Developer ID identity was
observed and the owner reports successful notarization-profile authentication.
The signed/notarized document worker exists as an unapproved future review
candidate, but its pack is deferred from the first release. The signed/notarized
local core candidate was completed and independently verified on 2026-09-04;
its fresh-profile/native acceptance, an actual upgrade and any public release
remain open.
The candidate builder no longer checks repository visibility;
it can produce local signed artifacts while `raymond-van/animama-releases`
remains private. Signing, notarization, exact inventory review and size gates
still apply. Naming the intended download repository does not authorize exposure.
Choosing a manual command is not approval to change visibility,
spend provider usage, supply secrets or publish a particular artifact. When all
gates pass, the maintainer receives the exact command and working directory for
the reviewed release. Commands below are the future runbook, not a request to run now.

## Release gates, in order

| Gate                          | What must be true before continuing                                                                                                                                                                                                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inputs                        | Apple Team ID, Developer ID identity and local notarization Keychain profile are configured; content/dependency terms and notices are reviewed. Keep credentials out of source and chat.                                                                                                        |
| Candidate coordinates         | Configure the intended repository and matching versioned pack URLs. They may name the private distribution repository; no GitHub token, visibility check or upload is needed to build.                                                                                                          |
| Reviewed packs                | The exact Parakeet inventory is approved. Expanded content and document processing are explicitly deferred from the first release; preserve the signed/notarized worker as future review input without advertising or approving it.                                                             |
| Candidate                     | From reviewed release inputs on `main`, stage, audit and build the local signed DMG/ZIP. Check sizes, hashes, signatures, notarization and notices. A build never uploads to GitHub; notarization sends the binaries to Apple.                                                                  |
| Automated acceptance          | Run the required-name setup smoke on a fresh macOS account/runner. It rejects blank input before named completion. Explicit provider-key approval is needed for real chat calls. Never reset the maintainer's normal desktop profile.                                                           |
| Distribution / public preview | Currently not authorized. The existing publisher requires anonymous public repository access and separate approval of the exact candidate/packs. A private repository cannot serve installed-app downloads; a different private testing transport would require a separate design and approval. |
| Native acceptance             | Check physical microphone/audio, windows/shortcuts, offline dictation, packs/document conversion, failures/recovery and a real forward signed upgrade. Record supported OS and compatible app/pack versions actually exercised.                                                                 |
| Stable promotion              | `raymond-van` reviews the exact DMG-bound manual receipt and required-name smoke/network reports, then runs the final publisher command.                                                                                                                                                        |

Windows Phase 5 is deferred. The owner accepts macOS 26-only runtime testing for
this plan; actual macOS 15 testing remains explicitly unperformed even though 15
is the declared minimum. The available MacBook runs macOS 26.6.2. Neither
the earlier unsigned evidence nor the completed signed candidate waives these gates.
The September 3 static audit found macOS 14 deployment requirements in current
core/worker dependencies. The owner subsequently approved macOS 15 as the
minimum. All native inputs must pass a fresh audit for that target; older
macOS-13 manifests/receipts cannot be reused. Earlier timestamp/layout failures
were resolved before the successful worker submission; do not reuse their
partial outputs. See [redistribution review](redistribution-review.md) for
the remaining asset/dependency review and owner-approved exclusions/deferral.

The owner reports a fresh macOS account named **Animama Test** is ready. Coordinate
an actual login to that account and verify the absence of Animama/legacy data and
the test app before running the required-name smoke. The display name is not a
verified account short name or home path. Do not fake HOME, reset another profile,
or copy signing/private-key credentials into this account. The signed DMG can be
transferred locally without a public URL; this tests fresh-profile installation,
not a clean machine without development tools or the minimum supported OS.

## Commands and inputs

Build details, helper reuse, token scope and first-release upgrade QA are in
[Release tooling](releases.md). From `src/frontend`, the candidate sequence is:

```sh
pnpm desktop:runtime:stage -- --platform darwin --arch arm64
pnpm desktop:runtime:audit -- --platform darwin --arch arm64
pnpm desktop:dist:mac
```

The signed helper and reviewed pack/core inputs must already be configured.
Public visibility and release-repository API availability are not candidate build
preconditions; dependency downloads and Apple notarization still need network access.
The embedded update and pack URLs remain pinned and anonymous:
while their repository is private, those network features cannot succeed. Core
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

After the distinct preview approval, the future preview command is:

```sh
node desktop/scripts/runtime/publish-macos.mjs --confirm-preview-publication
```

After actual native acceptance and the maintainer's final approval:

```sh
node desktop/scripts/runtime/publish-macos.mjs --confirm-publication
```

Both commands run from `src/frontend`. The process needs a narrowly scoped
`ANIMAMA_RELEASE_TOKEN` for the distribution repository. Stable publication also
needs `ANIMAMA_MACOS_ACCEPTANCE` containing the reviewed JSON itself, not a path.
Load these privately for the command; do not commit them, print them, place literal
secrets in shell history or bundle a GitHub token into the app. Clear the release
credential from the shell when finished. The example acceptance JSON is an
unapproved template and must never be filled automatically from test success.

Under the currently implemented transport, installed pack testing and first-release
upgrade QA still require preview/QA feeds in
[Release tooling](releases.md#installed-artifact-smoke-and-manual-acceptance).
The owner has deferred those real network tests and has not authorized public
distribution. Core candidate tests can proceed privately; production
download/upgrade acceptance stays open unless the owner later approves a feed
or separately scopes a secure private testing transport.
Manual publication does not bypass those feeds, native checks, licensing,
signatures or the older-signed-version requirement.

## Evidence and actual artifact names

The canonical candidate/publisher directory is `desktop/release/publish`.
The publisher uploads a fixed list of flat GitHub Release assets, not a source
commit or an arbitrary directory. These files are produced only after their
corresponding gates; their names here are not evidence that a release exists.

| Evidence                                                 | Actual output                                                                                             |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Installer and update archive                             | `Animama-<version>-arm64.dmg`, `Animama-<version>-arm64.zip`                                              |
| Exact resource/pack identities                           | `runtime-manifest.json`, `pack-catalog.json`                                                              |
| Component and pack sizes, including pack peak free space | `size-report.json`, `pack-build-report.json`                                                              |
| Dependencies, source review and notices                  | `sbom.cdx.json`, `THIRD_PARTY_NOTICES.txt`, `REDISTRIBUTION_REVIEW.json`, `redistribution-inventory.json` |
| Publisher/signature verification                         | `signing-report.json`                                                                                     |
| Local setup evidence before promotion                    | `desktop/release/smoke-name/{smoke,network}-report.json`                                                  |
| Stable acceptance assets                                 | `smoke-name-report.json`, `network-name-report.json`, `manual-acceptance.json`                            |
| Stable feed and integrity index                          | `latest-mac.yml`, `release-artifacts.json`, `SHA256SUMS.txt`                                              |
| Feature archives                                         | Exact filenames listed in `pack-catalog.json`; never substitute a guessed name/version                    |

The older plan's `release/evidence/...`, `checksums.sha256` and
`signing-report.txt` were proposed names, not implemented outputs. Use the
producer's canonical names above and preserve the named smoke and network reports. Preview omits
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

The publisher can resume byte-identical uploads for the same draft or testing
prerelease. If publication times out, inspect remote state before retrying; do
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
its backup, principal/vault, gateway and migration warnings. Preserve data and
bounded evidence before proposing a repair. Normal Retry is not a reset, and
rollback of app files is not permission to downgrade a migrated database.

To resume, review the [open release gates](#release-gates-in-order),
apply the verified signing metadata and review the exact inputs, then prepare the
signed helper and private candidate. Keep the acceptance receipt with the exact
candidate hashes, app/pack versions, operating system, tested journeys, remaining
limits and the maintainer's decision. The public-distribution decision is currently
no. Do not dispatch CI, change visibility or publish solely because enrollment completed.
