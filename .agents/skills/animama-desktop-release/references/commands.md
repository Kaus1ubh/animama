# Desktop release commands

`<primary>` is the primary checkout and `<release>` the release worktree. Run
commands from `<release>/src/frontend` unless a step says otherwise, and start
each shell with the nonsecret release environment:

```bash
cd <release>/src/frontend && . ../../.animama-drafts/desktop-release/release.env
```

These commands follow the [release process](../../../../docs/frontend/desktop/release-process.md);
when the two differ, the docs win. Report the difference.

## Published versions

```bash
curl -fsS https://downloads.animama.ai/desktop/latest-mac.yml | head -3
curl -fsS https://downloads.animama.ai/desktop/latest.yml | head -3
curl -s -o /dev/null -w '%{http_code}\n' -I "https://downloads.animama.ai/desktop/v<version>/Animama-<version>-arm64.dmg"
```

A `404` or a connection failure means nothing is published there. A preview
publishes no feed, so also probe the proposed version's installer. Any `200`
under `v<version>/` means that version is taken.

## Release workspace

```bash
git -C <primary> fetch origin
git -C <primary> worktree add -b chore/desktop-release-<version> <worktrees>/desktop-release-<version> origin/main
cd <worktrees>/desktop-release-<version>
git lfs pull
pnpm -C src/frontend install --frozen-lockfile
```

Edit `"version"` in `src/frontend/desktop/package.json`, then commit:

```bash
git commit -am "chore(desktop): set the desktop version to <version>"
```

Create `.animama-drafts/desktop-release/release.env` in the worktree. The
`.animama-drafts/` folder is ignored. Record only names and paths in it, never
secret values:

```bash
export ANIMAMA_RELEASE_DISTRIBUTION=r2
export ANIMAMA_MODEL_ROOT="$HOME/Library/Caches/Animama/models"
export ANIMAMA_MACOS_NOTARY_PROFILE=<profile name from the owner>
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
- The disk has room for a stage, a signed build and the model candidates. Stop
  below 30 GB free.

If the notary profile is missing, the owner restores it with
`xcrun notarytool store-credentials <profile>`. If the Gitleaks copy is missing,
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

From `<release>`:

```bash
uv export --frozen --no-default-groups --group desktop-build --all-extras --no-hashes --no-emit-project --format requirements-txt -o src/frontend/desktop/release/dependency-audit/runtime-requirements.txt
uvx pip-audit@2.10.1 --no-deps --disable-pip -r src/frontend/desktop/release/dependency-audit/runtime-requirements.txt -o src/frontend/desktop/release/dependency-audit/pip-audit.txt
pnpm -C src/frontend audit --prod > src/frontend/desktop/release/dependency-audit/pnpm-audit-prod.txt
pnpm -C src/frontend audit > src/frontend/desktop/release/dependency-audit/pnpm-audit.txt
```

Each tool exits non-zero when it reports an advisory. Read the reports:

- **Blocking:** `--prod` entries, and full-audit entries whose path starts with
  `desktop>electron`.
- **Review only:** other full-audit entries.

Check Electron:

```bash
node -p "require('./desktop/node_modules/electron/package.json').version"
npm view electron dist-tags.latest
npm view "electron@<installed major>" version | tail -1
```

The installed version must be the newest in its major. That major must be one
of the latest three stable majors.

## Packs, stage and audit

```bash
(set -a; . ~/.config/animama/mixamo-read.env; set +a; pnpm desktop:mixamo-motion fetch && pnpm desktop:private-pack --pack wow-comedy-sfx fetch)
ANIMAMA_REQUIRE_MIXAMO_MOTION=1 ANIMAMA_REQUIRE_WOW_COMEDY_SFX=1 python3 ../../scripts/heavy-slot.py -- pnpm desktop:runtime:stage -- --platform darwin --arch arm64 > ../../.animama-drafts/desktop-release/stage.log 2>&1
pnpm desktop:runtime:audit -- --platform darwin --arch arm64
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
python3 -I ../../.agents/skills/animama-desktop-release/scripts/inventory_diff.py <baseline> "$staged"
```

The baseline is
`<primary>/.animama-drafts/desktop-release/reviewed-inventories/<target>-<receipt sha256>.json`.
If no copy with the receipt's hash exists, as on the first run:

- Diff against the newest other staged inventory you can find, for example
  `<primary>/src/frontend/desktop/.desktop-runtime/<target>/runtime/licenses/inventory.json`.
- Tell the owner that this baseline was never reviewed.
- List the pending items in the
  [redistribution review](../../../../docs/frontend/desktop/redistribution-review.md).

After the owner approves the exact hash:

1. Set the target's `inventory_sha256`, `reviewed_by` (`gh api user -q .login`)
   and `reviewed_on` (`date +%F`) in `desktop/runtime/release-policy.json`.
2. Copy `$staged` to the baseline folder as `<target>-<sha256>.json`.
3. Commit:

```bash
git commit -am "chore(desktop): record the <target> redistribution review"
```

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
- A clean tree. Record the commit.

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

## Preserve a candidate

Before any rebuild in the same worktree:

```bash
dest=<primary>/.animama-drafts/desktop-release/<version>/<target>-$(git -C ../.. rev-parse --short HEAD)
mkdir -p "$dest" && mv desktop/release/publish desktop/release/smoke-name "$dest"/ 2>/dev/null; ls "$dest"
```

## Fresh-account smoke

The owner runs this in a macOS test account that has never run Animama.
Prepare a shared handoff folder from `<release>`:

```bash
handoff=/Users/Shared/animama-smoke-<version>
mkdir -p "$handoff" && cp src/frontend/desktop/release/publish/Animama-<version>-arm64.dmg "$handoff"/
git bundle create "$handoff/source.bundle" chore/desktop-release-<version>
chmod -R a+rX "$handoff"
```

Give the owner these steps for the test account:

1. Clone the bundle, check out the release branch and install dependencies with
   `pnpm -C src/frontend install --frozen-lockfile`.
2. Set `ANIMAMA_SMOKE_OPENAI_KEY` for that shell only.
3. From `src/frontend`, run:

   ```bash
   pnpm desktop:smoke:mac -- --artifact /Users/Shared/animama-smoke-<version>/Animama-<version>-arm64.dmg --setup name
   ```

4. Copy `desktop/release/smoke-name` back into the handoff folder.

Then, back in the build account:

1. Copy `smoke-name` into `<release>/src/frontend/desktop/release/`.
2. Check that its reports' `dmg_sha256` matches the DMG in `SHA256SUMS.txt`.
3. Check that `runtime_build_id` matches the signing report.
4. If a report asks for manual cleanup of the test credential, relay it to the
   owner.

## Publication

Only on an explicit owner request naming the version and stage, run:

```bash
(set -a; . ~/.config/animama/r2-publish.env; set +a; node desktop/scripts/runtime/publish-macos.mjs --confirm-preview-publication)
```

For stable, the owner supplies their completed acceptance file:

```bash
(set -a; . ~/.config/animama/r2-publish.env; set +a; ANIMAMA_MACOS_ACCEPTANCE="$(cat <owner's acceptance json>)" node desktop/scripts/runtime/publish-macos.mjs --confirm-publication)
```

Check that every published object answers anonymously:

```bash
curl -fsSI "https://downloads.animama.ai/desktop/v<version>/Animama-<version>-arm64.dmg"
curl -fsS https://downloads.animama.ai/desktop/latest-mac.yml
```

The feed appears only after a stable publish. Inspect the remote state before
retrying an uncertain publish. A differing object stops the publisher; never
replace it.

## Signing rehearsal

```bash
pnpm desktop:dist:mac -- --signing-rehearsal > ../../.animama-drafts/desktop-release/rehearsal-mac.log 2>&1
```

On Windows, run `pnpm desktop:dist:windows -- --signing-rehearsal`, after the
owner confirms the signature spend.

## Windows

Run these on the Windows 11 x64 build host. Prepare the host as described in
[runtime staging](../../../../docs/frontend/desktop/runtime-staging.md#native-windows-build)
and [the signed Windows build](../../../../docs/frontend/desktop/releases.md#build-a-signed-windows-candidate).

Preflight:

```powershell
git config --get core.autocrlf
az account show --query user.name -o tsv
Get-PSDrive C
```

`core.autocrlf` must print `false`. Ask the owner where this host keeps its
owner-only pack read-token file, and load it for the fetch commands only.

From `src/frontend`, with the same `ANIMAMA_RELEASE_DISTRIBUTION`:

```powershell
pnpm desktop:mixamo-motion fetch
pnpm desktop:private-pack --pack wow-comedy-sfx fetch
$env:ANIMAMA_REQUIRE_MIXAMO_MOTION = "1"; $env:ANIMAMA_REQUIRE_WOW_COMEDY_SFX = "1"
pnpm desktop:runtime:stage -- --platform win32 --arch x64
pnpm desktop:runtime:audit -- --platform win32 --arch x64
pnpm desktop:dist:windows
```

The rest of the Windows flow:

- **Unsigned installers:** build them with `pnpm desktop:win:installer` while
  iterating. Sign once, at the end.
- **Redistribution review:** the receipt target is `win32-x64`.
- **Smoke:** the owner runs it in a separate standard account that has never run
  Animama, from this same checkout:

  ```powershell
  pnpm desktop:smoke:windows -- --artifact desktop/release/publish/Animama-<version>-x64-setup.exe --setup name
  ```

- **Release scan:** use the pinned `windows_x64` Gitleaks build.
- **Publication:** `publish-windows.mjs` takes the same options, and stable needs
  `ANIMAMA_WINDOWS_ACCEPTANCE`.
- **Evidence names:** Windows files carry a `-win32-x64` suffix, for example
  `SHA256SUMS-win32-x64.txt`.
