# Electron 45 desktop upgrade and asynchronous vault encryption

Source agreement: [raymond-van/animama#737](https://github.com/raymond-van/animama/issues/737)
as published on 2026-10-27, plus the owner decisions dated 2026-10-27 in the
[Decision Log](#decision-log).
Authorized scope: the whole plan (dated task instruction, 2026-10-27). Nothing in
this plan authorizes notarizing or signing a release candidate, publishing or
merging.

## Purpose and context

The desktop shell runs Electron 44.9.3 (#724, PR #730). Electron 45.0.0
(2026-10-21) deprecates the synchronous `safeStorage` calls the credential
vault uses, and Electron 46 removes them. The vault holds every desktop user's
provider keys, model-connection keys and the private PostgreSQL password, so it
moves to the asynchronous API now and must keep opening vaults that Electron 44
builds wrote.

After this work the desktop app runs Electron 45.0.0 (Chromium 156.0.8078.48,
Node 24.22.0, unchanged from 44.9.3). electron-builder stays 26.18.0 and
`electron-updater` 6.8.11: neither has an Electron 45 requirement.

Commands run from `src/frontend` unless stated. Working checkout: a task worktree
on branch `build/electron-45`, based on `main` `d30a6ddc` (#733's merge). No
Compose stack is needed.

### Orientation

| Area     | Files                                                                                                     |
| -------- | --------------------------------------------------------------------------------------------------------- |
| Versions | `desktop/package.json`, `pnpm-lock.yaml`, `desktop/runtime/source-manifest.json`                          |
| Vault    | `desktop/src/main-process/runtime/vault.ts`, `supervisor.ts`, `desktop/scripts/native/vault-encryption-harness.ts` |
| Preload  | `desktop/scripts/runtime/js-audit.mjs` (bundle import audit)                                               |
| Tests    | `desktop/tests/runtime-state.test.ts`, `runtime-supervisor.test.ts`, `runtime-packaging.test.mjs`, `windows-release.test.mjs`, `tests/test_desktop_credentials_route.py` |
| Copy     | `desktop/src/locales/*.json` (`startup.secureStorage.macos`)                                               |
| Docs     | `docs/backend/operations/desktop-runtime.md`, `docs/frontend/desktop/platforms.md`, `troubleshooting.md`  |

### Breaking changes reviewed (Electron 45)

Read from Electron's `docs/breaking-changes.md` at `v45.0.0` and checked against
`desktop/src` and `desktop/scripts`:

- Sandboxed preloads lose the `events`, `timers` and `url` shims and the
  `Buffer`, `setImmediate` and `clearImmediate` globals. Every window is
  sandboxed and the bundled `dist/preload.cjs` requires only `electron` and
  uses none of those globals. The bundle audit now rejects any Node built-in
  import in the preload, so a future one fails the build instead of the window.
- `ipcRenderer`/`process` in sandboxed preloads use a native `EventEmitter`
  without the static `once`/`listenerCount`/`init` helpers. Not used.
- `contentTracing.enableHeapProfiling()` removed; JSON traces gone. Not used.
- Screen capture requests arrive as `display-capture`. The permission handlers
  allow only audio `media` from the app origin and deny everything else, so
  screen capture stays denied as before.
- `getUserMedia` with `chromeMediaSource: 'desktop'` and WebContents ids,
  `window.open()` children of unsandboxed windows, `requestStorageAccessFor`,
  workers in subframes and DevTools extension frames: not used (every
  `window.open` is denied).
- ASAR file descriptors work only through `fs`. Every descriptor main opens is
  for a file outside ASAR (logs, locale cache, migrations, atomic writes, packs,
  downloads, pack signatures, update files); the native input addon is unpacked
  from ASAR.
- `safeStorage.isEncryptionAvailable`, `encryptString` and `decryptString` are
  deprecated (removed in 46). The vault is the only user.
- A typings diff between `electron@44.9.3` and `45.0.0` finds no other newly
  deprecated or removed member.
- Node stays 24.22.0; `NODE_MODULE_VERSION` becomes 150. The first-party input
  hook is N-API and loads unchanged.

### Asynchronous `safeStorage` compatibility

From Electron 45's `shell/browser/api/electron_api_safe_storage.cc` and
`browser_process_impl.cc`, and Chromium 156's `components/os_crypt/async`:

- macOS: the `KeychainKeyProvider` reads the same "<app name> Safe Storage"
  Keychain item and derives the same AES-128-CBC key as the synchronous
  OSCrypt, tagged `v10`. Windows: the `DPAPIKeyProvider` unwraps the same
  `os_crypt.encrypted_key` from `Local State`, tagged `v10`. Electron's docs
  state that `decryptStringAsync` reads data `encryptString` wrote.
- `isAsyncEncryptionAvailable()` resolves `false` only before the app is ready;
  once the encryptor initializes it resolves `true` even if a key provider
  failed. A missing key surfaces as a rejected encrypt or decrypt.
- A decrypt whose provider failed temporarily (a refused or locked Keychain)
  rejects with "safeStorage.decryptStringAsync is temporarily unavailable.
  Please try again."; other failures reject with "Error while decrypting…".
  The message is the only signal.
- Electron requests the encryptor once per process and Chromium caches it, so a
  temporarily unavailable key stays unavailable until the app restarts.
- `shouldReEncrypt` is true when the data's provider is not the one used for
  encryption (a rotated key). macOS and Windows each register one provider
  today, so it is false in practice.
- Windows still runs `OSCrypt::Init` before the async provider reads the key,
  so a new vault must still wait until Chromium has written `Local State`
  (`awaitDurableEncryptionKey`).

## Progress

- [x] Research, issue #737 and branch (2026-10-27).
- [ ] Phase 1: Electron 45 and the asynchronous vault.
- [ ] Final integration review, full pre-push suite and PR.
- [ ] Owner gates (see [Validation and acceptance](#validation-and-acceptance)).

## Surprises & Discoveries

- Electron 44.9.3 already exposes the asynchronous `safeStorage` calls with the
  same Chromium key providers; only the deprecation is new in 45.
- The synchronous and asynchronous APIs produce the same `v10` format, so the
  vault file format does not change.
- Electron's documentation says that after `shouldReEncrypt` "you should call
  `decryptStringAsync` again to receive the new decrypted string". Chromium's
  `Encryptor` sets the flag when the data's provider is not the encryption
  provider, which means re-encrypting with the current key; the vault does that.
- Electron's `safe-storage.md` mentions an `isTemporarilyUnavailable`
  indicator, but 45.0.0 exposes the condition only through the rejection
  message, which the vault matches.
- The default macOS staging uv cache, `/private/tmp/animama-uv-cache`, was
  partly deleted by macOS's temporary-folder cleanup (158 of 359 wheels lost
  files), which broke `uv` during staging.
- The recovery text for `secure_storage_unavailable` on macOS said "Unlock your
  login keychain and retry". With the asynchronous encryptor cached for the
  process lifetime, Retry cannot recover a refused Keychain request; the text
  now says to quit and reopen Animama.

## Decision Log

- 2026-10-27, owner: upgrade to Electron 45 as a phase-3 dependency upgrade,
  separate from the provider SDK majors; migrate the vault in the same change.
- 2026-10-27, agent: keep electron-builder 26.18.0 and `electron-updater`
  6.8.11. Electron 45 needs neither change; 26.18.1 and 6.8.12 add nothing this
  upgrade uses.
- 2026-10-27, agent: map the "temporarily unavailable" rejection to
  `secure_storage_unavailable` (the synchronous API reported a refused Keychain
  as unavailable encryption); every other decrypt failure stays
  `vault_unreadable`. Matching the message is the only way to tell them apart.
- 2026-10-27, agent: the vault queues its writes. Encryption is now
  asynchronous, so each write computes its change from the state the previous
  write saved; the supervisor already serializes credential changes, and the
  queue keeps the vault correct on its own.
- 2026-10-27, agent: rewrite the vault on `shouldReEncrypt` during open and let
  a failed rewrite fail the open, like any other failed vault write.
- 2026-10-27, agent: one phase. The version bump, the vault migration and the
  breaking-change fixes ship together and share their native evidence.

## Phased implementation

### Phase 1: Electron 45 and the asynchronous vault

Review tier: high risk (dependency, packaging, persistence of secrets).

Requirements R1–R4 of #737. Starting source `d30a6ddc`.

Changes:

1. `desktop/package.json` `electron` 45.0.0, the lock and
   `desktop/runtime/source-manifest.json` (staging refuses a mismatch).
2. `vault.ts`: `Encryption` is the asynchronous `safeStorage` subset.
   `CredentialVault.open()` replaces the constructor; `set`, `delete` and
   `apply` return promises. Writes run through a queue and compute their change
   from the latest saved state; a failed write changes neither file nor memory.
   A temporarily unavailable decrypt is `secure_storage_unavailable`; a decrypt
   reporting `shouldReEncrypt` rewrites the vault with the current key.
3. `supervisor.ts` awaits `CredentialVault.open()` and `apply()`.
4. `runtime-state.test.ts`: the fake storage has the asynchronous calls plus
   `seal`, standing for Electron 44's synchronous writes. New tests: an Electron
   44-format vault opens unchanged and stays readable after a change; a rotated
   key rewrites the file; concurrent writes keep both changes and a failed one
   blocks nothing; a temporarily unavailable key is `secure_storage_unavailable`
   while a permanent failure is `vault_unreadable`, with the file untouched.
5. `vault-encryption-harness.ts` (`pnpm desktop:test:vault`) writes a vault with
   the synchronous `encryptString`, as Electron 44 did, and opens and updates it
   with the asynchronous vault, before its existing checks. `write-legacy` and
   `check-legacy` phases split that across two Electron binaries.
6. `js-audit.mjs`: the preload bundle may import only `electron`.
7. The macOS `secure_storage_unavailable` recovery text (five locales) and the
   docs listed above.

Check record (macOS 26.6 arm64, Node 24.15.0, pnpm 10.33.0, `src/frontend`
unless stated). Unit and harness checks ran on the working tree that became
`f9c3c584` (tree `22b2865c`); the native rows ran on `f9c3c584` itself.

| Command | Result |
| --- | --- |
| `pnpm -C desktop check` | pass |
| `vitest run tests/runtime-state.test.ts tests/runtime-supervisor.test.ts` (`desktop`) | 121 passed, 3 skipped |
| Mutation: vault writes not queued / no rewrite on `shouldReEncrypt` | the ordering test / the rotation test fails |
| `pnpm desktop:test` | 561 passed, 14 skipped (32 files) |
| `pnpm desktop:test:vault` | `vault encryption (all): OK` (real Keychain, Electron 45.0.0; Electron prints its `encryptString` deprecation for the legacy write) |
| Cross-binary: harness `write-legacy` under Electron 44.9.3, then `check-legacy` under 45.0.0 (same folder) | both OK; the file starts `v10` before and after the asynchronous rewrite |
| Reverse probe: `encryptStringAsync` under 45.0.0, `decryptString` under 44.9.3 | plaintext recovered |
| Main-process `fetch` header probe, Electron 44.9.3 and 45.0.0 | identical headers, matching `tests/test_desktop_credentials_route.py` |
| `pnpm desktop:test:native-input` | 1046 assertions pass; the addon also loads under Electron 45 (`ELECTRON_RUN_AS_NODE`, ABI 150) |
| `dist/preload.cjs` imports (esbuild metafile) | only `electron`; no `Buffer`/`setImmediate`/`clearImmediate` |
| `pnpm i18n:check`, `pnpm prettier:check` | pass |
| `pnpm desktop:runtime:stage` / `desktop:runtime:audit` (darwin-arm64) | `runtime audit: OK`; embedded Electron 45.0.0, Node 24.22.0; download 383,778,644 / 786,432,000 bytes, installed 854,853,394 / 1,610,612,736 |
| `pnpm desktop:mac` | `Unsigned development app: release/mac/Animama.app; runtime inventory: OK` |
| `pnpm desktop:dist:mac -- --signing-rehearsal` | 166 native files signed and verified, 8 nested bundles; app passes `codesign --verify --deep --strict` (hardened runtime, Team ID, secure timestamp), DMG verifies; `release_ready: false`, not submitted; Gatekeeper rejects it as unnotarized |
| electron-builder 26.18 Windows `dir` build from macOS with the real `electron-v45.0.0-win32-x64.zip` (development options, stand-in runtime) | pass: `Animama.exe` edited (Animama version strings, 16–256 px icon), `app.asar` holds main, preload and the unpacked addon, nothing signed; `electron.exe` is still the only top-level executable |
| Supervised unpackaged launch (`ANIMAMA_DESKTOP_DEV_RUNTIME_ROOT` = the stage, disposable `ANIMAMA_DESKTOP_DEV_USER_DATA`) | reached `Runtime starting: vault`, then waited on the macOS Keychain prompt for "Animama Safe Storage" (owner gate) |
| Full pre-push suite on `f9c3c584` (clean tree `22b2865c`, through `scripts/heavy-slot.py`) | `make check-test` (root): ruff format (865 files) and check, mypy, pytest 4875 passed, 29 skipped; `pnpm verify`: 593 files, 5704 passed, 1 skipped; `pnpm web:test:browser`: 131 passed; `pnpm desktop:test`: 561 passed, 14 skipped; `pnpm prettier:check`: pass |

The cross-binary rows ran by hand, from `src/frontend/desktop` after
`pnpm desktop:test:vault` had built the harness, with `ELECTRON_RUN_AS_NODE`
unset and Electron 44.9.3 extracted from Electron's download cache
(`electron-v44.9.3-darwin-arm64.zip`):

```sh
ROOT="$(mktemp -d "$(realpath "$TMPDIR")/vault-cross-XXXXXX")"
<electron-44.9.3>/Electron.app/Contents/MacOS/Electron \
  .desktop-runtime/tools/vault-encryption-harness.mjs write-legacy "$ROOT"
"$(node -e 'console.log(require("electron"))')" \
  .desktop-runtime/tools/vault-encryption-harness.mjs check-legacy "$ROOT"
rm -rf "$ROOT"
```

On Windows the same two phases use each version's `electron.exe`.

The first staging attempt failed in `uv`: macOS's temporary-folder cleanup had
removed files from 158 of 359 wheels in the default macOS staging cache,
`/private/tmp/animama-uv-cache`. Staging succeeded with
`UV_CACHE_DIR=$HOME/Library/Caches/Animama/uv-cache`; the default cache location
is a follow-up outside this plan.

#### Code Review #1 Findings

Reviewed source: `f9c3c584` (tree `22b2865c`) plus this record; baseline
`d30a6ddc`. Two independent reviewers: analysis, and checks (reran
`pnpm -C desktop check`, `desktop:test` 561 passed, `desktop:test:vault`,
`desktop:test:native-input` plus an Electron 45 addon load, `i18n:check`,
`pytest tests/test_desktop_credentials_route.py` 87 passed, the version pins and
the preload metafile; all reproduced the record). Result: pass, no blocking
findings.

- C1: no test that a failed rewrite on `shouldReEncrypt` fails the open.
- C2: no supervisor test of a failed asynchronous open (status code, no
  services started, a later start opens the vault).
- C3 / F2: the cross-binary run has no exact commands in the record and cannot
  be repeated from it; the harness's legacy write needs rework when Electron 46
  removes `encryptString`.
- F1: R3's refused-Keychain mapping has only fake evidence and depends on
  Electron's message; the deny-once owner check was optional.
- F3: the unpackaged launch stops at the Keychain prompt, so #737's launch
  criterion is still open.
- F4: `desktop-runtime.md` narrated the change ("the file format did not
  change").
- F5: the "Electron 44 build wrote with the synchronous API" test name claims
  crypto compatibility that only the native harness proves.
- F6 (optional): the preload guard catches built-in imports but not the removed
  `Buffer`/`setImmediate`/`clearImmediate` globals.
- F7: the ASAR survey item listed too few descriptor users.

#### Code Review #1 Revisions

- C1: fixed. The rotation test also opens with a failing encryptor and expects
  `secure_storage_unavailable` with the file unchanged; swallowing the rewrite
  error makes it fail.
- C2: fixed. A supervisor test reopens an existing vault with a decryptor that
  rejects as temporarily unavailable: status `secure_storage_unavailable`, no
  PostgreSQL start, vault unchanged, and the next start is ready. Mapping the
  rejection to `vault_unreadable` makes it fail.
- C3 / F2: fixed in the record (exact commands above). The Electron 46 rework is
  left to that upgrade, when the typings drop `encryptString` and `pnpm check`
  fails on the harness.
- F1: fixed. The deny-once check is now a required owner gate, and the vault
  comment says to recheck the message on every Electron upgrade.
- F3: accepted as an owner gate; it needs the owner to allow the Keychain
  prompt.
- F4: fixed ("both write the same `v10` format").
- F5: fixed (renamed "opens a vault in the layout Electron 44 builds saved").
- F6: not changed. The guard reads the esbuild import metafile, which cannot
  see globals, and a text scan of the bundle would also match strings and
  comments. The built preload has none today.
- F7: fixed in the survey.

Checks after the revisions: `vitest run tests/runtime-state.test.ts
tests/runtime-supervisor.test.ts` 122 passed, 3 skipped; both mutations above
fail the new tests. At the high-risk tier every repair gets a recheck: see
Code Review #2.

## Final integration review

Pending.

## Validation and acceptance

Owner gates, not performable on the macOS development host or without the
owner:

- Windows 11 x64: `pnpm desktop:test:vault` (DPAPI through the asynchronous
  API), `desktop:test`, `desktop:test:native-input`, `desktop:test:termination`,
  `desktop:win:installer`, then `pnpm desktop:dist:windows -- --signing-rehearsal`
  and the Windows signed build.
- The first launch of each unpackaged or newly signed macOS build asks for the
  "Animama Safe Storage" Keychain item. Allow it, confirm the supervised
  unpackaged launch reaches `Runtime ready`, and confirm an existing vault opens
  with its keys (#737's unpackaged-launch criterion stays open until then).
- R3 natively: deny that prompt once and confirm the recovery page shows the
  macOS secure-storage message (not `vault_unreadable`) and the vault file is
  unchanged; then quit, reopen and allow. Only a fake has exercised the
  rejection message the vault matches.
- Native acceptance with Electron 45 on both platforms: microphone permission
  and dictation, voice mode audio, PiP, quick chat, global Press-to-talk, saving
  and removing a provider key, runtime recovery and an update check.
- Both redistribution receipts (`darwin-arm64`, `win32-x64`) are stale again:
  the licence inventory records Electron's version and Chromium notices.

## Idempotence and recovery

The vault file format and location do not change. A vault the asynchronous API
cannot read is reported, never replaced. Reverting this change restores
Electron 44, which reads every vault this change writes (same `v10` format and
key). Staging and packaging write only ignored build output.

## Outcomes & Retrospective

Pending.
