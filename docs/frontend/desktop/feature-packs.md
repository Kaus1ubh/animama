# Desktop feature packs

Feature packs add optional local capabilities. The installation owner remains
the same when a pack is installed, removed or reinstalled. No online Animama
account is required. **No production pack release is available.** The producer emits
catalog entries only for active, approved exact inputs. Parakeet packs download
verified raw files and notices from `downloads.animama.ai/models/`, independently
of the app's update distribution. Other packs retain their archive delivery from
the [selected distribution](releases.md#distribution-selection). Every destination
must serve its pinned objects publicly before a download can succeed.

## What each pack adds

| Name in Settings                     | Catalog ID                  | Behavior without it                                                                                                                  |
| ------------------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Offline speech recognition           | `parakeet-stt`              | Dictation and Voice Mode are unavailable. Text chat, avatars, PocketTTS and microphone permission do not depend on it.               |
| GPU speech encoder                   | `parakeet-stt-webgpu`       | Offline speech runs on the CPU without live previews. Requires `parakeet-stt`, which cannot be removed while this pack is installed. |
| Expanded Included content (deferred) | `expanded-included-content` | Not offered in the first release. Both core starters retain their required content.                                                  |
| Document processing (deferred)       | `document-processing`       | Not offered in the first release. Originals can still be uploaded and stored; new extraction/indexing requests remain unavailable.   |

The GPU enhancement appears in setup and App Settings → Voice → Speech-to-Text,
independently of the selected provider, when the renderer finds a WebGPU adapter
and the app has a compatible approved catalog entry. Install CPU speech first;
the GPU action never installs it automatically. Retained GPU files remain
removable on unsupported devices. If the encoder was left inactive
because offline speech was missing at startup, reinstall offline speech, then
select Retry: its retained, verified files are reactivated without downloading.

The expanded-content and document-processing packs are deferred from the
initial catalog and hidden in Settings on a fresh installation. If old pack files remain,
recovery/removal controls stay visible.
When released, the expanded pack makes content selectable; it never equips an Anima
automatically. Its read-only Included entries are not user-owned Local files.
When released, the document pack contains an independently signed worker. The
other packs are data only; none lets the renderer execute a downloaded command.

## Install and retry

Setup and App Settings → Voice offer direct optional download controls. The
Speech-to-Text section contains CPU speech and its separate GPU enhancement;
Text-to-Speech contains the Pocket voice picker and voice cloning download.
Eve and Azelma are included. The other 36 voices download individually, and
cloning needs its separate encoder. Downloading changes neither provider nor
selected voice. Previewing a source sample also leaves selection unchanged.
Setup permits skipping every download, and Continue remains available while
downloads run; native activation restores the saved setup details after reload.
Deferred content/document packs remain in the
general recovery list only when retained files need attention.

Sizes come from the app's exact compatible catalog. Required free space includes
temporary installation work, not just the final files. **No compatible released
pack** means there is no approved input for this app version; changing an account
or pasting a download URL will not fix it. Never use a development size estimate
as the size of a released download.

Save or discard unfinished provider-key edits and finish active work first.
Setup retains the owner-scoped display name and age confirmation across reloads,
but never persists provider-key drafts. Activation/removal closes
the product windows while services switch packs, then reopens the main app at
its previous route. Independent recovery remains available throughout.
Your database, owner and saved local origin are preserved. The app verifies
every required file's size and hash, including notices, before activating anything. Document
workers also require the pinned publisher signature on every launch.

**Cancel** stops a download. Desktop Parakeet downloads retain resumable progress
at verified file boundaries; another attempt rechecks those files and safely
resumes supported partial transfers. Archive packs retain their separate resume
path. A failed install
keeps the previous working version. Network errors such as `pack_download_failed`
are retryable after connectivity recovers; never edit the catalog or disable
verification to accept different bytes.

Pocket voices and the cloning encoder use the backend downloader. Cancel or a
service restart discards incomplete bytes, and **Retry** starts again. Closing
the cloning dialog detaches that operation without cancelling a shared download;
explicit Cancel stops it. Removing the encoder preserves saved clones and their
original recordings, but creating another clone requires downloading it again.

## Remove safely

Select **Remove**, then **Confirm removal**. A pack cannot be removed while an
Anima references its content, a preview/runtime lease remains valid, content
work is active, or a document job is running. Settings lists affected content.
Choose different content or remove the relevant optional selection, close
previews and let outstanding leases expire, then retry. Do not delete pack
directories by hand to bypass these checks.

The GPU speech encoder depends on offline speech recognition: remove the
encoder first (`pack_dependent_installed`), and install offline speech before
the encoder (`pack_dependency_missing`). Removing Parakeet disables its
dictation path. Removing the document pack keeps
originals and queued jobs; they can resume after reinstalling a compatible
worker. Removing expanded content withdraws its catalog entries. Local creations
and unrelated content are not deleted. `pack_cleanup_pending` means a pack is
inactive but some files could not be removed; close applications using those
files and retry Remove.

## Offline use and app upgrades

Installed Parakeet models are delivered through the installation-owned FastAPI listener and
can work offline. Document-worker models/tokenizers are packaged rather than
downloaded on demand. Processing stages that use a configured remote provider
still need that provider. Remote chat/voice services need their own connectivity.

Pack versions are bound to compatible app versions. Use **Install compatible
version** when offered. An app update that would strand referenced expanded
content is blocked; resolve those references or wait for an approved compatible
release. Never rename an old pack or change its manifest to impersonate a new one.

For errors, see [Troubleshooting](troubleshooting.md). Maintainers should use
[Runtime staging](runtime-staging.md) for producers and inventory approvals,
and [Release process](release-process.md) for the separate publication gates.
