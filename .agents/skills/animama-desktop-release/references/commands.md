# Desktop release commands

`<primary>` is the primary checkout and `<release>` the release worktree. Run
commands from `<release>/src/frontend` unless a step says otherwise. On macOS,
start each shell with the nonsecret release environment:

```bash
cd <release>/src/frontend && . ../../.animama-drafts/desktop-release/release.env
```

These commands follow the [release process](../../../../docs/frontend/desktop/release-process.md);
when the two differ, the docs win. Report the difference.

## Published versions

```bash
curl -fsS https://downloads.animama.ai/desktop/latest-mac.yml | head -3
curl -fsS https://downloads.animama.ai/desktop/latest.yml | head -3
curl -s -o /dev/null -w '%{http_code}\n' -I "https://downloads.animama.ai/desktop/v<version>/Animama-<version>-arm64.dmg?noCache=$RANDOM"
curl -s -o /dev/null -w '%{http_code}\n' -I "https://downloads.animama.ai/desktop/v<version>/Animama-<version>-x64-setup.exe?noCache=$RANDOM"
```

The query keeps the edge from caching a 404 on the real URL, which would delay
the publisher's verification by up to 3 minutes.

Read the results:

- **`404`:** nothing is published at that URL.
- **Connection failure:** inconclusive. Retry, or ask the owner; never treat it as
  unpublished.
- **`200` for an installer:** that version is taken. A preview publishes no feed
  or artifact index, so probe the installers for every version you consider.

## Release workspace

```bash
git -C <primary> fetch origin
git -C <primary> worktree add -b build/desktop-release-<version> <worktrees>/desktop-release-<version> origin/main
cd <worktrees>/desktop-release-<version>
git lfs pull
pnpm -C src/frontend install --frozen-lockfile
```

Edit `"version"` in `src/frontend/desktop/package.json`, then commit:

```bash
git commit -am "build(desktop): set the desktop version to <version>"
```

Create `.animama-drafts/desktop-release/release.env` in the worktree. The
`.animama-drafts/` folder is ignored. Record only names and paths in it, never
secret values:

```bash
export ANIMAMA_RELEASE_DISTRIBUTION=r2
export ANIMAMA_MODEL_ROOT="$HOME/Library/Caches/Animama/models"
export ANIMAMA_MACOS_NOTARY_PROFILE=animama-notary
export ANIMAMA_GITLEAKS="$HOME/Library/Caches/Animama/tools/gitleaks-8.30.1/bin/gitleaks"
```

## Preflight

```bash
uname -sm
xcode-select -p
security find-identity -v -p codesigning
xcrun notarytool history --keychain-profile "$ANIMAMA_MACOS_NOTARY_PROFILE" >/dev/null && echo "notary profile ok"
test -r ~/.config/animama/mixamo-read.env && echo "pack read token present"
"$ANIMAMA_GITLEAKS" version
df -h .
python3 ../../scripts/heavy-slot.py --status
```

Check each result:

- `uname` prints `Darwin arm64`.
- The identity list includes the Developer ID identity named in
  `desktop/runtime/feature-pack-releases.json`.
- Gitleaks reports the version pinned in `scripts/repository-boundary/scanner-pins.json`.
- The disk has room for a stage, a signed build and the model candidates. The
  build itself refuses to run below 8 GiB. As a rule of thumb, ask before
  continuing with less than 30 GB free.

The owner's notary profile is `animama-notary`; the `history` call is read-only
and lists earlier submissions. If it fails, ask the owner, who restores it with
`xcrun notarytool store-credentials animama-notary`. If the Gitleaks copy is missing,
ask before downloading it, then verify the archive SHA-256 against
`scanner-pins.json`.

## Model inputs

From `<release>`:

```bash
python3 scripts/models/release_inputs.py --root "$ANIMAMA_MODEL_ROOT" --work-dir "$HOME/Library/Caches/Animama/voice-producer-work"
```

It never publishes. Encoding drift fails it: report the drift, and never approve
new hashes to make it pass.

## Dependency audit

Run the four audit commands in
[Commands and inputs](../../../../docs/frontend/desktop/release-process.md#commands-and-inputs)
from `<release>`. Each tool exits non-zero when it reports an advisory. That
section says which entries block and which are review-only. Then check Electron:

```bash
node -p "require('./desktop/node_modules/electron/package.json').version"
npm view electron dist-tags.latest
npm view "electron@<installed major>" version | tail -1
```

The installed version must be the newest in its major. That major must be one
of the latest three stable majors.

The `desktop>electron` prefix also matches electron-builder's packaging tools
(for example `desktop>electron-builder>app-builder-lib>…`). For each such
entry, report whether the package ships. After staging, check that it is
absent from `runtime/licenses/inventory.json`. The owner may then accept it as
build-time only. Record each accepted advisory and its reason in
`accepted-advisories.txt`.

## Packs, stage and audit

```bash
(set -a; . ~/.config/animama/mixamo-read.env; set +a; pnpm desktop:mixamo-motion fetch && pnpm desktop:private-pack --pack wow-comedy-sfx fetch)
ANIMAMA_REQUIRE_MIXAMO_MOTION=1 ANIMAMA_REQUIRE_WOW_COMEDY_SFX=1 python3 ../../scripts/heavy-slot.py -- pnpm desktop:runtime:stage -- --platform darwin --arch arm64 > ../../.animama-drafts/desktop-release/stage.log 2>&1
pnpm desktop:runtime:audit -- --platform darwin --arch arm64
git -C ../.. rev-parse HEAD > ../../.animama-drafts/desktop-release/staged-commit
```

Both packs use the Mixamo read-token file. Fix the following failures and stage
again:

- **Lockfile mismatch:** run `pnpm install --frozen-lockfile`.
- **Missing `dist-info` in `uv`:** see
  [runtime staging](../../../../docs/frontend/desktop/runtime-staging.md#native-macos-build).
  Never clean a cache that other sessions share.

The full output of each step is under `desktop/.desktop-runtime/<target>/`.

## Redistribution review

```bash
target=darwin-arm64
staged=desktop/.desktop-runtime/$target/runtime/licenses/inventory.json
shasum -a 256 "$staged"
node -p "require('./desktop/runtime/release-policy.json').redistribution_reviews['$target'].inventory_sha256"
```

The baseline is the last reviewed inventory, whose SHA-256 must equal the
receipt. Find it in one of these places:

- **The last published version**, preview or stable. Fetch
  `v<version>/redistribution-inventory.json` (Windows:
  `redistribution-inventory-win32-x64.json`) anonymously into
  `<primary>/.animama-drafts/desktop-release/reviewed-inventories/` and check its
  hash.
- **A saved copy** in that folder named `<target>-<sha256>.json`.

If neither matches the receipt, use the newest other inventory you can find, and
tell the owner that this baseline was never reviewed. Write the diff to a file
and present its summary sections:

```bash
python3 -I ../../.agents/skills/animama-desktop-release/scripts/inventory_diff.py <baseline> "$staged" > ../../.animama-drafts/desktop-release/inventory-diff-$target.md
```

After the owner approves the exact hash:

1. Set the target's `inventory_sha256`, `reviewed_by` (`gh api user -q .login`)
   and `reviewed_on` (`date -u +%F`; the validator compares UTC dates) in
   `desktop/runtime/release-policy.json`.
2. Copy `$staged` to the baseline folder as `<target>-<sha256>.json`.
3. Commit:

```bash
git commit -am "build(desktop): record the <target> redistribution review"
```

## Merge the reviewed inputs

After the owner approves and the PR merges, switch the worktree to the merged
commit and compare it with the staged one:

```bash
git -C ../.. fetch origin && git -C ../.. switch --detach origin/main
git -C ../.. diff --stat "$(cat ../../.animama-drafts/desktop-release/staged-commit)" HEAD -- . ':(exclude)src/frontend/desktop/runtime/release-policy.json' ':(exclude)docs'
```

An empty diff means the stage still matches. Any other change requires another
stage and audit.

## Signed build

```bash
pnpm desktop:dist:mac > ../../.animama-drafts/desktop-release/dist-mac.log 2>&1
```

`release.env` supplies `ANIMAMA_MACOS_NOTARY_PROFILE`. If a notarization wait
times out, keep the submission ID from the log and resume the same request:

```bash
pnpm desktop:dist:mac -- --resume-app-notarization <submission-id>
```

## Check the candidate

```bash
node -p "const r = require('./desktop/release/signing-report.json'); JSON.stringify({ready: r.release_ready, version: r.app_version, distribution: r.distribution?.kind, notarization: r.notarization, gatekeeper: r.gatekeeper})"
(cd desktop/release/publish && shasum -a 256 -c SHA256SUMS.txt)
ls -l desktop/release/publish/Animama-*
git -C ../.. status --short && git -C ../.. rev-parse HEAD
```

The output must show:

- `ready: true`, the expected version and the selected distribution.
- Every checksum `OK`.
- A clean tree at the merged `main` commit. Record that commit.

The build enforces the size limits. Report the sizes from
`desktop/release/publish/size-report.json`.

## Release scan

```bash
pnpm desktop:release:scan
```

`release.env` supplies `ANIMAMA_GITLEAKS`. Keep extra private strings for the
byte search in `ANIMAMA_SCAN_PRIVATE_TEXT`, supplied by the owner, never in a
file in the worktree. Each receipt is a `release-scan.json` in the candidate
and in each `models/<modelId>/` directory.

### Scan findings

`release-scan.json` lists each finding's rule, artifact, path and line, never
the value. To identify a value without printing it, copy the flagged file into
an empty scratch folder. Run the pinned Gitleaks there with the release config
and `--redact`. Then print only the report's `RuleID`, `StartColumn`, `EndColumn`
and redacted `Match`:

```bash
"$ANIMAMA_GITLEAKS" dir <scratch>/in --config desktop/runtime/release-scan.gitleaks.toml --redact --no-banner --report-format json --report-path <scratch>/report.json
```

For minified code, show the text before `StartColumn` and the shape of the match
(letters as `a`, digits as `9`), never its characters. To confirm an exact
candidate value, compare the unredacted `Secret` with it in a script that prints
only true or false, then delete that report. Propose a `regexTarget = "secret"`
entry that matches only that exact value, as an anchored regex. Before opening
the PR, check two things:

- with the new config, Gitleaks reports nothing for the flagged file;
- a realistic synthetic key in a scratch file is still reported.

The publisher accepts only a receipt made with the worktree's current config.
So after the allowlist merges, switch the release worktree to the new `main`.
Check that the diff from the build commit touches only the config. Then rescan.

## Preserve a candidate

Before any rebuild in the same worktree:

```bash
dest=<primary>/.animama-drafts/desktop-release/<version>/<target>-$(git -C ../.. rev-parse --short HEAD)
mkdir -p "$dest"
mv desktop/release/publish "$dest"/
if [ -d desktop/release/smoke-name ]; then mv desktop/release/smoke-name "$dest"/; fi
cp -R desktop/release/dependency-audit "$dest"/
ls "$dest"
```

## Fresh-account smoke

Run it in a disposable clone of the golden smoke VM
([release tooling](../../../../docs/frontend/desktop/releases.md#fresh-account-smoke-in-a-local-vm)).
First check that `tart get animama-smoke-golden` reports it stopped and that
`~/.config/animama/smoke-openai.env` exists, without reading it. If either is
missing, ask the owner to finish the golden VM setup, or use the
[test-account handoff](#test-account-handoff). From `<release>/src/frontend`,
in the background with a log, while nothing else runs in the worktree:

```bash
python3 ../../scripts/heavy-slot.py -- pnpm desktop:smoke:mac:vm -- --artifact desktop/release/publish/Animama-<version>-arm64.dmg
```

It writes `desktop/release/smoke-name`, checks the reports against the DMG and
`release-artifacts.json`, and deletes the clone. A failed run's reports land in
`desktop/release/smoke-name-failed-<time>`; report the failed step. Do not use
`--keep` unless debugging, and then delete the kept clone with `tart delete`.

### Test-account handoff

The owner runs this in a macOS test account that has never run Animama.
Prepare a shared handoff folder from `<release>`:

```bash
handoff=/Users/Shared/animama-smoke-<version>
mkdir -p "$handoff" && mkdir -m 0777 "$handoff/reports"
cp src/frontend/desktop/release/publish/Animama-<version>-arm64.dmg "$handoff"/
git bundle create "$handoff/source.bundle" HEAD
chmod a+rX "$handoff" "$handoff"/*.dmg "$handoff/source.bundle"
```

The smoke refuses an account that still has `~/Library/Application Support/Animama`
or `Anima`, `~/Applications/Animama.app` or `~/.config/Anima`. A test account
reused from an earlier smoke has them, so ask the owner to move them aside
(never delete them) before starting. The test account also needs its own Node 24
with pnpm (`corepack enable`). If it has none, copy this Mac's Node binary,
`corepack` and `npm` into `$handoff/node`, and have the owner put
`$handoff/node/bin` first on `PATH`.

Give the owner these steps for the test account:

1. Clone the bundle: `GIT_LFS_SKIP_SMUDGE=1 git clone /Users/Shared/animama-smoke-<version>/source.bundle animama-smoke`.
2. Install dependencies with `pnpm -C src/frontend install --frozen-lockfile`.
3. Set `ANIMAMA_SMOKE_OPENAI_KEY` for that shell only.
4. From `src/frontend`, run:

   ```bash
   pnpm desktop:smoke:mac -- --artifact /Users/Shared/animama-smoke-<version>/Animama-<version>-arm64.dmg --setup name
   ```

5. Copy the reports back and make them removable:

   ```bash
   cp -R desktop/release/smoke-name /Users/Shared/animama-smoke-<version>/reports/ && chmod -R a+rwX /Users/Shared/animama-smoke-<version>/reports
   ```

Then, back in the build account:

1. Copy `reports/smoke-name` into `<release>/src/frontend/desktop/release/`.
2. Check that its reports' `dmg_sha256` matches the DMG in `SHA256SUMS.txt`.
3. Check that `runtime_build_id` matches the signing report.
4. Delete `$handoff`: it holds the private source bundle in a shared location.
5. If a report asks for manual cleanup of the test credential, relay it to the
   owner.

## Publication

Only on an explicit owner request naming the version and stage, run:

```bash
(set -a; . ~/.config/animama/r2-publish.env; set +a; node desktop/scripts/runtime/publish-macos.mjs --confirm-preview-publication)
```

For stable:

1. Rerun the [dependency audit](#dependency-audit) and present the results.
2. With the owner's completed acceptance file, run:

```bash
(set -a; . ~/.config/animama/r2-publish.env; set +a; ANIMAMA_MACOS_ACCEPTANCE="$(cat <owner's acceptance json>)" node desktop/scripts/runtime/publish-macos.mjs --confirm-publication)
```

Check that every published object answers anonymously:

```bash
curl -fsSI "https://downloads.animama.ai/desktop/v<version>/Animama-<version>-arm64.dmg"
curl -fsS https://downloads.animama.ai/desktop/latest-mac.yml
```

The feed appears only after a stable publish. Run each publish in the
background with a log under `.animama-drafts/desktop-release/`. After any
publish, check every published object, not only the DMG. Fetch each name in
`previewAssets(release-artifacts.json)` from
`desktop/scripts/runtime/release-artifacts.mjs` (stable adds
`release-artifacts.json`, `SHA256SUMS.txt` and the acceptance reports). Fetch
each URL listed in `backend-model-assets.json`. Compare each SHA-256 with the
local candidate. An uncertain publish can be rerun: uploads are create-only, and
existing objects are verified, not sent again. A differing object stops the
publisher; never replace it.

## Install for native acceptance

The owner accepts the published build on their own Mac. Install it from the
local candidate DMG, which is byte-identical to the published one. A local copy
skips the quarantine check that a browser download gets, so say so:

```bash
test ! -e /Applications/Animama.app
mnt=$(mktemp -d) && hdiutil attach -nobrowse -readonly -mountpoint "$mnt" desktop/release/publish/Animama-<version>-arm64.dmg
ditto "$mnt/Animama.app" /Applications/Animama.app; hdiutil detach "$mnt"
spctl -a -vv -t exec /Applications/Animama.app
```

If `/Applications/Animama.app` exists, ask before replacing it. If
`~/Library/Application Support/Animama` exists, ask the owner whether to keep that
profile or start clean. To start clean, move the profile into
`~/.Trash/Animama profile <date>`; never delete it. Then `open -a /Applications/Animama.app`
and confirm that the app, its backend and PostgreSQL start.

## Signing rehearsal

```bash
pnpm desktop:dist:mac -- --signing-rehearsal > ../../.animama-drafts/desktop-release/rehearsal-mac.log 2>&1
```

On Windows, run `pnpm desktop:dist:windows -- --signing-rehearsal`.

## Windows

Run these on the Windows 11 x64 build host, preparing it as in
[runtime staging](../../../../docs/frontend/desktop/runtime-staging.md#native-windows-build)
and the [signed Windows build](../../../../docs/frontend/desktop/releases.md#build-a-signed-windows-candidate).
The macOS sections above apply, with these differences.

**Preflight:**

```powershell
git config --get core.autocrlf
az account show --query user.name -o tsv
Get-PSDrive C
```

`core.autocrlf` must print `false`.

**Environment:**

- Set `ANIMAMA_RELEASE_DISTRIBUTION` and `ANIMAMA_MODEL_ROOT` in each shell:
  `$env:NAME = "value"` in PowerShell, or `export` in Git Bash.
- Keep the model root outside `%LOCALAPPDATA%\Animama` and `C:\animama-build`,
  for example `$env:USERPROFILE\animama-models`.
- Ask the owner where this host keeps its owner-only pack read-token file, and
  load it for the fetch commands only.

**Commands:**

- **Model inputs:** run `py -3 scripts/models/release_inputs.py` with that root.
- **Packs, stage, audit and build:** use the sequence in
  [Windows candidates](../../../../docs/frontend/desktop/release-process.md#windows-candidates).
- **Unsigned installers:** build them with `pnpm desktop:win:installer` while
  iterating.

**Receipt:**

- Hash the staged inventory with `Get-FileHash -Algorithm SHA256`.
- The receipt target is `win32-x64`.

**Smoke:** the owner runs it in a separate standard account that has never run
Animama. That account needs read and write access to this checkout, and its
reports land in this checkout:

```powershell
pnpm desktop:smoke:windows -- --artifact desktop/release/publish/Animama-<version>-x64-setup.exe --setup name
```

**Scan:** use the pinned `windows_x64` Gitleaks build.

**Publication:** `publish-windows.mjs` takes the same options; stable needs
`ANIMAMA_WINDOWS_ACCEPTANCE`.

**Evidence names:** Windows files carry a `-win32-x64` suffix, for example
`SHA256SUMS-win32-x64.txt`.
