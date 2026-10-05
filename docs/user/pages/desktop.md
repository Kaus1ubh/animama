# Desktop getting started

**Desktop download: Coming soon.** No signed public installer is available yet.
The steps below describe the implemented setup flow for an approved release.

## Requirements

The declared desktop targets are Apple silicon Macs running macOS 15 or later
and Windows 11 x64 (build 22000 or later). Clean-machine and signed release
acceptance remain pending. Intel Macs, Windows ARM and Linux do not have a
supported desktop release.

The installed app includes its own services and database. You do not need
Docker, Python, Node.js or a source checkout.

## Install an approved release

When an installer is available, check its release notes and checksums first.

1. On macOS, open the arm64 DMG, copy **Animama.app** to Applications and open it
   through Finder. If macOS reports a damaged or unverified app, stop; do not
   disable Gatekeeper or remove quarantine.
2. On Windows, run the x64 installer for your Windows account. Open Animama
   normally, without **Run as administrator**. If SmartScreen warns, verify the
   publisher and file checksum against the release notes before continuing.
3. Let Animama prepare its private database. It creates one installation owner
   automatically. There is no local login or Animama Cloud account requirement.

## First setup

1. **Welcome:** enter the name your companion should use and confirm you are 18
   or older. The name is private personalization, not a username.
2. **AI:** choose a remote provider with your own key, or a running local model
   server such as Ollama, LM Studio or llama.cpp. The selected model becomes your
   default Chat model. **Skip for now** keeps the default, but chat still needs a
   reachable configured provider.
3. **Voice:** choose text-to-speech and, optionally, download offline speech
   recognition. Downloads start only when you choose them and can continue after
   setup. **Finish** opens Annie's chat; fresh installations also include Caitlyn.

You can change models in **App Settings → Models** and voice options in **App
Settings → Voice**. Desktop provider keys are encrypted with the operating
system's secure storage and are never read back into the browser.

## Chat and optional speech

There is no bundled offline chat model. A remote provider needs Internet access
and can charge for usage. For local chat, start your model server, load a model
and test its connection in Models; desktop uses `127.0.0.1` on the server's port.

Offline dictation and Voice Mode need the optional speech recognition download
from setup or **App Settings → Voice**. Text-to-speech and microphone permission
do not require that download. Allow Animama to use the microphone when prompted.
An offline speech model does not make remote AI chat work offline.

## Keep your data

Data lives separately from the app at `~/Library/Application Support/Animama` on
macOS and `%LOCALAPPDATA%\Animama` on Windows. It includes history, Local content,
uploads, logs and the encrypted vault. Reinstalling the app is not a reset.

Read [Backups and recovery](./troubleshooting.md#backups-and-recovery) before
restoring, downgrading or deleting data.
