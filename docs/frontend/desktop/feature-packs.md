# Desktop feature packs

Feature packs add optional local capabilities that need Electron's pack
manager: a verified archive, an atomic version switch and a service restart.
The installation owner remains the same when a pack is installed, removed or
reinstalled. No online Animama account is required. **No pack has been
released, and none will be:** both current packs are deferred, and the final
release's `"updates": "ended"` policy forbids an active pack. The producer emits
catalog entries only for active, approved exact inputs. Archive packs download from
the [selected distribution](releases.md#distribution-selection), which must
serve its pinned objects publicly before a download can succeed.

Offline speech recognition (Parakeet and SenseVoice-Small), the downloadable
Pocket voices and the voice-cloning encoder are not packs. The backend kept
them in place, without restarting services or reloading windows, and no longer
downloads new ones; see [Speech model downloads](#speech-model-downloads).

## What each pack adds

| Name in Settings                     | Catalog ID                  | Behavior without it                                                                                                                |
| ------------------------------------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Expanded Included content (deferred) | `expanded-included-content` | Not offered in the first release. Both core starters retain their required content.                                                |
| Document processing (deferred)       | `document-processing`       | Not offered in the first release. Originals can still be uploaded and stored; new extraction/indexing requests remain unavailable. |

The non-portable [Mixamo-motion pack](../../backend/operations/mixamo-motion-pack.md)
and [comedy sound pack](../../backend/operations/comedy-sound-pack.md) are not
feature packs: feature packs are public downloads, so they are bundled in the
audited runtime instead and never offered in Settings.

Both packs are deferred from the initial catalog and hidden in Settings on a
fresh installation. If old pack files remain, recovery/removal controls stay
visible in the general recovery list.
When released, the expanded pack makes content selectable; it never equips an Anima
automatically. Its read-only Included entries are not user-owned Local files.
When released, the document pack contains an independently signed worker. The
expanded pack is data only; no pack lets the renderer execute a downloaded command.

Startup deletes the directories and partial downloads of the retired
`parakeet-stt` and `parakeet-stt-webgpu` speech packs. Install offline speech
again from the Voice settings described below.

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
every required file's size and hash, including notices, before activating anything. Document
workers also require the pinned publisher signature on every launch.

**Cancel** stops a download. Archive downloads resume from verified ETag/range
metadata. A failed install keeps the previous working version. Network errors
such as `pack_download_failed` are retryable after connectivity recovers; never
edit the catalog or disable verification to accept different bytes. A pack
change is refused while a model download runs, and a model download cannot
start during a pack change.

## Remove safely

Select **Remove**, then **Confirm removal**. A pack cannot be removed while an
Anima references its content, a preview/runtime lease remains valid, content
work is active, or a document job is running. Settings lists affected content.
Choose different content or remove the relevant optional selection, close
previews and let outstanding leases expire, then retry. Do not delete pack
directories by hand to bypass these checks.

Removing the document pack keeps
originals and queued jobs; they can resume after reinstalling a compatible
worker. Removing expanded content withdraws its catalog entries. Local creations
and unrelated content are not deleted. `pack_cleanup_pending` means a pack is
inactive but some files could not be removed; close applications using those
files and retry Remove.

## Speech model downloads

Animama no longer offers these downloads. Sets, voices and the encoder
installed earlier keep working and can be removed. Where a download was
offered, the app now says that downloads have ended and that chat, Avatars and
the built-in voices need none; dictation says a missing model can no longer be
downloaded.

App Settings → **Voice** → **Speech-to-Text** shows **Offline speech
recognition** with one section per model, under the languages it understands;
the model for the app's language comes first. Dictation and Voice Mode use the
model for the app's language, chosen when they start. Setup's Voice step and
the main chat's install hint show only that model; companion windows point to
main-window Settings.

| Languages                 | Set              | Model asset             | Size     |
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

The GPU add-on is always listed beneath the CPU model; retained GPU files stay
removable on unsupported devices. An installed set serves dictation offline
without a restart: FastAPI keeps running and no window reloads.

Eve, Azelma and Michael are included voices. The other 35 voices were
downloaded individually from the compact picker in Anima voice selection; one
that was never installed is shown as not available, and replies for an Anima
that uses it speak with the default voice. **Voice Clone** shows the cloning
encoder's state; App Settings reuses the Anima voice-cloning form under the
PocketTTS tab of Text-to-Speech. Previewing changes neither the provider nor
the selected voice.

The backend model-asset service checked every downloaded file's size and
SHA-256 and activated a set only when complete. Partial downloads left by an
earlier version are discarded at startup, since they can no longer resume.

To remove a model, select its **Remove GPU acceleration** (if installed),
then **Remove CPU model**, confirming each. A CPU model cannot be removed
while its GPU acceleration is installed. Removal is refused with "Speech
recognition is in use" while dictation or Voice Mode in another window still has
the model loaded. Stop them or close that window, then retry; an idle model
unloads after five minutes. A removed set cannot be installed again; never edit
installed files.
Removing the encoder preserves saved clones and their original recordings, but
no new clone can be made without it.

## Offline use and app upgrades

Installed speech models are served by the installation-owned FastAPI listener
from the app's data directory and work offline. Document-worker models/tokenizers are packaged rather than
downloaded on demand. Processing stages that use a configured remote provider
still need that provider. Remote chat/voice services need their own connectivity.

Pack versions are bound to compatible app versions. Use **Install compatible
version** when offered. An app update that would strand referenced expanded
content is blocked; resolve those references or wait for an approved compatible
release. Never rename an old pack or change its manifest to impersonate a new one.

For errors, see [Troubleshooting](troubleshooting.md). Maintainers should use
[Runtime staging](runtime-staging.md) for producers and inventory approvals,
and [Release process](release-process.md) for the separate publication gates.
