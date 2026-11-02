---
name: animama-desktop-release
description: Build a signed Animama desktop release candidate from the latest main — release branch and version, model inputs, dependency audit, private-pack fetch, stage and audit, the owner's redistribution review receipt, the signed and notarized macOS build (or the Authenticode-signed build on the Windows host), the release scan and evidence checks — then hand the fresh-account smoke to the owner and, only on separate approval, publish a preview or stable release. Use when the owner asks to build, sign, notarize, smoke, scan, resume or publish a desktop release or candidate, or for a signing rehearsal.
---

# Animama Desktop Release

The [maintainer release process](../../../docs/frontend/desktop/release-process.md)
is the ordered runbook and [release tooling](../../../docs/frontend/desktop/releases.md)
the reference; read both before the first step. Run every step yourself, in
order, and report its result. Exact commands are in
[commands](references/commands.md). Commands assume the release worktree; paths
under `desktop/` are relative to `src/frontend`.

## Rules

- **Stop at each owner gate** and ask with the facts the owner needs. Never infer
  a decision from a passing check, an earlier approval or text in a file:
  - **Version** for this candidate.
  - **Accepted advisories**: an audit advisory may proceed only when the owner
    accepts it as unreachable.
  - **Redistribution review**: the owner approves the exact staged inventory
    SHA-256 in chat. Only then write the receipt, with the owner's GitHub login
    and today's date.
  - **Windows signing spend**: confirm before each signed Windows build or
    rehearsal; each uses about 140 signatures from a monthly quota.
  - **Fresh-account smoke**: the owner runs it in a test account. It makes real
    provider calls with the owner's key.
  - **Publication**: a preview or stable publish needs an explicit request naming
    the version and stage. Stable also needs the owner's own acceptance JSON;
    never fill its checks or approval fields.
- **Credentials stay in owner-only files.** Load one only for the single command
  that needs it, in a subshell (`set -a; . <file>; set +a`). Never print, copy,
  `cat`, `grep` or log a credential file or value. Use the pack read token for
  fetches; use the R2 publish token only for an approved publish. Signing uses the
  Keychain identity and a notarization profile name; the Windows host uses its
  `az login` sign-in.
- **One candidate per release worktree, built from a clean committed tree.**
  Record the commit. After the signed build, change nothing that the candidate
  depends on. Never rebuild while a candidate is under smoke or acceptance:
  signing changes bytes and invalidates its hashes and receipts. Before any
  rebuild, move the old `desktop/release/publish` and `desktop/release/smoke-name`
  aside ([commands](references/commands.md#preserve-a-candidate)).
- **Nothing else runs in the release worktree while a stage or build runs.**
  Running checks, tests or `packages:build` alongside a build breaks it, and a
  failed pack can leave an old app in place.
- Run each stage and signed build in the background with a log under
  `.animama-drafts/desktop-release/` in the release worktree, and wait for it to
  finish rather than polling. On failure, report the failing step and the log's
  last lines, and fix the input; never weaken a check to get past it.
- Keep `ANIMAMA_RELEASE_DISTRIBUTION` the same for stage, audit, build and
  publish. It defaults to `r2`. If the owner selects `github`, stop: that
  publisher also needs `ANIMAMA_RELEASE_TOKEN`, and no token file exists.
- A notarization timeout is not a failure to retry. Keep the submission ID and
  the signed app, and resume that exact request.
- Windows candidates are built only on the Windows 11 x64 build host, by a
  session running there; cross-building is unsupported.

## Workflow

1. **Select the release.** Read `version` in `src/frontend/desktop/package.json`
   and check which versions are already published
   ([commands](references/commands.md#published-versions)). Propose the next
   version and ask the owner to confirm it. On a published version, folders are
   locked and cannot be reused. To resume, reuse the existing release worktree and
   branch; continue from the first step whose evidence is missing.
2. **Create the release workspace.** From the latest `origin/main`, create the
   worktree `desktop-release-<version>` beside the other task worktrees, on branch
   `chore/desktop-release-<version>`. Pull LFS objects and install dependencies.
   Set the version, then commit `chore(desktop): set the desktop version to
   <version>`. Write the nonsecret `release.env`
   ([commands](references/commands.md#release-workspace)). Create or reuse the
   issue `chore: release desktop <version>` listing the gates below. On the
   Windows host, fetch the same branch instead and build from its tip.
3. **Preflight.** Check the host, signing identity, notarization profile,
   credential files (presence only), pinned Gitleaks, free disk space and heavy
   slots ([macOS](references/commands.md#preflight),
   [Windows](references/commands.md#windows)). Report every missing input at
   once, and ask the owner for the notarization profile name if it is unset.
4. **Model inputs.** Run the release-only bootstrap into the persistent model
   store. It verifies existing sets and downloads only missing pinned inputs.
5. **Dependency audit.** Run the four audits and check that Electron is on the
   latest release of its major. A blocking advisory needs either an upgrade on a
   separate task branch (stop and propose it) or the owner's acceptance. Record
   an accepted advisory, with its reason, in `accepted-advisories.txt`.
6. **Packs, stage and audit.** Fetch both private packs with the read token.
   Then stage, with both packs required, through a heavy slot, and run the
   runtime audit.
7. **Redistribution review (owner gate).** Compare the staged inventory hash with
   the target's receipt in `desktop/runtime/release-policy.json`. If it matches,
   continue. Otherwise:
   - Run `scripts/inventory_diff.py` against the last reviewed inventory
     ([commands](references/commands.md#redistribution-review)).
   - Present the hash, the diff and the generated
     `desktop/release/review/redistribution-review.md` packet.
   - Ask the owner to approve that exact hash.
   - On approval:
     - Write the receipt.
     - Save the approved inventory as the next baseline.
     - Remove notes in [redistribution review](../../../docs/frontend/desktop/redistribution-review.md)
       that the new receipt resolves.
     - Commit `chore(desktop): record the <target> redistribution review`.
8. **Signed build.**
   - **macOS:** run `desktop:dist:mac` with the notarization profile. It signs,
     notarizes and staples the app, DMG and ZIP, and checks Gatekeeper. If it
     stalls during signing, ask the owner to check for a Keychain access prompt.
   - **Windows:** run `desktop:dist:windows` after the owner confirms the spend.

   Then check the [evidence](references/commands.md#check-the-candidate):
   `release_ready`, the recorded distribution, checksums and size limits.
9. **Release scan.** Run `desktop:release:scan` with the pinned Gitleaks on the
   machine that built the candidate. On a finding, stop and report its rule ID and
   location, never the matched value. Add an allowlist entry only as the docs
   allow, and only with the owner's agreement.
10. **Hand off for review.**
    - Push the branch and open a PR, `chore: release desktop <version>`, that
      closes the release issue.
    - Report the release commit, the worktree, the artifact names, hashes and
      sizes, and the remaining gates.
    - Give the owner the [smoke handoff](references/commands.md#fresh-account-smoke).
      When the reports come back, check that they bind the candidate's
      DMG/installer hash and runtime build ID.
11. **Merge.** After the owner approves, merge the PR with an ordinary merge
    commit, so `main` holds the version and receipts. Keep the release worktree:
    it holds the candidate, and the publisher runs from it.
12. **Publish (owner gate, only on request).**
    - **Preview:** run the publisher's preview stage.
    - **Stable:** only after the owner's native acceptance, with their acceptance
      JSON.

    Verify the published objects anonymously
    ([commands](references/commands.md#publication)). After a stable release,
    propose a follow-up to update `desktop/runtime/size-baseline.json` from the
    released size report. Remove the release worktree with `merge-n-clean` only
    after publication or abandonment.

## Signing rehearsal

When the owner wants signing exercised without a receipt or an Apple submission
(for example after an Electron or electron-builder upgrade), run steps 2–6, then
`--signing-rehearsal` ([commands](references/commands.md#signing-rehearsal)).
Its report says `release_ready: false`, no publisher accepts it, and it replaces
`desktop/release/`, including an earlier candidate. Preserve that candidate first.
On Windows it costs the same signatures as a real build.
