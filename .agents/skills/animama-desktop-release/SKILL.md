---
name: animama-desktop-release
description: Build a signed Animama desktop release candidate from the latest main — release branch and version, model inputs, dependency audit, private-pack fetch, stage and audit, the owner's redistribution review receipt merged to main, the signed and notarized macOS build (or the Authenticode-signed build on the Windows host), the release scan and evidence checks — then run the fresh-account smoke in a disposable VM clone (or hand it to the owner for a test account) and, only on separate approval, publish a preview or stable release. Use when the owner asks to build, sign, notarize, smoke, scan, resume or publish a desktop release or candidate, or for a signing rehearsal.
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
    and today's UTC date.
  - **Pushing the release branch** and **merging its PR**.
  - **Windows signing spend**: confirm before each signed Windows build or
    rehearsal; each uses about 140 signatures from a monthly quota.
  - **Fresh-account smoke**: it makes real provider calls with the owner's key,
    so run it only when the owner asks for this candidate. Run it in a clone of
    the golden smoke VM; without one, the owner runs it in a test account.
  - **Publication**: a preview or stable publish needs an explicit request naming
    the version and stage. Stable also needs the owner's own acceptance JSON;
    never fill its checks or approval fields.
- **Credentials stay in owner-only files.** Load one only for the single command
  that needs it, in a subshell (`set -a; . <file>; set +a`). Never print, copy,
  `cat`, `grep` or log a credential file or value. Use the pack read token for
  fetches; use the R2 publish token only for an approved publish. Signing uses the
  Keychain identity and a notarization profile name; the Windows host uses its
  `az login` sign-in.
- **Build the signed candidate from the merged `main` commit** that holds the
  version and receipts, with a clean tree. Record that commit. Ask the owner to
  hold other merges from staging until the merge, or the stage must be repeated.
- **One candidate per release worktree.** Never rebuild while a candidate is
  under smoke or acceptance: signing changes bytes and invalidates its hashes and
  receipts. Before any rebuild, move the old candidate aside
  ([commands](references/commands.md#preserve-a-candidate)).
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
   unused version and ask the owner to confirm it. To resume, reuse the existing
   release worktree and continue from the first step whose evidence is missing.
2. **Create the release workspace.** From the latest `origin/main`, create the
   worktree `desktop-release-<version>` beside the other task worktrees, on branch
   `build/desktop-release-<version>`. Pull LFS objects and install dependencies.
   Set the version, then commit `build(desktop): set the desktop version to
   <version>`. Write the nonsecret release environment
   ([commands](references/commands.md#release-workspace)). Create or reuse the
   issue `build: release desktop <version>` listing the gates. To release both
   targets, the Windows session stages from the same branch commit and pushes its
   receipt to the same branch, so both receipts merge in one PR.
3. **Preflight.** Check the host, signing identity, notarization profile,
   credential files (presence only), pinned Gitleaks, free disk space and heavy
   slots ([macOS](references/commands.md#preflight),
   [Windows](references/commands.md#windows)). Report every missing input at
   once, and ask the owner for the notarization profile name if it is unset.
4. **Model inputs.** Run the release-only bootstrap into the persistent model
   store. It verifies existing sets and downloads only missing pinned inputs.
5. **Dependency audit.** Run the four documented audits and check that Electron
   is on the latest release of its major. A blocking advisory needs either an
   upgrade on a separate task branch (stop and propose it) or the owner's
   acceptance. Record an accepted advisory, with its reason, in
   `accepted-advisories.txt`.
6. **Packs, stage and audit.** Fetch both private packs with the read token.
   Then stage, with both packs required, through a heavy slot, and run the
   runtime audit.
7. **Redistribution review (owner gate).** Compare the staged inventory hash with
   the target's receipt in `desktop/runtime/release-policy.json`. If it matches,
   go to step 8. Otherwise:
   - Diff the staged inventory against the last reviewed one with
     `scripts/inventory_diff.py`
     ([commands](references/commands.md#redistribution-review)).
   - Present the hash, the diff summary and the generated
     `desktop/release/review/redistribution-review.md` packet.
   - Ask the owner to approve that exact hash.
   - On approval:
     - Write the receipt.
     - Remove only the notes in
       [redistribution review](../../../docs/frontend/desktop/redistribution-review.md)
       that this target's review resolves. Keep the other target's notes, and
       keep the frozen-runtime provider checks for the acceptance handoff.
     - Commit `build(desktop): record the <target> redistribution review`.
8. **Merge the reviewed inputs.**
   - With the owner's go-ahead, push the branch and open the PR
     `build: release desktop <version>`. It covers only part of the release, so
     it says `Refs #<issue>`, not `Closes`. Keep the issue open, and tick its
     checklist as each gate passes.
   - After the owner approves, merge it with an ordinary merge commit.
   - Switch the release worktree to the merged `main` commit. If its tree differs
     from the staged commit beyond the receipts and docs, stage and audit again
     (step 6). If the inventory hash then changes, repeat step 7.
9. **Signed build.**
   - **macOS:** run `desktop:dist:mac` with the notarization profile. It signs,
     notarizes and staples the app, DMG and ZIP, and checks Gatekeeper. If it
     stalls during signing, ask the owner to check for a Keychain access prompt.
   - **Windows:** run `desktop:dist:windows` after the owner confirms the spend.

   Then check the [evidence](references/commands.md#check-the-candidate):
   `release_ready`, the recorded distribution, checksums, sizes and a clean tree
   at the recorded commit.
10. **Release scan.** Run `desktop:release:scan` with the pinned Gitleaks on the
    machine that built the candidate. On a finding, stop and report its rule ID
    and location, never the matched value. For a likely false positive, identify
    the value without printing it, then propose an exact allowlist entry
    ([commands](references/commands.md#scan-findings)). Add it only with the
    owner's agreement, on its own PR. After that merges, move the release worktree
    to the new `main` and rescan; the candidate is not rebuilt.
11. **Hand off.**
    - Report:
      - the release commit and the worktree;
      - the artifact names, hashes and sizes;
      - the remaining gates, including native acceptance and the
        frozen-runtime provider checks.
    - On the owner's go-ahead, run the [VM smoke](references/commands.md#fresh-account-smoke)
      and report its result. Without the golden VM, give the owner the
      test-account handoff there. Check that the reports bind the candidate's
      DMG/installer hash and runtime build ID.
12. **Publish (owner gate, only on request).**
    - **Preview:** run the publisher's preview stage.
    - **Stable:** only after the owner's native acceptance. First rerun the
      dependency audit and the Electron check, and present the results. Then
      publish with the owner's acceptance JSON.

    Verify every published object anonymously
    ([commands](references/commands.md#publication)). A preview publish is
    followed by the owner's native acceptance; on request, install the app for it
    ([commands](references/commands.md#install-for-native-acceptance)). After a
    stable release,
    propose a follow-up to update `desktop/runtime/size-baseline.json` from the
    released size report.
13. **Clean up** after publication or abandonment. Close the release issue with
    a comment naming the published stage. The publisher runs from the release
    worktree, so keep it until then. Remove it with the
    [worktree cleanup procedure](../../../docs/backend/operations/development.md#cleaning-up-worktree-stacks);
    the release has no Compose stack.

## Signing rehearsal

When the owner wants signing exercised without a receipt or an Apple submission
(for example after an Electron or electron-builder upgrade), do the following in
the worktree of the branch under test:

1. Run steps 3–6.
2. Run `--signing-rehearsal` ([commands](references/commands.md#signing-rehearsal)).

Its report says `release_ready: false` and no publisher accepts it. It replaces
`desktop/release/`, including an earlier candidate, so preserve that candidate
first.
