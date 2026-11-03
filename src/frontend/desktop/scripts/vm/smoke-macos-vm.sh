#!/bin/bash
# Run the fresh-account macOS release smoke in a disposable clone of the golden
# Tart VM, then bring its reports back. See
# docs/frontend/desktop/releases.md#fresh-account-smoke-in-a-local-vm. From src/frontend:
#   pnpm desktop:smoke:mac:vm -- --artifact desktop/release/publish/Animama-<version>-arm64.dmg
#
# The clone gets the exact DMG, a bundle of the committed HEAD and the OpenAI
# key (from an owner-only file, through stdin) over `tart exec`. No host folder
# is shared with it. The clone is deleted afterwards unless --keep is given.
set -euo pipefail

golden=${ANIMAMA_SMOKE_VM_GOLDEN:-animama-smoke-golden}
key_file=${ANIMAMA_SMOKE_KEY_FILE:-$HOME/.config/animama/smoke-openai.env}
desktop_root=$(cd "$(dirname "$0")/../.." && pwd -P)
frontend_root=$(dirname "$desktop_root")
output="$desktop_root/release/smoke-name"

die() {
  echo "smoke-macos-vm: $*" >&2
  exit 1
}
usage() {
  die "Expected --artifact <signed.dmg> [--keep]"
}

artifact=
keep=0
while [ $# -gt 0 ]; do
  case $1 in
    --) shift ;;
    --artifact)
      [ $# -ge 2 ] || usage
      artifact=$2
      shift 2
      ;;
    --keep)
      keep=1
      shift
      ;;
    *) usage ;;
  esac
done
[ -n "$artifact" ] || usage
# Like desktop:smoke:mac, relative artifacts are rooted at src/frontend.
case $artifact in /*) ;; *) artifact="$frontend_root/$artifact" ;; esac
[ -f "$artifact" ] && [ ! -L "$artifact" ] && [[ $artifact == *.dmg ]] ||
  die "Smoke input must be a regular signed DMG"

command -v tart >/dev/null || die "Tart is not installed"
state=$(tart get "$golden" --format json 2>/dev/null | plutil -extract State raw -o - -) ||
  die "No golden VM named $golden"
[ "$state" = stopped ] || die "$golden must be stopped; smoke runs only in clones"
[ -f "$key_file" ] && [ "$(stat -f %Su:%Lp "$key_file")" = "$(id -un):600" ] ||
  die "Create the owner-only key file $key_file (mode 600)"
[ -z "$(git -C "$frontend_root" status --porcelain --untracked-files=no)" ] ||
  die "The VM runs the committed HEAD; commit or remove tracked changes first"
[ ! -e "$output" ] || die "$output exists; move the previous reports aside"

work=$(mktemp -d "${TMPDIR:-/tmp}/animama-vm-smoke.XXXXXX")
vm="animama-smoke-run-$(date +%Y%m%d-%H%M%S)"
created=0
run_pid=
cleanup() {
  local status=$?
  if [ "$created" = 1 ]; then
    tart stop "$vm" >/dev/null 2>&1 || true
    [ -z "$run_pid" ] || wait "$run_pid" 2>/dev/null || true
    if [ "$keep" = 1 ]; then
      echo "Kept stopped clone $vm. It can still hold the test key; delete it with: tart delete $vm" >&2
    else
      tart delete "$vm" || echo "Could not delete $vm; delete it with: tart delete $vm" >&2
    fi
  fi
  rm -rf "$work"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

mkdir "$work/inputs" "$work/reports"
cp -c "$artifact" "$work/inputs/" 2>/dev/null || cp "$artifact" "$work/inputs/"
git -C "$frontend_root" bundle create -q "$work/inputs/source.bundle" HEAD
cp "$desktop_root/scripts/vm/guest-smoke.sh" "$work/inputs/"

tart clone "$golden" "$vm"
created=1
tart run --no-graphics --no-audio "$vm" >"$work/tart-run.log" 2>&1 &
run_pid=$!
echo "Booting ${vm}..."
ready=0
for _ in $(seq 1 90); do
  if tart exec "$vm" /usr/bin/true >/dev/null 2>&1; then
    ready=1
    break
  fi
  kill -0 "$run_pid" 2>/dev/null || die "VM stopped while booting: $(tail -3 "$work/tart-run.log")"
  sleep 2
done
[ "$ready" = 1 ] || die "The guest agent did not answer within 3 minutes; is automatic login on?"
echo "Guest: macOS $(tart exec "$vm" /usr/bin/sw_vers -productVersion) ($(tart exec "$vm" /usr/bin/sw_vers -buildVersion))"

guest_home=$(tart exec "$vm" /bin/bash -c 'cd ~ && pwd')
guest_inputs="$guest_home/smoke-inputs"
tart exec "$vm" /bin/mkdir -m 0700 "$guest_inputs"
tar -c -C "$work/inputs" . | tart exec -i "$vm" /usr/bin/tar -x -C "$guest_inputs"

status=0
(
  set -a
  # shellcheck disable=SC1090
  . "$key_file"
  set +a
  printf '%s\n' "${ANIMAMA_SMOKE_OPENAI_KEY:?is not set in the key file}"
) | tart exec -i "$vm" /bin/bash "$guest_inputs/guest-smoke.sh" "$guest_inputs" "$(basename "$artifact")" ||
  status=$?

# Accept only the two expected regular files from the guest.
tart exec "$vm" /usr/bin/tar -c -C "$guest_home/animama-smoke/src/frontend/desktop/release" smoke-name 2>/dev/null |
  tar -x -C "$work/reports" 2>/dev/null || true
reports="$work/reports/smoke-name"
for file in smoke-report.json network-report.json; do
  [ -f "$reports/$file" ] && [ ! -L "$reports/$file" ] ||
    die "The guest produced no $file (smoke exit $status)"
done
if [ "$status" != 0 ]; then
  output="$desktop_root/release/smoke-name-failed-$(date +%Y%m%d-%H%M%S)"
fi
mkdir -p "$output"
cp "$reports/smoke-report.json" "$reports/network-report.json" "$output/"
echo "Reports: $output"
[ "$status" = 0 ] || die "The smoke failed (exit $status); inspect $output/smoke-report.json"

dmg_sha256=$(shasum -a 256 "$artifact" | awk '{print $1}')
[ "$(plutil -extract dmg_sha256 raw -o - "$output/smoke-report.json")" = "$dmg_sha256" ] ||
  die "The smoke report does not bind this DMG's SHA-256"
[ "$(plutil -extract passed raw -o - "$output/smoke-report.json")" = true ] ||
  die "The smoke report did not pass"
index="$(dirname "$artifact")/release-artifacts.json"
if [ -f "$index" ]; then
  [ "$(plutil -extract runtime_build_id raw -o - "$output/smoke-report.json")" = \
    "$(plutil -extract runtime_build_id raw -o - "$index")" ] ||
    die "The smoke report's runtime build ID differs from $index"
  echo "The reports bind this DMG and the candidate's runtime build ID."
else
  echo "No release-artifacts.json beside the DMG: check runtime_build_id against the candidate by hand."
fi
