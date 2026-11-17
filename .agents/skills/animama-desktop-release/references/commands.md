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
The macOS sections above apply, with these differences:

- **Use Git Bash for pnpm, stage, build and scan.**
  - Launched from PowerShell 7, the stage's child Windows PowerShell 5.1
    inherits a module path where `Get-Acl` cannot load, and the stage fails.
  - Do not export `MSYS_NO_PATHCONV=1` in a shell that runs pnpm: it breaks the
    Corepack pnpm shim. The PowerShell blocks below are for checks only.
- **No heavy slots.** `scripts/heavy-slot.py` does not run on native Windows.
  Check that no other build is running ([preflight](#windows-preflight)), then
  run each stage or build directly.
- **Network.** This host's network has dropped connections during the stage,
  the build and GitHub calls. Retry a failed fetch, push or `gh` call. Each
  section below lists the fixes that are safe.

### Windows environment

Create `.animama-drafts/desktop-release/release.env` in the release worktree
for Git Bash. Like the macOS file, it holds names and paths only:

```bash
export ANIMAMA_RELEASE_DISTRIBUTION=r2
export ANIMAMA_MODEL_ROOT='C:\Users\<user>\animama-models'
export ANIMAMA_GITLEAKS='C:\animama-build\tools\gitleaks-8.30.1\gitleaks.exe'
```

Keep the model root outside `%LOCALAPPDATA%\Animama` and `C:\animama-build`.

On the current host, the owner-only credential files are in
`%USERPROFILE%\.config\animama\animama-windows-credentials\`, which is `"$HOME/.config/animama/animama-windows-credentials"` in
Git Bash. A release uses:

- `mixamo-read.env` for the pack fetch;
- `smoke-openai.env` for the smoke;
- `r2-publish.env` for publication.

Never load `mixamo-publish.env` or `dev-secrets.env` for a release step.

### Windows preflight

In PowerShell:

```powershell
Get-CimInstance Win32_OperatingSystem | ForEach-Object { "$($_.Caption) $($_.OSArchitecture)" }
git -C <release> config --get core.autocrlf
az account show --query user.name -o tsv
$acct = az resource list --resource-type Microsoft.CodeSigning/codeSigningAccounts --query "[?name=='<account>'] | [0].id" -o tsv
(az rest --method get --url "https://management.azure.com$acct/certificateProfiles/<certificate_profile>?api-version=2024-09-30-preview" | ConvertFrom-Json).properties.certificates | Select-Object subjectName, status, expiryDate
(Get-FileHash -Algorithm SHA256 'C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\signtool.exe').Hash.ToLower()
dotnet --list-runtimes | Select-String 'Microsoft.NETCore.App 8\.'
node --version; pnpm --version; py -3.12 --version; uv --version
(Get-MpComputerStatus).SmartAppControlState
Get-PSDrive C
```

`<account>` and `<certificate_profile>` come from the `windows` entry in
`desktop/runtime/feature-pack-releases.json`.

Check each result:

- **Host:** Windows 11, 64-bit.
- **Checkout:** `core.autocrlf` prints `false`.
- **Signing:**
  - `az account show` prints a sign-in. It is an email address, so don't copy it
    into reports.
  - The active certificates' `subjectName` equals `certificate_subject`.
  - The `signtool.exe` hash equals the one in
    `desktop/runtime/windows-signing.lock.json`.
  - A .NET 8 runtime is installed.
- **Toolchain:** Node 24, the pnpm version in `src/frontend/package.json`
  `packageManager`, and Python 3.12.
- **Smoke:** Smart App Control is `Off`, or it would block the smoke's
  modified app copy.

**Credential files:** check that they're present and print their variable names
only, never their values:

```powershell
foreach ($f in 'mixamo-read.env', 'r2-publish.env', 'smoke-openai.env') {
  $path = Join-Path "$env:USERPROFILE\.config\animama\animama-windows-credentials" $f
  if (Test-Path $path) { "${f}: " + ((Get-Content $path | ForEach-Object { if ($_ -match '^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=') { $Matches[1] } }) -join ', ') } else { "$f MISSING" }
}
```

**Gitleaks:** `scanner-pins.json` pins the archive's digest, not the executable's.
To check the installed copy:

1. Download the pinned `windows_x64` archive into a new empty folder.
2. Check the archive's SHA-256 against the pin.
3. Compare the `gitleaks.exe` inside it with the installed one.

```powershell
$dl = '<new empty folder>'
Invoke-WebRequest -UseBasicParsing 'https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_windows_x64.zip' -OutFile "$dl\gitleaks.zip"
(Get-FileHash -Algorithm SHA256 "$dl\gitleaks.zip").Hash.ToLower()
Add-Type -AssemblyName System.IO.Compression.FileSystem
$z = [IO.Compression.ZipFile]::OpenRead("$dl\gitleaks.zip"); $s = ($z.Entries | Where-Object Name -eq 'gitleaks.exe').Open()
$zipped = -join ([Security.Cryptography.SHA256]::Create().ComputeHash($s) | ForEach-Object { $_.ToString('x2') }); $s.Close(); $z.Dispose()
$zipped -eq (Get-FileHash -Algorithm SHA256 'C:\animama-build\tools\gitleaks-8.30.1\gitleaks.exe').Hash.ToLower()
```

If the installed copy is missing, ask before downloading it.

**Running builds:** this lists build processes; the list must be empty:

```powershell
Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(python\d*|uv|signtool|cl|link|meson|ninja|7za|makensis|postgres|app-builder)\.exe$' } | Select-Object Name, ProcessId, CommandLine
```

Also check the `node.exe` command lines for a stage, build or scan.

### Windows model inputs

When every set is already in the store, verify each set instead of running
`release_inputs.py`. That helper re-encodes the 24 VCTK voices. On Windows the
encoder's output differs from the recorded hashes, and it rewrites
`scripts/voices/encoded-state-hashes.json` with CRLF line endings, which the
stage then refuses. Never rehash. From `<release>` in Git Bash, after
`. .animama-drafts/desktop-release/release.env`:

```bash
for s in parakeet parakeet_webgpu browser_speech pocket_cloning pocket_voices sensevoice sensevoice_webgpu; do py -3.12 -I scripts/models/$s.py verify || echo "FAILED: $s"; done
git checkout -- scripts/voices/encoded-state-hashes.json   # only if a bootstrap touched it
```

Acquire a missing set with that set's `acquire` operation, for example
`py -3.12 -I scripts/models/sensevoice.py acquire`.

### Windows dependency audit

Run the four audit commands in
[Commands and inputs](../../../../docs/frontend/desktop/release-process.md#commands-and-inputs)
from `<release>` in Git Bash. To list the full audit's `desktop>electron`
entries:

```bash
pnpm -C src/frontend audit --json > .animama-drafts/desktop-release/pnpm-audit.json
node -e "const j=require('./.animama-drafts/desktop-release/pnpm-audit.json'); for (const a of Object.values(j.advisories)) for (const p of new Set(a.findings.flatMap(f=>f.paths))) if (p.startsWith('desktop>electron')) console.log(a.module_name, a.github_advisory_id, p)"
```

`pip-audit` evaluates platform markers on the machine it runs on, so it covers
the Windows-only packages there. `torch` and `torchvision` left the lockfile with
#879. If `grep -c '^name = "torch"' uv.lock` finds them again, audit their
`+cpu` builds separately: `pip-audit` skips them.

### Windows packs, stage and audit

From `<release>/src/frontend` in Git Bash:

```bash
. ../../.animama-drafts/desktop-release/release.env
creds="$HOME/.config/animama/animama-windows-credentials"
(set -a; . "$creds/mixamo-read.env"; set +a; pnpm desktop:mixamo-motion fetch && pnpm desktop:private-pack --pack wow-comedy-sfx fetch)
(cd desktop/node_modules/electron && node install.js)
git -C ../.. rev-parse HEAD > ../../.animama-drafts/desktop-release/staged-commit
ANIMAMA_REQUIRE_MIXAMO_MOTION=1 ANIMAMA_REQUIRE_WOW_COMEDY_SFX=1 pnpm desktop:runtime:stage -- --platform win32 --arch x64 > ../../.animama-drafts/desktop-release/stage.log 2>&1
pnpm desktop:runtime:audit -- --platform win32 --arch x64 > ../../.animama-drafts/desktop-release/audit.log 2>&1
```

`pnpm install` skips Electron's binary, and the stage's `desktop-build` step
fetches it late, after the backend build. `node install.js` fetches it first
and checks it against Electron's `checksums.json`.

The audit must report the fresh cluster's `vector` extension. The stage's
`backend-resource-audit` step also fails without pgvector.

Fix these stage failures, then stage again:

- **`Get-Acl` … could not be loaded:** the stage was started from PowerShell 7.
  Use Git Bash.
- **CRLF copies of LF files:** restore the named file. See
  [Windows model inputs](#windows-model-inputs).
- **`curl: (35)` or `CRYPT_E_REVOCATION_OFFLINE` while downloading a native
  source:** copy that file from an earlier worktree's
  `desktop/.desktop-runtime/downloads/`. `downloadVerified` checks every cached
  file against `native-components.win32-x64.lock.json`.
- **Electron failed to install correctly:** run `node install.js` as above.

### Windows redistribution review

Hash the staged inventory with `sha256sum` in Git Bash or
`Get-FileHash -Algorithm SHA256`. The receipt target is `win32-x64`.

- **Baseline:** `scripts/inventory_diff.py` writes UTF-8 itself, so
  `py -3.12 -I` works with redirected output. Diff against the last reviewed
  `win32-x64` inventory. If that review is old, also diff against the other
  target's newest reviewed inventory, which the owner can supply; that separates
  platform differences from source changes.
- **Expected platform differences from `darwin-arm64`:**
  - Windows adds `msvc-runtime`, `pywin32`, `pywin32-ctypes`, `pefile` and
    `tzdata`, and has no `macholib` or `uvloop`.
  - Many Python components' notice text differs, because Windows wheels carry
    their own licence files.
  - Web chunk names differ.
  - The generated `content/included-core/inventory.json` differs, but every
    content and model file matches.
- **Upload parser notices.** lxml statically links GNU libiconv when this prints
  a count above 0:

  ```bash
  strings -n 3 desktop/.desktop-runtime/win32-x64/runtime/backend/_internal/lxml/etree.cp312-win_amd64.pyd | grep -c -x -E 'MULELAO-1|ARMSCII-8|GEORGIAN-ACADEMY|UCS-4-INTERNAL'
  ```

  To list the licence files a component contributes to the notices (for
  pypdfium2, 18 of them):

  ```bash
  notices=desktop/.desktop-runtime/win32-x64/runtime/licenses/THIRD_PARTY_NOTICES.txt
  n=$(grep -n -F '(pypi:pypdfium2@<version>)' "$notices" | head -1 | cut -d: -f1)
  awk -v s="$n" 'NR>s && /^=+$/ {exit} NR>=s && /^--- / {print}' "$notices"
  ```

  A `--- end of FTL.TXT ---` line is part of FreeType's text, not a file.
- **Receipt check:** after writing the receipt, from `desktop`:

  ```bash
  node --input-type=module -e "import { loadReleasePolicy, verifyRedistributionReview } from './scripts/runtime/release-policy.mjs'; const r = loadReleasePolicy({ target: 'win32-x64', distribution: 'r2' }); verifyRedistributionReview('.desktop-runtime/win32-x64/runtime', r); console.log('receipt OK', r.review.inventory_sha256)"
  ```

- **Tests:** `pnpm desktop:test -- runtime-packaging windows-release` has one
  known Windows failure, "stops staging when the frontend install does not
  match its lockfile". It also fails on `main`, so report it rather than
  treating it as caused by the receipt.
- **Windows-only release:** when the version is already on `main`, the PR is
  `build: record the Windows <version> redistribution review` and holds only
  the receipt and the narrowed docs note.

### Windows signed build and evidence

After the owner confirms the spend, from `<release>/src/frontend` in Git Bash:

```bash
. ../../.animama-drafts/desktop-release/release.env
git -C ../.. rev-parse HEAD > ../../.animama-drafts/desktop-release/build-commit
pnpm desktop:dist:windows > ../../.animama-drafts/desktop-release/dist-windows.log 2>&1
```

In the log, a `SignTool Error` about the timestamp server, followed by
`retrying 1 unsigned file(s)`, is a retried timestamp failure. Each retry
spends another signature. Then check the evidence:

```bash
cd desktop/release/publish
node -e "const r=require('./signing-report-win32-x64.json'); const s={}; for (const f of r.files) s[f.signer+'/'+f.status]=(s[f.signer+'/'+f.status]||0)+1; console.log(JSON.stringify({ready:r.release_ready, version:r.app_version, distribution:r.distribution.kind, signed_files:r.signed_files, files:s, pinned:r.files.filter(f=>f.signer==='animama').every(f=>f.subject===r.certificate_subject&&f.timestamped), installer:r.installer.sha256, build:r.runtime_build_id}))"
sha256sum -c SHA256SUMS-win32-x64.txt
node -p "const s=require('./size-report-win32-x64.json'); JSON.stringify({download:s.download_bytes, installed:s.installed_bytes, failures:s.validation.failures})"
git -C ../../../../.. status --short && git -C ../../../../.. rev-parse HEAD
```

The output must show:

- `ready: true`;
- every file `Valid`, with `pinned: true`. The `vendor` files are
  Microsoft-signed runtime DLLs whose signatures were kept;
- every checksum `OK`;
- an installer of at most 750 MiB and an installed size of at most 1.5 GiB;
- a clean tree at the merged commit.

Record the installer's SHA-256, its size and the runtime build ID.

When the other target already published this version, compare the shared file
before publishing. A `404` means nothing is published there yet:

```bash
curl -fsS -o <scratch>/backend-model-assets.json "https://downloads.animama.ai/desktop/v<version>/backend-model-assets.json?noCache=$RANDOM$RANDOM"
cmp backend-model-assets.json <scratch>/backend-model-assets.json && echo identical
```

### Windows release scan

From `<release>/src/frontend` in Git Bash, with `release.env` loaded:

```bash
pnpm desktop:release:scan > ../../.animama-drafts/desktop-release/scan.log 2>&1
node -p "const r=require('./desktop/release/publish/release-scan.json'); JSON.stringify({result:r.result, canary:r.scanner.canary, coverage:r.coverage, findings:r.findings.length})"
```

Each `models/<modelId>/` directory gets its own receipt.

### Windows fresh-account smoke

The owner runs it in a separate standard account that has never run Animama.
`scripts/smoke-windows-account.ps1` checks:

- that the account is not an administrator;
- the four profile folders;
- Node 24 and the pinned pnpm;
- the installer and write access to the checkout.

It then loads only `ANIMAMA_SMOKE_OPENAI_KEY` from a key file, without
printing it, runs `pnpm desktop:smoke:windows` against the candidate, and
clears the key.

1. **Place the script.** Copy it to
   `<release>/.animama-drafts/desktop-release/smoke-windows-account.ps1`. It
   finds the checkout by walking up from its own folder. Run it once in the
   build account: it must refuse with "this account is an administrator".
2. **Give the test account the key.** Grant it read access to the one key file
   rather than copying the file, and remove the grant after the smoke. The test
   account reaches the file by its full path, using Windows' default
   traverse right; the rest of the build account's profile stays closed:

   ```powershell
   $key = "$env:USERPROFILE\.config\animama\animama-windows-credentials\smoke-openai.env"
   icacls $key /grant '<test account>:(R)'
   ```

   After the smoke:

   ```powershell
   icacls $key /remove:g '<test account>'
   ```

3. **Owner runs it.** The owner switches user (Win+L, **Switch user**, never
   **Sign out**), signs in to the test account and opens Windows PowerShell
   without "Run as administrator":

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File "<release>\.animama-drafts\desktop-release\smoke-windows-account.ps1" -KeyFile "<build account profile>\.config\animama\animama-windows-credentials\smoke-openai.env"
   ```

   The Animama windows open and close on their own for several minutes, and
   must not be touched.
4. **Reused test account.** If the script lists earlier Animama folders, the
   owner first uninstalls the old app in that account (Settings → Apps). Then
   the owner renames the listed folders aside, never deleting them, and runs
   the script again.
5. **Verify the reports** from `<release>/src/frontend/desktop/release`:

   ```bash
   node -e "const s=require('./smoke-name/smoke-report.json'), n=require('./smoke-name/network-report.json'), r=require('./publish/signing-report-win32-x64.json'); console.log(JSON.stringify({passed:s.passed, checks:Object.keys(s.checks).length, failed:Object.entries(s.checks).filter(([,v])=>v!==true).map(([k])=>k), installer:s.installer_sha256===r.installer.sha256, build:s.runtime_build_id===r.runtime_build_id, network_violations:n.violations}))"
   ```

   The output must show `passed: true`, no failed checks, both bindings `true`
   and no network violations. Then remove the key grant.

### Windows native checks

Install the candidate in the account the owner chooses. If any of these paths
exists, ask the owner; never reset a profile:

```powershell
foreach ($p in "$env:LOCALAPPDATA\Animama", "$env:LOCALAPPDATA\Programs\Animama", "$env:APPDATA\Animama", "$env:APPDATA\Anima") { "${p}: " + (Test-Path -LiteralPath $p) }
$installer = '<release>\src\frontend\desktop\release\publish\Animama-<version>-x64-setup.exe'
(Get-FileHash -Algorithm SHA256 $installer).Hash.ToLower()
$p = Start-Process -FilePath $installer -PassThru; $p.WaitForExit(300000); $p.ExitCode
```

The normal installer installs for the account and opens Animama. Check:

- `Animama.exe`, `animama-runtime.exe` and `postgres.exe` run from
  `%LOCALAPPDATA%\Programs\Animama`;
- PostgreSQL and the backend listen only on `127.0.0.1`;
- a plain `GET` to the backend gets `403`.

A locally copied installer skips SmartScreen; that check needs a browser
download.

**Checklist for the owner:**

- Install, first-run setup, and both starter chats.
- Avatar animation and the Pocket TTS voice.
- Microphone, and offline dictation after installing Parakeet in the app.
- Picture-in-picture, quick chat and global shortcuts.
- A `.txt`, a `.docx` and a text PDF answered from.
- Restart, and the data is kept.
- Uninstall and reinstall.
- SmartScreen on a downloaded installer.

**Uninstall:** the uninstaller asks whether to delete `%LOCALAPPDATA%\Animama`,
with **No** preselected. Answering **Yes** deletes the profile, so tell the
owner which answer the check needs. Uninstalling always leaves
`%LOCALAPPDATA%\animama-updater\installer.exe`, a copy of the installer kept
for differential updates.

### Windows publication and the first stable

`publish-windows.mjs` takes the same options as `publish-macos.mjs`; stable
needs `ANIMAMA_WINDOWS_ACCEPTANCE`. Load `r2-publish.env` from the credential
folder for that one command, and verify every object as in
[publication](#publication). Windows publication has not been exercised yet:
0.1.5 was kept local.

- **First stable.** Stable acceptance needs `prior_signed_version`: an older
  signed Windows build whose used profile the owner upgraded. The older build
  must use a database schema the new release can migrate:
  - Compare `alembic_head` and `database_schema_sha256` in the runtime
    manifests.
  - Profiles from before the baseline froze at 0.1.2 stop with
    `database_schema_mismatch`
    ([ADR 0035](../../../../docs/adr/0035-released-schema-changes-use-forward-migrations.md)).
    So the unpublished signed 0.1.1 Windows candidates cannot serve; signed
    0.1.5 is the first valid base.
  - The digest differs between platforms at the same head, so compare Windows
    only with Windows.
- **SmartScreen.** The acceptance check needs a browser download, so publish
  the preview first, then promote the same build.
- **Shared folder.** When the other target already published the same version,
  the Windows files carry their `-win32-x64` suffix. Only
  `backend-model-assets.json` is shared, and it must match byte for byte.

### Preserve a Windows candidate

Keep a candidate that a later version will upgrade from. While the publisher
may still run from the release worktree, copy rather than move. From
`<release>/src/frontend/desktop/release`:

```bash
dest=<primary>/.animama-drafts/desktop-release/<version>/win32-x64-$(git -C ../../../.. rev-parse --short=9 HEAD)
mkdir -p "$dest/logs" && cp -a publish smoke-name dependency-audit review signing-report.json "$dest/"
cp -a ../../../../.animama-drafts/desktop-release/*.log "$dest/logs/"
(cd "$dest/publish" && sha256sum -c --quiet SHA256SUMS-win32-x64.txt && echo "copy OK")
```

### Evidence names

Windows files carry a `-win32-x64` suffix, for example
`SHA256SUMS-win32-x64.txt`.
