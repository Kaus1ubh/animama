# Install and use Animama Desktop

**No signed public release is available.** This guide describes the implemented
desktop flow and the intended installer. Fresh-source staging, complete starter
inputs, signed/native tests and publication approval remain pending. Local
signed candidates can be transferred privately after signing and input review.
Developers should use [Platform builds](platforms.md).

## Supported target

| Platform                                     | Current position                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Apple silicon Mac, macOS 15 or later         | Declared minimum; fresh build, macOS 15 testing, clean-machine and signed acceptance remain open. |
| Windows 11 x64                               | Deferred; no supported self-contained installer yet.                                              |
| Intel Mac, universal Mac, Windows ARM, Linux | No supported self-contained release.                                                              |

The installed app contains its own local services and database. It does not
require Docker, Python, Node.js, PostgreSQL, Homebrew or a source checkout.

## First launch, once an approved installer is available

1. Download the macOS arm64 DMG from the announced Animama release page. Use its
   release notes and checksums; do not substitute an unsigned development bundle.
2. Open the DMG, copy **Animama.app** to Applications, and open it through Finder.
   If macOS reports a damaged or unverified app, stop and use
   [Troubleshooting](troubleshooting.md). Do not disable Gatekeeper or strip quarantine.
3. Let Animama prepare its private database. No local account, password or hosted
   Animama account is required. One internal installation owner is generated
   automatically and retained across restarts.
4. Enter what Animama should call you. A nonblank name is required; it is
   private personalization, not a username or credential.
5. Provider keys and **Install offline speech recognition** are optional during
   setup. Leave the speech checkbox unchecked to avoid downloading Parakeet.
   Choose **Continue** to open Annie's chat; configure optional features in
   Settings later if preferred. Later launches open the last Anima you visited,
   or the first available Anima if that Anima has been deleted.

Fresh installations create Annie and Caitlyn. Starter defaults do not overwrite
existing Animas or restore a deliberately deleted starter.

## Provider keys and speech

Embedded desktop setup and Settings offer OpenAI, DeepSeek, Hugging Face, Gemini
and ElevenLabs key controls. Configure the provider required by the feature you
want to use; you do not need all five. Text chat through an external model
requires that provider to be configured and reachable and can incur its charges.
There is no bundled offline chat model.

Keys are encrypted using macOS secure storage and are never read back into the
browser. Saving or removing a key briefly restarts its local service consumers;
the database, saved origin and installation owner stay unchanged. Finish active
work before changing credentials. Never put a key in a URL or send it to support.

If local work prevents a change, the previous key stays unchanged. Reopen
Settings after recovery to see the provider's failure and retry the change.
The Settings dialog may close while services restart. If the key was saved but
services could not restart, runtime Retry uses that saved value; do not remove
the vault or re-enter the key merely to repair the restart.

PocketTTS and microphone permission do not require Parakeet. Offline dictation
and Voice Mode require the **Offline speech recognition** pack. Open the app
normally through Finder for microphone permission tests and allow Animama in
macOS Privacy & Security when prompted. See [Feature packs](feature-packs.md)
and [Microphone troubleshooting](troubleshooting.md#microphone-and-speech).

## Local storage and offline use

Your data lives at `~/Library/Application Support/Animama`, separately from
`Animama.app`. It includes the private database, encrypted vault, Local content,
uploads, logs and installed packs. Included content in the app is read-only;
content you create/import belongs in the writable Local library. The app uses
private loopback services and is not a shared LAN application.

Local content, history and installed local speech assets remain on the computer.
Downloading a pack or app update needs Internet access, as do configured remote
AI/voice providers. Installed Parakeet can transcribe offline; that does not make
remote chat work offline. Desktop does not need an Animama account for local use.

Starter portraits and speech-engine assets are included; your own Local media
can be imported. Complete starter animation acquisition remains a release gate. See
[Content policy](../../../content/included/README.md).

## Updates, backup and removal

A configured release checks for updates without blocking startup. Settings →
General offers **Check for updates**. **Download update** and **Restart to
install** are separate decisions; ordinary Quit never installs an update.
Current unconfigured development builds do not have a working update feed.
An update can refuse to proceed while a pack is busy or in-use content would
become unavailable. Keep using the current version until the issue is resolved.

Replacing or removing the application bundle does not erase your local data.
Reinstalling is not a reset. Quit Animama before a coordinated backup of the
whole data tree; database migration snapshots alone do not include your files
or vault. Secure-storage recovery can require the original macOS login keychain,
so copying the directory is not a guaranteed cross-machine migration.

See [Backup and recovery](troubleshooting.md#backups-and-recovery) before
restoring, downgrading or deleting anything. There is no supported one-click
desktop full-reset or cross-device migration flow available.
