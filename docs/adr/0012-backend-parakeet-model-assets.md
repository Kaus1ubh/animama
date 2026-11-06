# 0012: Parakeet speech models as backend model assets

- Status: accepted; amended on 2026-11-04 (downloads end, below)
- Recorded: 2026-10-01
- Retrospective: no
- Original decision date: 2026-10-01 (owner decisions in issue #221)
- Decision basis: owner decisions recorded in [issue #221](https://github.com/raymond-van/animama/issues/221)
  and its 2026-10-01 amendment; implementation choices in the
  [execution plan](../plans/parakeet-backend-downloader/parakeet-backend-downloader-execplan.md)
- Supersedes: [ADR 0010](0010-shared-model-object-distribution.md) item 2, the
  Parakeet clause of item 8, the built self-host part of item 3, and the
  setup-draft and provider-gated GPU parts of item 9

## Context

ADR 0010 kept a desktop feature pack as the installation and activation unit for
the base (`parakeet-stt`) and WebGPU (`parakeet-stt-webgpu`) Parakeet sets.
Electron passes each active pack to FastAPI as startup environment
(`ANIMAMA_PARAKEET_*_MODEL_MOUNT_JSON`, `ANIMAMA_PARAKEET_STT_ENABLED` and asset
versions). Every install or removal therefore quiesces FastAPI, restarts it and
destroys every product window. The model runs in the browser; FastAPI only
serves its files.

Built self-host serves the base set from an operator bind into the web root and
downloads only the WebGPU encoder through the backend model-asset service
(`/v1/model-assets`). That service already installs Pocket voices and the Mimi
cloning encoder in place on desktop and self-host. After #219, API keys also
apply without a restart, so pack transitions are the last ordinary restart in
setup and Voice settings.

## Decision

1. Install both Parakeet sets through the backend model-asset service on
   packaged desktop and built self-host. A set is one catalog entry listing the
   files of its tracked model manifest, including README and attribution
   notices. It is downloaded from the shared objects at
   `downloads.animama.ai/models/`, verified file by file, and activated as a
   whole. A partial set is never available.
2. Resume interrupted transfers from verified bytes with HTTP range requests
   against the same immutable objects.
3. Derive offline speech availability and asset versions from the installed
   asset store on each request, not from startup environment. FastAPI serves
   installed sets from the data-root store at the existing
   `/onnx/models/<model-id>/` paths, versioned by manifest digest.
4. Refuse removal while a renderer holds a short-lived use lease on a set, and
   refuse removal of the base set while the WebGPU set is installed.
5. Remove the Parakeet packs from the pack catalog, release inputs, producer
   and supervisor environment. Keep the pack manager, archive transport,
   signing and custody for `expanded-included-content` and
   `document-processing`.
6. The development Compose stack keeps operator acquisition
   (`scripts/models/parakeet.py`) and the `reset.sh` host mount; ADR 0010 item 3
   continues to apply there.
7. Show the GPU set as an add-on beneath the base model whenever offline speech
   downloads are offered, with a disabled action and a stated reason when it
   cannot be installed, instead of following the selected provider.

ADR 0010's shared object origin, pinned manifests, hash verification, immutable
publication, release-time publication of missing objects, Pocket voice bundling
and Mimi delivery are unchanged.

## Alternatives and consequences

- Keeping the packs and only shortening the restart keeps Electron as a second
  installer for files the backend already serves. Every desktop transition would
  still interrupt chat, audio and open windows.
- A live mount-reload channel from Electron to FastAPI would remove the restart
  but keep two installers and two activation models. A single backend lifecycle
  also serves built self-host.
- The backend downloader gains multi-file sets, range resume and use leases.
  Those capabilities now belong to the model-asset service, not the pack
  manager.
- The model-pack format becomes unused and is removed. Archive packs keep their
  transport. No installed-pack migration is provided: no desktop release has
  been accepted, so this is a direct development cutover.
- Built self-host's single-file WebGPU encoder entry is replaced by the WebGPU
  set. An encoder downloaded under the old entry is removed and must be
  downloaded again.
- Development and built compositions keep different serving paths for the base
  set: a host mount in development and the asset store in built compositions.

## Amendment (2026-11-04): downloads end

Animama's prebuilt distribution ends before 2027-01-01 (owner decision D5 of the
[open-source readiness plan](../plans/open-source-readiness/open-source-readiness-execplan.md);
[issue #837](https://github.com/raymond-van/animama/issues/837), refined by
[#859](https://github.com/raymond-van/animama/issues/859)). The local
composition keeps downloading until the final release, which turns downloads
off (`MODEL_DOWNLOADS_OFFERED` in `src/backend/animama/server/model_assets.py`):
installing an asset that is not installed is then refused with
`model_downloads_ended`, while assets installed earlier keep working and can be
removed. The objects on `downloads.animama.ai` stay published only for a short
transition after the final desktop release. The catalog and downloader are
unchanged.

## Evidence

- [Issue #221](https://github.com/raymond-van/animama/issues/221): requirements
  and owner decisions.
- [Execution plan](../plans/parakeet-backend-downloader/parakeet-backend-downloader-execplan.md):
  implementation, verification and remaining acceptance gates.
- [Base manifest](../../models/parakeet-tdt-0.6b-v2/manifest.json) and
  [WebGPU manifest](../../models/parakeet-tdt-0.6b-v2-webgpu/manifest.json).
- [Model-asset operations](../backend/operations/model-assets.md).
