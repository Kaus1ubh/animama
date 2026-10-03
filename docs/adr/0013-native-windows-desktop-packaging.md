# 0013: Native Windows desktop packaging

- Status: accepted
- Recorded: 2026-10-03
- Retrospective: no
- Original decision date: 2026-10-01 (owner decisions D1–D4 on
  [issue #245](https://github.com/raymond-van/animama/issues/245)), with the
  process-guard choice (P-c) approved with the plan on 2026-10-02
- Decision basis: owner decisions recorded in the
  [Windows packaging plan](../plans/windows-desktop-packaging/windows-desktop-packaging-execplan.md#decision-log)

## Context

Animama's self-contained desktop app shipped only for macOS on Apple silicon.
Packaging it natively for Windows 11 x64 needed choices that are costly to
reverse once installed users exist. These are the code-signing identity,
whether the install is per-user or per-machine, where Windows update files
live relative to the macOS ones, and how Animama keeps its local services from
outliving the app. Windows has no equivalent of macOS's parent-death handling
for child processes, so a force-closed Electron process would otherwise leave
PostgreSQL and FastAPI running.

## Decision

1. **Signing identity:** every shipped PE file without a valid vendor signature
   is Authenticode-signed through Azure Artifact Signing, under one validated
   publisher identity. Installed apps accept updates only from that identity's
   certificate subject and identity-validation EKU, sealed into the app at
   staging.
2. **Per-user install:** a one-click NSIS installer installs into
   `%LOCALAPPDATA%\Programs\Animama` without elevation, and updates without it.
   Each Windows account has its own installation owner and data in
   `%LOCALAPPDATA%\Animama`. Animama refuses to run elevated.
3. **Shared distribution, per-platform files:** Windows publishes into the same
   distribution and `v<version>/` folders as macOS, with its own feed
   (`latest.yml`) and `-win32-x64` evidence names. Model objects are shared, and
   each platform publishes and promotes independently.
4. **Guard ownership:** every process Animama starts on Windows runs under its
   own `animama-process-guard.exe`, which holds it in a kill-on-close Job Object
   tied to a lifeline from Electron.

## Rationale and consequences

- Artifact Signing needs no hardware token. Its short-lived certificates sit
  under a stable validated identity, so SmartScreen reputation survives
  certificate rotation, and Microsoft documents that EV certificates no longer
  bypass SmartScreen. Until that identity has download reputation, SmartScreen
  warns on downloaded installers. Signatures use account quota, so only
  intentional candidates are signed. The fallback, if identity validation
  failed, was an OV certificate.
- A per-user install avoids UAC prompts for installs and updates. The install
  folder is writable by the same user; Authenticode and the runtime manifest
  detect corruption but are not a boundary against code already running as that
  user. Machine-wide installs are not supported.
- Sharing the distribution keeps one release per version and one model origin.
  On the GitHub alternate, a release holding only one platform's files makes the
  other platform's update checks fail until its files are added; publishers
  therefore never change the other platform's release state.
- The guard makes a force close leave no owned process. A crash can leave a
  stale process record whose PID Windows later reuses, so a recorded PID blocks
  startup only while it still runs the recorded image.

## Evidence

- [Releases and updates](../frontend/desktop/releases.md#build-a-signed-windows-candidate):
  signing, update publisher checks and Windows publication.
- [Platform builds](../frontend/desktop/platforms.md#unsigned-windows-package):
  the per-user installer and data location.
- `src/frontend/desktop/src/main-process/updates/policy.ts` and
  `electron-adapter.ts`: per-platform publishers and the Windows updater.
- `src/frontend/desktop/src/main-process/runtime/processes.ts`: guard launches
  and process-record handling.
- The plan's Phase 4–8 results: native receipts for the guard, installer,
  signed candidate and platform audit.
