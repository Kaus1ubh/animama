#!/bin/bash
# One-time setup of the golden macOS VM for the release smoke. See
# docs/frontend/desktop/releases.md#fresh-account-smoke-in-a-local-vm.
#
# Run it once, in the golden VM's own Terminal, as the automatically logged-in
# user (never in a smoke clone, never with sudo):
#   bash "/Volumes/My Shared Files/provision/provision-golden.sh"
# sudo asks for that VM user's password. It installs only what the smoke needs:
# Apple's Command Line Tools (git and xcrun stapler), Node.js with corepack's
# pnpm, and Tart's guest agent so `tart exec` runs commands in this login
# session. It never installs or runs Animama: the golden VM must stay fresh.
set -euo pipefail

# Node matches the release workflows' node-version.
node_version=24.15.0
node_sha256=179cdd07168002ed8395ed63d43dc12e4ac1ab8d375f608eabfb9aff2706ff53
agent_version=0.15.0
agent_sha256=eb47f402f18e742a8ea96344115ca776179f9c4c67494bc0c46a10a68db280b7
# Cirrus Labs, Inc. signs the Tart guest agent.
agent_team=9M2P8L4D89
agent_plist=/Library/LaunchAgents/org.cirruslabs.tart-guest-agent.plist

die() {
  echo "provision-golden: $*" >&2
  exit 1
}

[ "$(id -u)" -ne 0 ] || die "run as the logged-in VM user, not with sudo"
[ "$(uname -m)" = arm64 ] || die "expected an Apple Silicon macOS guest"
[ "$(stat -f %Su /dev/console)" = "$(id -un)" ] ||
  die "run it from Terminal in this user's own login session"
for existing in \
  "$HOME/Library/Application Support/Animama" \
  "$HOME/Library/Application Support/Anima" \
  "$HOME/Applications/Animama.app"; do
  [ ! -e "$existing" ] || die "$existing exists; the golden VM must never run Animama"
done

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
fetch() {
  curl -fsSL --proto '=https' --tlsv1.2 -o "$2" "$1"
}
verify_sha256() {
  echo "$1  $2" | shasum -a 256 -c - >/dev/null || die "checksum mismatch for $2"
}

sudo -v

if ! xcode-select -p >/dev/null 2>&1; then
  echo "Installing Apple Command Line Tools..."
  # This marker makes softwareupdate list the on-demand Command Line Tools.
  marker=/tmp/.com.apple.dt.CommandLineTools.installondemand.in-progress
  touch "$marker"
  label=$(softwareupdate --list 2>/dev/null |
    sed -n 's/^\* Label: \(Command Line Tools for Xcode.*\)$/\1/p' |
    sort -V | tail -1)
  [ -n "$label" ] || die "softwareupdate offered no Command Line Tools"
  sudo softwareupdate --install "$label"
  rm -f "$marker"
fi
xcrun --find stapler >/dev/null || die "Command Line Tools lack stapler"

if [ "$(/usr/local/bin/node --version 2>/dev/null)" != "v$node_version" ]; then
  echo "Installing Node.js ${node_version}..."
  pkg="$tmp/node-v$node_version.pkg"
  fetch "https://nodejs.org/dist/v$node_version/node-v$node_version.pkg" "$pkg"
  verify_sha256 "$node_sha256" "$pkg"
  sudo installer -pkg "$pkg" -target /
fi
# Corepack provides the pnpm version each checkout's packageManager pins.
sudo /usr/local/bin/corepack enable

echo "Installing the Tart guest agent ${agent_version}..."
archive="$tmp/tart-guest-agent.tar.gz"
fetch "https://github.com/openai/tart-guest-agent/releases/download/v$agent_version/tart-guest-agent-darwin-all.tar.gz" "$archive"
verify_sha256 "$agent_sha256" "$archive"
mkdir "$tmp/agent"
tar -xzf "$archive" -C "$tmp/agent"
codesign --verify --strict \
  -R "=anchor apple generic and certificate leaf[subject.OU] = \"$agent_team\"" \
  "$tmp/agent/tart-guest-agent" || die "unexpected guest agent signature"
sudo install -d -o root -g wheel -m 0755 /usr/local/bin
sudo install -o root -g wheel -m 0755 "$tmp/agent/tart-guest-agent" /usr/local/bin/tart-guest-agent

# Only the RPC component: `tart exec` runs commands as this user inside its
# Aqua login session, where the app can open windows and use the unlocked
# login keychain. Clipboard sharing (vdagent) and disk resizing stay off.
sudo tee "$agent_plist" >/dev/null <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>org.cirruslabs.tart-guest-agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/tart-guest-agent</string>
    <string>--run-rpc</string>
  </array>
  <key>LimitLoadToSessionType</key>
  <string>Aqua</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>WorkingDirectory</key>
  <string>$HOME</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
PLIST
sudo chown root:wheel "$agent_plist"
sudo chmod 0644 "$agent_plist"
plutil -lint "$agent_plist" >/dev/null
launchctl bootout "gui/$(id -u)/org.cirruslabs.tart-guest-agent" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$agent_plist" ||
  echo "The guest agent will start at the next login."

# A headless smoke clone must not sleep or start the screen saver.
sudo pmset -a sleep 0 displaysleep 0 disksleep 0
defaults -currentHost write com.apple.screensaver idleTime -int 0

echo
echo "Golden VM tools:"
sw_vers
echo "git $(git --version | awk '{print $3}'), node $(/usr/local/bin/node --version), tart-guest-agent $agent_version"
auto_login=$(defaults read /Library/Preferences/com.apple.loginwindow autoLoginUser 2>/dev/null || true)
if [ "$auto_login" = "$(id -un)" ]; then
  echo "Automatic login: $auto_login"
else
  echo "Automatic login is not set for $(id -un). Turn it on in System Settings > Users & Groups before shutting down."
fi
echo "When that is done, shut the VM down from the Apple menu."
