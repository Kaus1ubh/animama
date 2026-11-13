# Desktop feature packs

Feature packs add optional local content that needs Electron's pack
manager: a verified data-only archive, an atomic version switch and a service
restart. The installation owner remains the same when a pack is installed,
removed or reinstalled. No online Animama account is required. **No production
pack release is available.** The producer emits catalog entries only for active,
approved exact inputs, and the one current pack is deferred. A release policy that ends
updates, as the final release's does, forbids an active pack. Archive packs download from
the [selected distribution](releases.md#distribution-selection), which must
serve its pinned objects publicly before a download can succeed.

Offline speech recognition (Parakeet and SenseVoice-Small), the downloadable
Pocket voices and the voice-cloning encoder are not packs. The backend installs
them in place, without restarting services or reloading windows; see
[Speech model downloads](#speech-model-downloads). Uploaded files need no pack
either: the core app reads and indexes every accepted format itself (see
[User files](../../backend/features/user-files.md#in-server-processing)).

## What each pack adds

| Name in Settings                     | Catalog ID                  | Behavior without it                                                                 |
| ------------------------------------ | --------------------------- | ----------------------------------------------------------------------------------- |
| Expanded Included content (deferred) | `expanded-included-content` | Not offered in the first release. Both core starters retain their required content. |

The non-portable [Mixamo-motion pack](../../backend/operations/mixamo-motion-pack.md)
and [comedy sound pack](../../backend/operations/comedy-sound-pack.md) are not
feature packs: feature packs are public downloads, so they are bundled in the
audited runtime instead and never offered in Settings.

The expanded pack is deferred from the initial catalog and hidden in Settings on a
fresh installation. If old pack files remain, recovery/removal controls stay
visible in the general recovery list.
When released, the expanded pack makes content selectable; it never equips an Anima
automatically. Its read-only Included entries are not user-owned Local files.
Packs carry data only: the catalog accepts no platform build, signature or
executable file, and no pack lets the renderer execute a downloaded command.

Startup deletes the directories of retired packs: the `parakeet-stt` and
`parakeet-stt-webgpu` speech packs, with their partial downloads, and
`document-processing`, since the core app processes uploads itself. Install
offline speech again from the Voice settings described below.

## Install and retry

Sizes come from the app's exact compatible catalog. Required free space includes
temporary installation work, not just the final files. **No compatible released
pack** means there is no approved input for this app version; changing an account
or pasting a download URL will not fix it. Never use a development size estimate
as the size of a released download.

Save or discard unfinished provider-key edits and finish active work first.
Activation/removal closes
the product windows while services switch packs, then reopens the main app at
its previous route. Independent recovery remains available throughout.
Your database, owner and saved local origin are preserved. The app verifies
every required file's size and hash, including notices, before activating anything.

**Cancel** stops a download. Archive downloads resume from verified ETag/range
metadata. A failed install keeps the previous working version. Network errors
such as `pack_download_failed` are retryable after connectivity recovers; never
edit the catalog or disable verification to accept different bytes. A pack
change is refused while a model download runs, and a model download cannot
start during a pack change.

## Remove safely

Select **Remove**, then **Confirm removal**. A pack cannot be removed while an
Anima references its content, a preview/runtime lease remains valid or content
work is active. Settings lists affected content.
Choose different content or remove the relevant optional selection, close
previews and let outstanding leases expire, then retry. Do not delete pack
directories by hand to bypass these checks.

Removing expanded content withdraws its catalog entries. Local creations
and unrelated content are not deleted. `pack_cleanup_pending` means a pack is
inactive but some files could not be removed; close applications using those
files and retry Remove.

## Speech model downloads

The final release turns these downloads off: sets, voices and the encoder
installed earlier keep working and can be removed, the app says downloads have
ended where it offered one, and dictation says a missing model can no longer be
downloaded. Until then they work as described below.

App Settings → **Voice** → **Speech-to-Text** shows **Offline speech
recognition** with one section per model, under the languages it understands;
the model for the app's language comes first. Dictation and Voice Mode use the
model for the app's language, chosen when they start. Setup's Voice step and
the main chat's install hint offer only that model; companion windows point to
main-window Settings.

| Languages                 | Download         | Model asset             | Size     |
| ------------------------- | ---------------- | ----------------------- | -------- |
| English                   | CPU model        | `parakeet-stt`          | ~661 MB  |
| English                   | GPU acceleration | `parakeet-stt-webgpu`   | ~1.24 GB |
| Japanese, Korean, Chinese | CPU model        | `sensevoice-stt`        | ~240 MB  |
| Japanese, Korean, Chinese | GPU acceleration | `sensevoice-stt-webgpu` | ~938 MB  |

Without the CPU model for the app's language, offline dictation and Voice Mode
are unavailable in that language; text chat, avatars, PocketTTS and microphone
permission still work. Without GPU acceleration, recognition runs on the CPU
without live previews. With Traditional Chinese as the app's language,
recognition also understands Cantonese, and both are written in Traditional
characters.

The GPU add-on is always listed beneath the CPU model. Its action is disabled,
with the reason, until the CPU model is installed and the device has a WebGPU
adapter; retained GPU files stay removable on unsupported devices. Downloading
never selects a provider, and the GPU action never installs the CPU model.
Every download can be skipped. A finished install is available at once:
FastAPI keeps running, no window reloads and dictation works offline.

Eve, Azelma and Michael are included voices. The other 35 voices download individually
from the compact picker in Anima voice selection. **Voice Clone** contains the
cloning encoder download; App Settings reuses the Anima voice-cloning form
under the PocketTTS tab of Text-to-Speech. Downloading or previewing changes neither the
provider nor the selected voice.

These downloads use the backend model-asset service: every file is checked for
size and SHA-256, and a set activates only when complete. **Cancel download**
discards the incomplete bytes. An interrupted download (connection loss, app
quit or service restart) keeps its verified bytes, and **Retry download** asks
only for the rest. Closing the cloning dialog detaches that operation without
cancelling a shared download.

To remove a model, select its **Remove GPU acceleration** (if installed),
then **Remove CPU model**, confirming each. A CPU model cannot be removed
while its GPU acceleration is installed. Removal is refused with "Speech
recognition is in use" while dictation or Voice Mode in another window still has
the model loaded. Stop them or close that window, then retry; an idle model
unloads after five minutes. To reinstall, remove the set and download it again;
never edit installed files.
Removing the encoder preserves saved clones and their original recordings, but
creating another clone requires downloading it again.

## Offline use and app upgrades

Installed speech models are served by the installation-owned FastAPI listener
from the app's data directory and work offline. Uploaded files are read and
chunked offline, and nothing is downloaded for them; embedding uses the
configured Embeddings model, and without it files stay searchable by keyword.
Remote chat/voice services need their own connectivity.

Pack versions are bound to compatible app versions. Use **Install compatible
version** when offered. An app update that would strand referenced expanded
content is blocked; resolve those references or wait for an approved compatible
release. Never rename an old pack or change its manifest to impersonate a new one.

For errors, see [Troubleshooting](troubleshooting.md). Maintainers should use
[Runtime staging](runtime-staging.md) for producers and inventory approvals,
and [Release process](release-process.md) for the separate publication gates.
