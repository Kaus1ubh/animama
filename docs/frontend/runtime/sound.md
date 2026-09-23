# Sound Runtime Guide

The frontend sound runtime owns non-voice BGM and SFX playback. Live Anima
routes select audio exclusively from the mounted `AnimaRuntimeCatalog`; stable
runtime IDs are the public control surface, while URLs remain an internal
delivery detail. TTS orchestration and voice catalogs remain outside the typed
Sound Effect and Music Track catalogs.

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

`/a/music-tracks/new` creates typed Music Tracks with one long-form audio file,
while the Anima Loadout owns enabled, autoplay, loop, and gain choices for selected
Music Tracks.
Gesture and Reaction Preview resolves direct Sound aliases and sounds associated
with Avatar/Scene/Particle Effects as part of one exact closure.

Gesture and Reaction creators select exact Sound revisions from the typed
catalog rather than borrowing the preview Anima's mounted SFX catalog. Preview
resolves the Sound automatically and never equips it as a peer resource.

## Main Files

- `web/src/lib/sound/SoundController.ts` owns low-level audio elements, gains,
  playback limits, and the UI-facing snapshot.
- `web/src/lib/sound/audio-prefs.ts` stores versioned browser-local mute,
  volume, and per-Anima BGM selection preferences.
- `web/src/lib/sound/shared-runtime.ts` keeps the controller stable across
  provider remounts without restoring route playback.
- `web/src/ui/sound/SoundProvider.tsx` mounts an Anima media catalog, resolves
  runtime IDs, decodes prepared media when needed, and exposes React controls.
- `web/src/ui/sound/SoundControls.tsx` renders BGM selection/transport and the
  shared mute/volume controls.
- `web/src/ui/main/canvas/AvatarCanvasActor.tsx` forwards pose/reaction and
  VFX-owned SFX runtime IDs to the mounted provider.

The app-wide `SoundController` survives navigation for stable volume state, but
audio resources belong to the current Anima catalog. Replacing the catalog or
leaving the Anima route stops BGM and SFX started from that catalog. Music is
not resumed merely because it was playing on a different route.

## Mounted Audio Catalog

Every live SFX or BGM descriptor comes from the mounted typed runtime snapshot.
Gesture/Reaction closures supply `sfx` entries; enabled Music Track bindings
supply `bgm` entries. Included and Local audio bytes are verified through the application origin
by the mounted preparation session, then decoded from prepared Blob URLs.
A root and its sound dependencies are admitted together into one stable
catalog; pending audio is never fetched through an alternate path. An unknown,
unavailable, or unbound runtime ID fails locally; it never falls through to a
static sound catalog.

Live-facing APIs use runtime IDs:

- `playSfxCue(runtimeId, options?)` is asynchronous because resolving private
  audio may require decoding a prepared Blob. Pending cues are skipped without
  being queued for later playback.
- BGM selection and next-track behavior operate on mounted BGM descriptors.
- Low-level URL playback stays inside `SoundController` or a clearly explicit
  standalone editor/debug adapter.

Pose-clip SFX events and avatar-VFX on-apply cues use the same exact mounted
resolution. SFX is one-shot: a looping SFX binding is rejected because clip
events have no matching stop lifecycle. At most eight SFX instances may be
active and at most one BGM element may play.

## BGM Selection And Autoplay

On an Anima mount, the provider observes incremental catalog availability without
resetting resolved audio or restarting playback on each admission. It waits for
the autoplay entry to become ready, or for preparation to settle, before applying
initial selection. A track manually selected while preparing is preserved.
The provider uses the remembered runtime ID if that entry is still present.
Otherwise it selects the first deterministic mounted BGM entry.
If exactly one BGM binding has `autoplay=true`, it becomes current and playback
is attempted. Starter BGM entries do not autoplay.

If the browser blocks autoplay, the controller reports `blocked` and retries
after user activation. A route change does not carry playback intent into the
next Anima. BGM descriptor volume and looping are combined with the user's
global BGM controls.

## Browser-Local Preferences

Preferences use the `audioPrefs` local-storage key and version-2 data:

```json
{
  "version": 2,
  "bgmMuted": false,
  "sfxMuted": false,
  "ttsMuted": false,
  "bgmVolume": 0.3,
  "sfxVolume": 0.5,
  "ttsVolume": 0.5,
  "selectedBgmRuntimeIdByAnimaId": {
    "anima-id": "calm-theme"
  }
}
```

The selection map is bounded to 100 Animas. Migrating an older payload retains
valid mute and volume settings but discards its obsolete raw BGM URL and
persisted playback intent. `masterMuted` remains session-only.

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
provider. Live `/a/{animaId}` routes must always mount the owner-authorized
catalog.
