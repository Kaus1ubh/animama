#!/bin/bash
# Runs inside a disposable smoke clone through `tart exec -i`; smoke-macos-vm.sh
# copies it there with the DMG and source bundle. Reads the OpenAI key as the
# first line of stdin, so it never appears in arguments or on the guest disk
# outside the app's own vault.
#   guest-smoke.sh <inputs-dir> <dmg-name>
set -euo pipefail

inputs=$1
dmg="$inputs/$2"
# The guest agent's launchd environment may lack a login shell's variables;
# give the smoke the same ones a Terminal session in this account would have.
export HOME="${HOME:-$(cd ~ && pwd)}"
export USER="${USER:-$(id -un)}" LOGNAME="${LOGNAME:-$(id -un)}"
export TMPDIR="${TMPDIR:-$(getconf DARWIN_USER_TEMP_DIR)}"
export LANG="${LANG:-en_US.UTF-8}"
export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

IFS= read -r key || true
[ -n "$key" ] || { echo "guest-smoke: no OpenAI key on stdin" >&2; exit 1; }

# The packaged app needs this user's GUI session: windows and the unlocked
# login keychain behind its credential vault.
[ "$(launchctl managername)" = Aqua ] ||
  { echo "guest-smoke: not in the user's Aqua login session" >&2; exit 1; }
[ "$(stat -f %Su /dev/console)" = "$USER" ] ||
  { echo "guest-smoke: $USER is not logged in at the console" >&2; exit 1; }

work="$HOME/animama-smoke"
[ ! -e "$work" ] || { echo "guest-smoke: $work exists; this clone is not fresh" >&2; exit 1; }
# The smoke installs the DMG, so LFS content is not needed from the bundle.
GIT_LFS_SKIP_SMUDGE=1 git -c advice.detachedHead=false clone -q "$inputs/source.bundle" "$work"
cd "$work/src/frontend"
pnpm install --frozen-lockfile </dev/null

status=0
ANIMAMA_SMOKE_OPENAI_KEY="$key" pnpm desktop:smoke:mac -- --artifact "$dmg" --setup name </dev/null || status=$?
unset key
exit "$status"
