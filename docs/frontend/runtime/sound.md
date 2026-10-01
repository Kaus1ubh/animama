# Sound Runtime Guide

The frontend sound runtime owns Sound Effect playback. Live Anima
routes select audio exclusively from the mounted `AnimaRuntimeCatalog`; stable
runtime IDs are the public control surface, while URLs remain an internal
delivery detail. TTS orchestration and voice catalogs remain outside the typed
Sound Effect catalog.

Gesture and Reaction SFX tabs and Avatar/Scene FX sound pickers upload reusable
Local Sounds from WAV, MP3 or Ogg files. Each file saves independently with its own
retry identity; successful uploads remain in Library when an action draft is
discarded. Uploading never inserts a timeline event. SFX rows separate Play/Stop
from Add to timeline, and picker audio stops on tab/route changes or timeline play.
Library Sounds provides preview, rename, same-format audio replacement and guarded
delete. Old Sound creator URLs redirect to Library. Sounds remain typed catalog
components with stable identities and revision checks, not direct Anima loadouts.

Avatar/Scene timeline events may set `playAccompanyingSound: false` to suppress
only that occurrence's attached sound. Omission means enabled for existing events.
The visual effect and exact sound dependency closure remain intact; independent
SFX events are unaffected. The existing event panel shows the sound name and toggle,
and the timeline shows a speaker only when the effect has accompanying sound.

Gesture and Reaction Preview resolves direct Sound aliases and sounds associated
with Avatar/Scene/Particle Effects as part of one exact closure.

Gesture and Reaction creators select exact Sound revisions from the typed
catalog rather than borrowing the preview Anima's mounted SFX catalog. Preview
resolves the Sound automatically and never equips it as a peer resource.

## Main Files

- `web/src/lib/sound/SoundController.ts` owns low-level audio elements, gains,
  playback limits, and the UI-facing snapshot.
- `web/src/lib/sound/audio-prefs.ts` stores versioned browser-local mute,
  volume preferences for TTS and SFX.
- `web/src/lib/sound/shared-runtime.ts` keeps the controller stable across
  provider remounts without restoring route playback.
- `web/src/ui/sound/SoundProvider.tsx` mounts an Anima media catalog, resolves
  runtime IDs, decodes prepared media when needed, and exposes React controls.
- `web/src/ui/sound/SoundControls.tsx` renders master mute and TTS/SFX mute/volume controls.
- `web/src/ui/main/canvas/AvatarCanvasActor.tsx` forwards pose/reaction and
  VFX-owned SFX runtime IDs to the mounted provider.

The app-wide `SoundController` survives navigation for stable volume state, but
audio resources belong to the current Anima catalog. Replacing the catalog or
leaving the Anima route stops SFX started from that catalog. TTS keeps its
separate run-owned playback lifecycle.

## Mounted Audio Catalog

Every live SFX descriptor comes from the mounted typed runtime snapshot.
Gesture/Reaction closures supply `sfx` entries. Included and Local audio bytes
are verified through the application origin
by the mounted preparation session, then decoded from prepared Blob URLs.
A root and its sound dependencies are admitted together into one stable
catalog; pending audio is never fetched through an alternate path. An unknown,
unavailable, or unbound runtime ID fails locally; it never falls through to a
static sound catalog.

Live-facing APIs use runtime IDs:

- `playSfxCue(runtimeId, options?)` is asynchronous because resolving private
  audio may require decoding a prepared Blob. Pending cues are skipped without
  being queued for later playback.
- Low-level URL playback stays inside `SoundController` or a clearly explicit
  standalone editor/debug adapter.

Pose-clip SFX events and avatar-VFX on-apply cues use the same exact mounted
resolution. SFX is one-shot: a looping SFX binding is rejected because clip
events have no matching stop lifecycle. At most eight SFX instances may be
active. Finite idle/preview occurrences carry an abort signal so completion or
interruption cancels both pending delivery and active owned SFX without stopping
unrelated audio.

## Browser-Local Preferences

Preferences use the `audioPrefs` local-storage key and version-3 data:

```json
{
  "version": 3,
  "sfxMuted": false,
  "ttsMuted": false,
  "sfxVolume": 0.5,
  "ttsVolume": 0.5
}
```

Older payloads retain valid TTS/SFX mute and volume settings. Retired Music
selection, autoplay and gain fields are discarded. `masterMuted` remains
session-only. Retired audio source files remain preserved on disk and are not
reclassified as Sound Effects.

TTS volume and mute share the preference panel but not typed-content playback
ownership. Browser speech uses the normalized volume directly; Pocket TTS uses
its calibrated gain bridge.

## Resource Safety And Cleanup

The mounted media provider allows at most two concurrent private fetches and
128 MiB of resident private media Blob data. Response bodies are read with
declared-size and hard-limit enforcement. Catalog disposal aborts active
requests, rejects queued requests, stops catalog-owned playback, and revokes
every owned Blob URL. Safe diagnostics report reason codes and counts without
runtime IDs, filenames, Anima IDs, content identifiers, object keys, or signed
URLs.

Standalone editors and debug tools may opt into the explicitly named built-in
provider. Live `/{animaId}` routes must always mount the owner-authorized
catalog.
