# Cloudflare R2 desktop release distribution

Source agreement: [raymond-van/animama#108](https://github.com/raymond-van/animama/issues/108)
as published on 2026-09-25, plus the owner decisions dated 2026-09-25 in the
[Decision Log](#decision-log).
Authorized scope: plan approved by the owner on 2026-09-25; Phase 1 authorized.
Later phases need separate authorization. Nothing in this plan authorizes
publishing a release.

## Purpose and context

Signed macOS builds currently pin one distribution transport: GitHub Releases on
`raymond-van/animama-releases`. The installed app downloads anonymously, so that
repository would have to be public before updates or feature packs (currently
only Parakeet offline speech recognition) could download. This plan adds
Cloudflare R2 behind the custom domain `https://downloads.animama.ai` as the
default transport, keeps GitHub as a supported alternate, and puts a mandatory
security audit ahead of any public upload.

After this work:

- `ANIMAMA_RELEASE_DISTRIBUTION=r2|github` (default `r2`) selects, at build time,
  one of two destinations committed in `release-policy.json`. The choice is
  sealed into the signed app's update policy and feature-pack catalog.
- An R2-built app checks `https://downloads.animama.ai/desktop/latest-mac.yml`
  with `electron-updater`'s `generic` provider and downloads versioned
  installers and packs from `https://downloads.animama.ai/desktop/v<version>/`.
  Its update session and pack downloader accept no other host.
- `publish-macos.mjs` publishes to the selected transport, keeping the existing
  preview/stable gates. The R2 path uses create-only uploads with SHA-256
  verification and a bucket-scoped credential that never enters the app.
- A repeatable secrets/credential/privacy scan covers source, history and the
  exact release candidate before anything is uploaded.

### Orientation

Commands run from `src/frontend` unless stated. Relevant code:

| Area              | Files                                                                                                                                                                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Release inputs    | `desktop/runtime/release-policy.json`, `desktop/runtime/feature-pack-releases.json`, `desktop/runtime/feature-pack.schema.json`                                                                                                                                                 |
| Build-time policy | `desktop/scripts/runtime/release-policy.mjs` (`validateReleasePolicy`, `stagedUpdatePolicy`, `isPublicReleaseRepository`)                                                                                                                                                       |
| Candidate build   | `desktop/scripts/runtime/release-macos.mjs` (electron-builder `publish` config, pack URL prefix check), `desktop/scripts/runtime/release-artifacts.mjs` (`updateFeed`, artifact index, `previewAssets`)                                                                         |
| Pack producer     | `desktop/scripts/runtime/feature-pack-build.ts`, `desktop/scripts/runtime/worker-input.ts` (both read `release_base_url`)                                                                                                                                                       |
| Installed app     | `desktop/src/main-process/updates/policy.ts` (`validateUpdatePolicy`, `validateUpdateCandidate`, `allowedUpdateUrl`), `desktop/src/main-process/updates/electron-adapter.ts` (`MacUpdater` provider), `desktop/src/main-process/feature-packs/catalog.ts` (pack URL validation) |
| Publisher         | `desktop/scripts/runtime/publish-macos.mjs`                                                                                                                                                                                                                                     |
| CI                | `.github/workflows/release-desktop-macos.yml` (manual; publication unconfigured)                                                                                                                                                                                                |
| Tests             | `desktop/tests/desktop-updates.test.ts`, `desktop-updater-adapter.test.ts`, `feature-packs.test.ts`, `runtime-packaging.test.mjs`, `optional-inputs.test.mjs`                                                                                                                   |
| Docs              | `docs/frontend/desktop/releases.md`, `release-process.md`, `feature-packs.md`                                                                                                                                                                                                   |
| Scanners          | `scripts/repository-boundary/scanner-pins.json` (pinned Gitleaks 8.30.1 with canary procedure)                                                                                                                                                                                  |

### Boundaries

- No runtime feed/catalog override and no environment variable read by the
  installed app. Existing docs forbid this, and a runtime override would let the
  environment redirect updates.
- Downloads stay anonymous. Objects are public by exact URL; no signed URLs,
  license keys or tokens in the app.
- Signing, notarization, smoke, acceptance and size gates, and every
  installed-app verification (version, filename, size, SHA-512, Team ID, pack
  catalog hashes), are unchanged.
- The GitHub transport keeps its current behavior, including the requirement
  that its repository be public at publication.
- The source repository's visibility does not change. Publishing a release is a
  separate, owner-approved action outside this plan.

## Progress

- [ ] Phase 1: Security audit and repeatable candidate scan. Implemented; reviews #1–#3 complete (pass after 2 repair rounds). Awaiting owner acceptance of finding dispositions (scanner download approved 2026-09-25).
- [ ] Phase 2: Distribution policy and build-time selection. Not started.
- [ ] Phase 3: Installed-app transport for R2. Not started.
- [ ] Phase 4: R2 publisher and release workflow. Not started.
- [ ] Phase 5: Cloudflare configuration, live bucket exercise and docs. Not started. Owner gate: dashboard settings; approval before any test upload.
- [ ] Final integration review. Not started.

## Surprises & Discoveries

- 2026-09-25: No signed Animama release exists and no installed app embeds an
  update policy. The update policy schema can change without migrating any
  installed users.
- 2026-09-25: `downloads.animama.ai` resolves through Cloudflare with a valid
  TLS certificate and returns HTTP 404 at the root (empty bucket). The custom
  domain is live.
- 2026-09-25: `validateUpdateCandidate` requires feed file URLs to be exactly
  `Animama-<version>-arm64.{zip,dmg}`, and `electron-updater`'s generic provider
  resolves them relative to the feed URL. Unversioned assets such as
  `THIRD_PARTY_NOTICES.txt` and `sbom.cdx.json` would collide in one flat folder
  across versions, so R2 needs per-version folders and a feed that points into
  them (Phase 3).
- 2026-09-25: The installed app bundle carries the frontend build and staged
  backend runtime. Publishing an installer therefore publishes that code, even
  while the source repository stays private. Phase 1 scans the built app, not
  only the Git tree.
- 2026-09-25: The Developer ID name and Team ID in `feature-pack-releases.json`
  are public in every signed binary's code signature. They are not a leak.
- 2026-09-25 (Phase 1): The bundled PostgreSQL binaries embedded the build
  machine's home and checkout path through the configure `--prefix`, and
  pgvector embedded installed-header paths through `__FILE__`. This also made
  runtime inventory bytes depend on the checkout location. PostgreSQL records
  both its configure and make-time `CFLAGS`, so a `-ffile-prefix-map` flag must
  not be passed to the PostgreSQL build itself.
- 2026-09-25 (Phase 1): The Parakeet encoder's quantized ONNX weights are about
  42 MB of printable bytes, so Gitleaks finds token-shaped runs by chance.
- 2026-09-25 (Phase 1): Stable promotion rewrites `release-artifacts.json`, so
  the scan receipt lists every scanned file's SHA-256 in addition to the index
  digest. Phase 4 should check per-file coverage rather than only the index hash.
- 2026-09-25 (Phase 1): uv installs managed interpreters under the home
  directory by default, and PyInstaller freezes that interpreter's sysconfig
  paths into the backend. Found only after the scanner expanded the PYZ.
- 2026-09-25 (Phase 1): The shared `/private/tmp/animama-uv-cache` was partially
  purged by the OS, breaking `uv` builds. Setting `UV_CACHE_DIR` to a fresh
  directory worked around it without touching the shared cache.

## Decision Log

- 2026-09-25, owner: Cloudflare R2 is the default distribution; GitHub
  `animama-releases` remains a supported alternate.
- 2026-09-25, owner: The transport is selected at build time with
  `ANIMAMA_RELEASE_DISTRIBUTION`, defaulting to `r2`.
- 2026-09-25, owner: R2 bucket `animama-releases` created; custom domain
  `downloads.animama.ai` connected; `r2.dev` public URL left disabled; a
  bucket-scoped Object Read & Write API token created and held outside the
  repository.
- 2026-09-25, owner: A secrets/credential/security check of the codebase is
  mandatory before any public upload.
- 2026-09-25, owner: approved downloading the pinned Gitleaks 8.30.1
  darwin_arm64 archive for Phase 1, subject to digest verification.
- 2026-09-25, owner (approved agent proposal): object layout
  `desktop/v<version>/<asset>` for immutable assets and `desktop/latest-mac.yml`
  as the only mutable object.
- 2026-09-25, owner (approved agent proposal): the publisher, for both
  transports, refuses to upload unless a passing candidate scan receipt matches
  the exact `release-artifacts.json` being published.
- 2026-09-25, owner (approved agent proposal): sign S3 requests with the
  `aws4fetch` package (small, dependency-free) rather than the AWS SDK or a
  hand-written SigV4 implementation. Phase 4 records its license and pinned
  version.

## Phased implementation

### Phase 1: Security audit and repeatable candidate scan

Requirements: issue acceptance "Security audit"; R8.
Starting source: `d987d24` on `build/r2-release-distribution`.
Dependencies: owner approval to download the pinned Gitleaks 8.30.1 darwin_arm64
archive recorded in `scanner-pins.json` (digest-verified before use).

Goal: find anything in the codebase, its history, or the built artifacts that the
owner would not want public, and make the candidate scan repeatable for every
release.

Steps:

1. Download Gitleaks 8.30.1 to a private tool directory outside the checkout.
   Verify the archive SHA-256 against `scanner-pins.json` and the reported
   version. Run the synthetic canary; an empty report is only accepted once the
   canary is detected.
2. Source and history: run
   `gitleaks git --no-banner --redact --log-opts=--all` on the repository and
   `gitleaks dir --no-banner --redact` on the working tree, including
   LFS-hydrated files. Write JSON reports to private evidence storage, never
   under the checkout.
3. Targeted checks that Gitleaks does not cover:
    - Absolute local paths (`/Users/`, `/home/`, `C:\\Users`), personal email
      addresses, private hostnames and internal URLs in tracked files, release
      inputs and docs.
    - Committed `.env*`, `*.p12`, `*.pem`, `*.key`, keychain and notary files,
      and `.gitignore` coverage for `desktop/release/`, stack records and
      evidence directories.
    - Workflows: secrets only reach the jobs that need them; no `echo`/`set -x`
      of secret values; artifacts uploaded from CI exclude credential material.
    - Scripts that log errors or reports: confirm redaction of URLs,
      credentials and host paths (`publish-macos.mjs`, `ci-keychain.mjs`,
      `smoke-policy.mjs`, pack and signing reports).
4. Built-artifact scan: stage an unsigned runtime
   (`pnpm desktop:runtime:stage -- --platform darwin --arch arm64`) and scan the
   staged runtime, the packaged app resources (`app.asar` extracted), the pack
   archives expanded, and report JSON files. Check for source maps, `.env`
   copies, developer database dumps, test fixtures containing real data,
   absolute build paths and embedded tokens.
5. Add `desktop/scripts/runtime/scan-release-candidate.mjs` (exposed as
   `pnpm desktop:release:scan`). It takes a candidate `desktop/release/publish`
   directory, mounts the DMG read-only, expands the app archive and packs into a
   temporary directory, runs the pinned Gitleaks plus the path/email checks from
   step 3, and writes `release-scan.json` bound to the SHA-256 of
   `release-artifacts.json`. Findings are redacted, and the receipt records only
   counts, rule IDs and relative file names. The scanner binary path comes from
   an explicit argument or environment variable; the script never downloads it.
6. Report findings privately to the owner. Remediate by removing or rotating
   anything real. History rewrites need separate owner approval. Record false
   positives in a reviewed, hashed Gitleaks config.

Checks: canary detection; unit tests for the receipt binding and redaction
(`pnpm desktop:test`); `pnpm desktop:check`.

Completion: every finding is resolved or explicitly accepted by the owner, the
scan command is committed and tested, and this plan records a public-safe
summary (counts and categories only).

Owner gate: disposition of findings. Phase 5's live upload cannot start until
this gate passes.

Results (2026-09-25, issue [#109](https://github.com/raymond-van/animama/issues/109)):

Scanner: Gitleaks 8.30.1 darwin_arm64 archive matched the pinned SHA-256
`b40ab0ae…aeb6a5`; the binary reported `8.30.1`; a generated `github-pat` canary
was detected before any empty report was accepted. Reports stayed in private
storage outside the checkout.

| Scope                                                                                                                                      | Result                                                                                                    | Disposition                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Git history, all refs (starts at the repository-split commit)                                                                              | 10 `generic-api-key` hits                                                                                 | False positives: a fake test key, content `semantic_key` values, SHA-256 provenance hashes, RFC 6455 sample WebSocket nonces                                      |
| Tracked working tree                                                                                                                       | 4 hits, subset of the above                                                                               | Same false positives                                                                                                                                              |
| Personal paths/emails in tracked files                                                                                                     | Two committed plans contained the maintainer's local home paths                                           | Fixed: replaced with placeholders                                                                                                                                 |
| Other emails                                                                                                                               | Third-party notice authors, `example.invalid` fixtures, pgAdmin dev default, test URLs with fake userinfo | Not private                                                                                                                                                       |
| Key/cert/env files                                                                                                                         | None tracked; `.env.local`/`.env.production` variants were not ignored                                    | Fixed: ignore `**/.env.*` (except `.env.example`), `*.p12`, `*.p8`                                                                                                |
| Workflows                                                                                                                                  | Secrets injected per step into only the jobs needing them; no echo/trace of secrets                       | No change                                                                                                                                                         |
| Log/report redaction (`publish-macos`, `ci-keychain`, `smoke-policy`)                                                                      | Bounded messages; categorical reports                                                                     | No change                                                                                                                                                         |
| Bundled PostgreSQL                                                                                                                         | Build-machine home/checkout path in 9 binaries (configure prefix, header `__FILE__`)                      | Fixed in `native.mjs`                                                                                                                                             |
| Frozen backend (PyInstaller PYZ)                                                                                                           | Home path in `_sysconfigdata__darwin_darwin` from uv's interpreter under the home directory               | Fixed: `UV_PYTHON_INSTALL_DIR` pinned to `/Users/Shared/animama-build/uv-python`                                                                                  |
| Full candidate, final (DMG, ZIP, Parakeet pack, catalog, reports, notices; 31,035 files incl. 12 nested archives and PyInstaller contents) | Before allowlisting: 42 Gitleaks hits in third-party libraries; 0 private-text or symlink findings        | All verified as documentation placeholders, published examples, code fragments or PEM markers with no key material; allowlisted by exact value. Final scan passes |
| ONNX weights (17 files)                                                                                                                    | Chance token matches in quantized tensors                                                                 | Excluded from Gitleaks only, counted in the receipt; still byte-searched for private text                                                                         |

Changes:

- `scripts/runtime/release-scan.mjs`, `scan-release-candidate.mjs` and
  `pnpm desktop:release:scan`: verifies the artifact index and pinned scanner
  version and requires the canary. It mounts the DMG and expands ZIP, tar.gz,
  `.tar.zst`, ASAR and PyInstaller archives (nested up to four levels). Gitleaks
  scans a numbered view of every file (binaries as printable strings) so its
  built-in path exclusions cannot skip content. Every file and symlink target is
  byte-searched for the home directory, Git author email and
  `ANIMAMA_SCAN_PRIVATE_TEXT` values. `release-scan.json` records file hashes,
  coverage counts, rule IDs and locations only. Errors print fixed messages.
- `src/backend/packaging/desktop/extract_pyinstaller.py`: expands the frozen
  backend's CArchive and PYZ with the staged build interpreter.
- `runtime/release-scan.gitleaks.toml`: reviewed exact-value exceptions.
- `scripts/runtime/native.mjs`: PostgreSQL is configured with the neutral prefix
  `/opt/animama` and installed through `DESTDIR`; pgvector alone receives
  `-ffile-prefix-map`.
- `scripts/runtime/common.mjs`: neutral `UV_PYTHON_INSTALL_DIR`.
- `@electron/asar` 3.4.1 (already in the lockfile) became a pinned desktop dev
  dependency.
- Docs: scan step, coverage, exclusions and allowlist policy in
  `release-process.md`; interpreter and PostgreSQL build locations in
  `runtime-staging.md`.

Validation (local, macOS arm64, after Review #1 revisions): stage, audit (which
runs the bundled PostgreSQL), unsigned package and Parakeet pack build passed on
the neutral interpreter; the full candidate scan passed. `pnpm desktop:test`
14 files / 279 tests passed; `pnpm check` passed; knip reports nothing for the
changed files; Prettier passes for all changed files; `ruff check` and
`ruff format --check` pass for the new Python helper; `git diff --check` clean.
`pnpm prettier:check` fails only on pre-existing files outside this change. Unit
tests use a stand-in scanner; real-scanner behavior was verified on the local
candidate. Not run: a signed/notarized candidate scan (no signed build in this
phase) and document-worker pack scanning (pack deferred).

Owner gate: the dispositions above need owner acceptance.

#### Code Review #1 Findings

Reviewed source: uncommitted working tree on `build/r2-release-distribution`
over `f4d2950`; independent analysis and read-only checks by separate reviewers.
Checks: all passed (`pnpm desktop:test` 276, `pnpm check`, `desktop:check`,
knip, Prettier, `git diff --check`, lockfile and `.gitignore` inspection).

- **P1-R1-F1 (blocking):** Gitleaks' built-in allowlist skips `node_modules/`,
  `*.dist-info`, images/fonts/PDF and all binaries, and nested ZIP/tar.gz and the
  PyInstaller PYZ were not expanded, yet the receipt reported a pass and the docs
  claimed full coverage. Reproduced with planted tokens.
- **P1-R1-F2 (blocking, R8):** CLI errors printed stack traces with host paths;
  Gitleaks fatal errors exit 1 like "leaks found", surfacing as a raw ENOENT;
  extraction tools' stderr passed through.
- **P1-R1-F3:** the global `.onnx` path allowlist was broader than its
  "digest-pinned" justification.
- **P1-R1-F4:** symlink targets were never inspected.
- **P1-R1-F5:** the DMG mount point sat inside the scanned tree, and a failed
  detach could mask the original error.
- **P1-R1-F6:** tests did not bind the receipt to the index digest or cover
  scanner failure, version mismatch or ASAR expansion.
- **P1-R1-F7:** `searchNeedles` threw with an empty needle list.
- Notes: the home-directory needle only reflects the scanning machine (CI
  builders use `/Users/runner/`); `native.mjs` would silently skip the prefix map
  if the pgvector lock lost its `CFLAGS=` entry.

#### Code Review #1 Revisions

- **F1 accepted, fixed.** Verified with planted tokens. The scanner now expands
  nested archives and PyInstaller contents and scans a numbered view (binaries
  as strings). Doing so found a real leak (interpreter home path in the frozen
  backend), fixed in `common.mjs`. Coverage counts are in the receipt; docs
  updated. New tests cover nested tar.gz, ASAR, a binary under `node_modules/`.
- **F2 accepted, fixed.** `ScanError` for bounded messages, a CLI catch with a
  generic fallback (`ANIMAMA_SCAN_DEBUG=1` for local detail), `--exit-code 2`
  plus a report-existence check, and tool output logged to the work directory.
  Verified: missing scanner, missing index, bad config and wrong binary each
  print one fixed line.
- **F3 accepted, fixed.** Path allowlist removed; ONNX files are excluded in
  code, counted in the receipt and still byte-searched. Test added.
- **F4 accepted, fixed.** Absolute or private-text symlink targets are findings,
  except an installer's `/Applications` link. Test added.
- **F5 accepted, fixed.** Mount under the work directory, outside the scanned
  tree; `detach -force` fallback.
- **F6 accepted, fixed.** Tests bind the index and file digests and cover canary
  miss, version mismatch and scanner failure.
- **F7 accepted, fixed.** Overlap clamps at zero; covered by a test.
- Notes: `native.mjs` now fails if no `CFLAGS=` entry receives the prefix map.
  The CI-builder needle limitation is documented ("scan on the machine that
  built the candidate") and carried to Phase 4.
- Repair rounds used: 1 of 2.

#### Code Review #2 Findings

Targeted recheck of Review #1 fixes. F1 mostly resolved (a probe over all 5,599
app files found the canary in 5,597); F2–F7 and the `native.mjs` note resolved.

- **P1-R2-F1 (blocking):** Gitleaks silently skips view files whose first bytes
  look like PDF, RTF, PostScript, SQLite, ZIP, gzip or `ar`; two SQLite
  `lexicon.db` files in the app were counted as scanned but skipped.
- **P1-R2-F2 (blocking):** the PEM allowlist (`BEGIN … KEY-----` followed by a
  quote) hid real keys written as JS or Python string concatenations,
  reproduced with fresh `openssl genrsa` keys.
- **P1-R2-F3:** `/Users/Shared` is writable by every account; a planted
  interpreter under the fixed install directory would be run and frozen.
- **P1-R2-F4:** docs overstated archive detection (by extension) and symlink
  containment (only absolute targets were checked).

#### Code Review #2 Revisions

- **F1 accepted, fixed.** Every view file starts with a fixed header line (line
  numbers adjusted); text files are copied rather than linked. The test's fake
  scanner now skips SQLite-prefixed files like Gitleaks, and a SQLite fixture
  fails without the header and passes with it.
- **F2 accepted, fixed.** The PEM entry now exempts only matches with no base64
  run of 40+ characters. Verified: fresh keys as a PEM file, JS concatenation and
  Python implicit concatenation are all reported; the reviewed third-party
  fragments (source and compiled) and the canary behave as before.
- **F3 accepted, fixed.** `assertPrivatePythonInstallDir()` runs before `uv sync`
  in staging and the document-worker build and refuses a directory owned by
  another account or writable by group/others. Documented in
  `runtime-staging.md`.
- **F4 accepted, fixed.** Relative symlinks escaping their artifact are findings
  (`symlink-outside-artifact`, tested); docs list the expanded archive names and
  state that other compressed formats are scanned only as strings.
- Evidence: full candidate scan passes (31,035 files; the two lexicons now
  scanned); `pnpm desktop:test` 279 passed; `pnpm check` exit 0; knip clean for
  changed files; Prettier clean for changed files; ruff passes; `git diff
--check` clean.
- Repair rounds used: 2 of 2.

#### Code Review #3 Findings

Final targeted recheck: P1-R2-F1..F4 resolved, with no blocking findings or
regressions. The reviewer confirmed that all seven previously skipped file-type
prefixes are now scanned, and that fresh keys in five layouts are reported.

- **P1-R3-F1 (non-blocking):** a PEM body split into string chunks of 39 or
  fewer characters, none containing `+` or `/`, still passes the PEM exemption.
  This layout is contrived and has not been seen in practice.
- **P1-R3-F2 (non-blocking):** PyInstaller expansion runs the staged build
  interpreter without repeating `assertPrivatePythonInstallDir()`. Staging
  already ran that check.

#### Code Review #3 Revisions

- **F1 deferred as a documented residual limit.** No code changes were made
  after the final review.
- **F2 deferred to Phase 4.** It will be added alongside the publisher's scan
  gate, which reuses the scanner.
- Result: **pass**. Phase 1 is agent-ready. The owner gate on finding
  dispositions remains.

### Phase 2: Distribution policy and build-time selection

Requirements: R1, R2.
Dependencies: Phase 1 committed (code work can proceed in parallel with the
owner's review of findings).

Intended changes:

1. `release-policy.json` becomes `animama-release-policy/2`, replacing `github`
   with:

    ```json
    "distributions": {
      "r2": { "base_url": "https://downloads.animama.ai/desktop" },
      "github": { "owner": "raymond-van", "repo": "animama-releases" }
    }
    ```

    `validateReleasePolicy` requires both entries. The R2 URL must be HTTPS with
    no port, credentials, query or fragment, and no trailing slash.

2. `loadReleasePolicy` reads `ANIMAMA_RELEASE_DISTRIBUTION`: unset means `r2`;
   `r2` or `github` select; any other value fails with a clear error. It returns
   the selected distribution and derives:
    - the pack release base (`<base_url>/v<version>` for R2,
      `https://github.com/<owner>/<repo>/releases/download/v<version>` for
      GitHub),
    - the embedded update policy (Phase 3 schema).
3. Remove `release_base_url` from `feature-pack-releases.json` and its schema.
   `feature-pack-build.ts` and `worker-input.ts` receive the derived base.
   Retained packs (`release_tag`) swap the version folder the same way on both
   transports.
4. Record the selected distribution in the runtime manifest and signing report,
   so a candidate's transport is auditable after the build.
5. `stagedUpdatePolicy` keeps its inert development policy.

Checks: unit tests for default, explicit and invalid selection, URL
validation, derived pack URLs for both transports, and retained-pack tags;
`pnpm desktop:test`, `pnpm desktop:check`.

Completion: `pnpm desktop:runtime:stage -- --platform darwin --arch arm64`
produces an R2 catalog and policy by default and GitHub values with
`ANIMAMA_RELEASE_DISTRIBUTION=github`.

Results: _pending_

#### Code Review #1 Findings

_pending_

#### Code Review #1 Revisions

_pending_

### Phase 3: Installed-app transport for R2

Requirements: R3, R4.
Dependencies: Phase 2.

Intended changes:

1. Update policy `animama-update-policy/2`:
   `{ schema, channel, team_id, distribution: { kind: "r2", base_url } | { kind: "github", owner, repo } }`.
   `validateUpdatePolicy` rejects anything else, including extra keys.
2. `electron-adapter.ts`: for `r2`, construct `MacUpdater` with
   `{ provider: "generic", url: base_url, channel: "latest" }`. The GitHub path
   is unchanged. All other updater settings stay as they are.
3. `allowedUpdateUrl`: for `r2`, allow only HTTPS to the exact base host with a
   path under the base path (`/desktop/latest-mac.yml` and
   `/desktop/v<semver>/…`), with no redirects to other hosts.
4. `updateFeed` (build time): for R2, file URLs are
   `v<version>/Animama-<version>-arm64.{zip,dmg}`. `validateUpdateCandidate`
   accepts exactly that prefix under an R2 policy and exactly the bare filename
   under a GitHub policy.
5. `catalog.ts`: pack URL validation uses the embedded policy. For R2, accept
   only `<base_url>/v<semver>/<name>.tar.zst` with no redirect hosts. The
   GitHub rules are unchanged, and the development fixture exception remains.

Checks: `desktop-updates.test.ts`, `desktop-updater-adapter.test.ts` and
`feature-packs.test.ts` cover both transports: accepted URLs, rejected
host/path/credential/port/query/redirect cases, and feed candidates with the
wrong prefix. `pnpm desktop:test`, `pnpm desktop:check`, `pnpm check`.

Completion: both transports pass. A GitHub-policy app rejects R2 URLs and
vice versa.

Results: _pending_

#### Code Review #1 Findings

_pending_

#### Code Review #1 Revisions

_pending_

### Phase 4: R2 publisher and release workflow

Requirements: R5, R6, R7, R8.
Dependencies: Phases 1–3.

Intended changes:

1. Split `publish-macos.mjs` into shared gating (index, smoke, acceptance, scan
   receipt) and two transports: the existing GitHub code moved unchanged, and a
   new R2 module. The transport comes from the candidate's recorded
   distribution, not from the current environment, so a candidate cannot be
   published somewhere it was not built for.
2. R2 credentials: `ANIMAMA_R2_ACCOUNT_ID`, `ANIMAMA_R2_ACCESS_KEY_ID` and
   `ANIMAMA_R2_SECRET_ACCESS_KEY` are read only by the publisher. The bucket name
   `animama-releases` is committed in the R2 distribution entry.
3. Uploads to `desktop/v<version>/<name>` use a single `PUT` with
   `If-None-Match: *` (create-only), `x-amz-checksum-sha256`, an explicit
   `Content-Type`, and `Cache-Control: public, max-age=31536000, immutable`.
4. Resume: `HEAD` with checksum mode. An existing object is accepted only when
   its size and SHA-256 match exactly; anything else stops with a manual-review
   message. Nothing is deleted or overwritten.
5. Preflight: an anonymous `HEAD` of the public base must reach Cloudflare over
   HTTPS. `desktop/v<version>/release-artifacts.json` must not already exist,
   because its presence marks a stable release.
6. Post-upload: download every uploaded object anonymously through
   `downloads.animama.ai` and compare its SHA-256. Credentials must never make
   this check pass.
7. Stable promotion: upload acceptance assets, `release-artifacts.json` and
   `SHA256SUMS.txt`, then read the current public feed. Refuse if its version is
   greater than or equal to this one. Write `desktop/latest-mac.yml` last, with
   `Cache-Control: no-cache`, and verify the anonymous read-back.
8. Error output uses bounded messages only: no credentials, signed headers,
   object URLs with query strings, or host paths.
9. Scan gate (also call `assertPrivatePythonInstallDir()` before PyInstaller
   expansion; P1-R3-F2): require a passing `release-scan.json` whose `files` cover every
   uploaded file by SHA-256 (stable promotion rewrites the index). The home-path
   needle only reflects the scanning machine, so scan where the candidate was
   built; a CI-built candidate needs a CI-side scan with runner paths reviewed.
10. Workflow: preview and publication jobs pass the R2 secrets or the GitHub
    token depending on the recorded distribution. The environment/secret table
    in `releases.md` gains the R2 entries. Publication stays unconfigured by
    default.

Checks: publisher unit tests with an injected fake `fetch` cover create-only
conflicts, checksum mismatch, resume with identical and different bytes,
already-stable refusal, feed downgrade refusal, feed-last ordering, a missing
scan receipt, and redacted errors. `pnpm desktop:test`, `pnpm desktop:check`,
`pnpm web:lint`.

Completion: the tests pass, and both transports share one gating path.

Results: _pending_

#### Code Review #1 Findings

_pending_

#### Code Review #1 Revisions

_pending_

### Phase 5: Cloudflare configuration, live bucket exercise and docs

Requirements: R7; issue acceptance for docs and the publisher exercise.
Dependencies: Phase 4; the Phase 1 owner gate.

Steps:

1. Owner (dashboard): add a bucket lock rule with indefinite retention on prefix
   `desktop/v`. Confirm `r2.dev` stays disabled and the token is scoped to
   `animama-releases` only.
2. With owner approval of the exact objects, exercise the publisher against a
   `test/` prefix outside the lock rule, using synthetic files. Cover create-only
   conflict, resume, anonymous hash verification, cache headers, and the feed
   written last. Then delete the synthetic objects with owner approval.
3. Update `releases.md`, `release-process.md` and `feature-packs.md`:
   transport selection, R2 layout, operator setup (domain, lock rule, token
   scope, secret handling), the scan gate, and moving between transports
   (one release on the old transport whose sealed policy points to the new one).
   Remove statements that only GitHub can serve downloads.

Checks: live exercise results recorded here (object names, HTTP statuses, header
values; no credentials). The docs follow the reader-value standard.

Completion: the owner confirms the dashboard settings, the exercise passes, and
the docs are current.

Results: _pending_

#### Code Review #1 Findings

_pending_

#### Code Review #1 Revisions

_pending_

## Final integration review

Covers combined acceptance: selection and defaulting, both transports end to end
in tests, scan gate enforcement, docs, and no credential exposure in code, logs
or artifacts. Reuses still-valid phase evidence.

_pending_

## Validation and acceptance

From `src/frontend`:

```bash
pnpm check
pnpm web:lint
pnpm desktop:check
pnpm desktop:test
```

Acceptance maps to issue #108:

- Security audit complete with owner disposition (Phase 1).
- Unit coverage for policy, selection, allowlists and publisher behavior (Phases 2–4).
- Staged builds embed R2 by default and GitHub when selected (Phase 2).
- Live create-only/verify/resume exercise on a test prefix (Phase 5).
- Docs updated (Phase 5).

Outside this plan: signed candidate build, notarization, fresh-account smoke,
native acceptance, forward upgrade, and the owner's publication decision.

## Idempotence and recovery

- The scan and staging commands are read-only toward the source and safe to
  rerun. Evidence stays outside the checkout.
- R2 uploads never overwrite or delete. A rerun resumes byte-identical objects
  and stops on any difference. The lock rule makes published versions
  permanent, so a correction means a new version.
- The feed is written last. An interrupted stable promotion leaves the previous
  feed in place, and installed apps see no partial release.
- If `downloads.animama.ai` or the token changes, update the committed
  distribution entry and the operator secret. Apps already built keep their
  sealed URL, so the domain must remain served for as long as those apps are
  supported.

## Outcomes & Retrospective

_pending_
