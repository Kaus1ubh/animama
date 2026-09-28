# Desktop feature packs

Feature packs add optional local capabilities. The installation owner remains
the same when a pack is installed, removed or reinstalled. No online Animama
account is required. **No production pack release is available.** The producer emits catalog entries
only for active, approved exact inputs, with URLs in the release folder of the
distribution selected at build time (see [Distribution selection](releases.md#distribution-selection)).
The app downloads only from that distribution; a destination that is not yet
publicly served cannot deliver packs.

## What each pack adds

| Name in Settings                     | Catalog ID                  | Behavior without it                                                                                                                  |
| ------------------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Offline speech recognition           | `parakeet-stt`              | Dictation and Voice Mode are unavailable. Text chat, avatars, PocketTTS and microphone permission do not depend on it.               |
| GPU speech encoder                   | `parakeet-stt-webgpu`       | Offline speech runs on the CPU without live previews. Requires `parakeet-stt`, which cannot be removed while this pack is installed. |
| Expanded Included content (deferred) | `expanded-included-content` | Not offered in the first release. Both core starters retain their required content.                                                  |
| Document processing (deferred)       | `document-processing`       | Not offered in the first release. Originals can still be uploaded and stored; new extraction/indexing requests remain unavailable.   |

The GPU speech encoder is offered only beside App Settings → Voice →
Speech-to-Text → Provider for **Parakeet (WebGPU · Experimental)**, after the
renderer finds a WebGPU adapter. The general pack list shows it only when its
files remain installed, for removal or recovery. If the encoder was left inactive
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

Open Settings in the main window and find **Optional feature packs**. Inspect
the listed download size, installed size and required free space, then select
**Install**. First-run setup can also request offline speech recognition;
the checkbox starts unchecked. Leave it unchecked when continuing with your
required display name to enter the app without a pack download.

Sizes come from the app's exact compatible catalog. Required free space includes
temporary installation work, not just the final files. **No compatible released
pack** means there is no approved input for this app version; changing an account
or pasting a download URL will not fix it. Never use a development size estimate
as the size of a released download.

Save unfinished edits and finish active work first. Activation/removal closes
the product windows while services switch packs, then reopens the main app at
its previous route. Independent recovery remains available throughout.
Your database, owner and saved local origin are preserved. The app verifies
size, hashes and every extracted file before activating anything. Document
workers also require the pinned publisher signature on every launch.

**Cancel** stops a download. A verified partial archive may be reused when you
select Install again, including after quitting and reopening. A failed install
keeps the previous working version. Network errors such as `pack_download_failed`
are retryable after connectivity recovers; never edit the catalog or disable
verification to accept different bytes.

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
