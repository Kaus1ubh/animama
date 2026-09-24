# Native and audible acceptance handoff

On 2026-09-24 the owner explicitly waived these remaining native UI and audible
playback checks for this PR. They are **waived, not passed**. This checklist
retains the prepared candidate and steps for later manual acceptance.
Browser results and the unsigned build audit are recorded in the
[ExecPlan](local-content-sharing-execplan.md); they do not establish these results.

## Prepared candidate

- Product source: `35251bb5f963072a7282d569b3360fd34825a62a`.
- Unsigned app: `src/frontend/desktop/release/mac/Animama.app`.
- Runtime build ID: `f5610d6ade3425c03c6c2b5357872eefa7e6751239d24bbb1fb9c4840770a7a8`.
- Local test file: `/tmp/animama-p6-playback/playback-fixtures.animama`, 335,825 bytes,
  SHA-256 `3c6b64ea12966951d7811db31d9110440058b9480a9924280c7dd7372ec57a18`.
  It contains an original VRMA head-turn Style, an original clip Style with a
  six-second tone and visual effects, and the separate tone Sound Effect.
  Its seven entries contain no companion history or credentials.

The fixture's exact creation records are retained in
`/tmp/animama-p6-playback/ledger.json`. These temporary files and the app are local
handoff artifacts, not repository build inputs or distributed assets.

## Two native environments

Use an isolated development profile for the external-stack shell. From
`src/frontend`, with the task stack running:

```sh
source ../../.animama-stack.env
env -u ANIMAMA_DESKTOP_DEV_RUNTIME_ROOT \
  ANIMAMA_DESKTOP_DEV_USER_DATA="$PWD/desktop/.desktop-runtime/local-sharing-p6-external" \
  pnpm desktop:dev
```

For packaged acceptance, open the prepared app normally in a disposable macOS
test account with no existing Animama/Anima profile. Packaged mode rejects
development profile and web-origin overrides. Keep the existing personal profile
untouched; do not reset it or change `HOME`. Complete local setup without adding
provider credentials. The packaged runtime has its own installation and content.

Record the environment and observed result for each check in both modes:

1. Import the test file through Choose file, then import it again using drag/drop.
   Review automatic suffixed names and the complete required-content list. Check
   that both sets remain independently editable after reopening the app.
2. Export a selected Style. Save the `.animama` file, cancel a second save, then
   retry. Record native save errors if encountered; cancellation must not remove
   Library content or leave the dialog unusable.
3. Export the included Annie as a complete Anima, import that file, close/reopen
   the app, and open the result. Check
   that retry/recovery refers to that installed companion and creates no extra
   copies. Browser fault injection separately proves the lost-response case.
4. Preview both Styles on a real Avatar. The VRMA and clip head turns must finish;
   the clip's eye/scene effects must clear. Listen for the tone and stop the
   preview during playback; its tone must stop with it.
5. With a Style equipped, observe finite idle playback and interruption by normal
   activity. Confirm unrelated Sound Effects and existing TTS still work and are
   not cancelled by idle cleanup. No paid-provider test is required; use an
   already available local speech path. Record unavailable audio paths explicitly.

Native file choose/drop/save/recovery and physical audio results were not observed;
the task-specific owner waiver permits this PR to proceed. No signed-release, minimum-OS,
notarization or publication acceptance is claimed by this checklist.
