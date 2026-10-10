# Effect folder

A Particle Effect source is one folder: the descriptor `<stem>/<stem>.json`,
the three.quarks manifest it names (`particle.json`) and the PNG textures the
manifest's images use (`textures/<name>.png`). `effects check`,
`effects:render`, `animation:preview`, `effects save` and `effects promote`
all take the folder.

```text
.animama-drafts/effects/twinkle-shimmer/
  twinkle-shimmer.json
  particle.json
  textures/shimmer-glint.png
  textures/soft-bokeh.png
```

## Start from something that works

Writing Quarks JSON from nothing is slow and error-prone. Start from:

- **the closest Included effect:** copy
  `content/included/vfx/particle/quark/<stem>/` into
  `.animama-drafts/effects/`, rename the descriptor to the new stem, and drop
  its `content_id` and `version` (Library metadata a draft leaves out); or
- **the creator:** build it in `/particle-effects/new` by hand, open Export,
  copy the *Creator document*, and write it out as a folder (its `quarks` is
  `particle.json`, its `settings` the `runtime_defaults.slots.particle_vfx`
  below); textures you imported must be copied in as files.

Then change emitters, textures and settings to match the brief. A small
script that writes the manifest from an Included emitter's structure is
fine. Read [three.quarks mechanics](three-quarks.md) for what each field
does. The example values below show the shape, not a tuned effect.

## Descriptor

```json
{
  "schema_version": 1,
  "content_type": "particle_effect",
  "name": "Twinkle Shimmer",
  "description": "A few glossy glints twinkle in and out among soft bokeh around the head, for admiring and grateful moments.",
  "runtime_defaults": {
    "schema_version": 1,
    "runtime_id": "twinkle-shimmer",
    "slots": {
      "particle_vfx": {
        "label": "Twinkle Shimmer",
        "description": "Glossy glints twinkling among soft bokeh.",
        "anchor": "head",
        "duration_seconds": 1.2,
        "max_duration_seconds": 3,
        "preload_tier": "none",
        "follow_anchor": true,
        "transform": {
          "offset": { "x": 0, "y": 0.12, "z": 0 },
          "depth_offset": 0.1,
          "rotation": { "x": 0, "y": 0, "z": 0 },
          "scale": { "x": 1, "y": 1, "z": 1 }
        },
        "looping_allowed": false,
        "can_coexist": true,
        "max_particles": 48
      }
    }
  },
  "files": [
    { "path": "particle.json", "role": "manifest" },
    { "path": "textures/shimmer-glint.png", "role": "texture" },
    { "path": "textures/soft-bokeh.png", "role": "texture" }
  ]
}
```

- **name**: Local names use letters, digits, spaces, `.`, `_` and `-`,
  starting with a letter or digit. The saved Local folder is the lowercased
  name with spaces and `_` as `-` (`Twinkle Shimmer` → `vfx/particle/twinkle-shimmer/`).
  The description is what the Library and chat selection read.
- **runtime_id**: Save replaces it with the creator's default
  (`custom-particle-vfx`); promotion sets the stem. Do not rely on it.
- **anchor**: `root`, `hips`, `spine`, `chest`, `neck`, `head`, `leftHand`,
  `rightHand`, `leftFoot` or `rightFoot`. `transform.offset` is in metres from
  it; `depth_offset` moves the effect toward the camera (Included head
  effects use 0.08–0.16 m to sit in front of the face);
  `follow_anchor: false` leaves particles where they were born.
- **duration_seconds** is how long one playback lasts;
  `max_duration_seconds` (at most 30) bounds it and every emitter cycle.
  `looping_allowed` lets emitters loop inside that lifetime.
- **max_particles** is the declared budget: at most 512, and at least Save's
  estimate (`effects check` prints it).
- **files**: the manifest, then each texture the manifest's images use. A
  listed texture nothing uses is refused by `effects save`.

## Manifest (`particle.json`)

A three.quarks object: `images`, `textures`, `materials`, `geometries` and an
`object` Group whose `children` are `ParticleEmitter` nodes (one to eight).
The chain from an emitter to its art is `ps.material` → material `map` →
texture `image` → image `url`. Fields you usually change, in each emitter's
`ps`:

| Field | Meaning |
| --- | --- |
| `duration`, `looping` | the emitter's cycle in seconds; loop within the effect's lifetime |
| `emissionOverTime`, `emissionBursts` | a steady rate, and bursts (`time`, `count`, `cycle`, `interval`, `probability`) |
| `startLife`, `startSpeed`, `startSize`, `startRotation`, `startColor` | per-particle starting values (`ConstantValue`, `IntervalValue` ranges) |
| `shape` | where particles are born and which way they start: `point` and `sphere` emit in every direction, depth included; `cone` along its axis (toward the camera unrotated); `rectangle` within its plane, which keeps a spray flat to the view |
| `behaviors` | `ForceOverLife` (gravity, drift), `SizeOverLife`, `ColorOverLife` (fades), `RotationOverLife`, `FrameOverLife` (sprite sheets), `OrbitOverLife`, `Noise` |
| `uTileCount`, `vTileCount`, `startTileIndex` | sprite sheet grid (at most 16 each) and first frame |
| `renderMode`, material `blending` | billboard (`0`) or stretched billboard, which turns the texture's horizontal axis along the velocity with its left edge leading (draw streaks and drops lying horizontally, and confirm the direction in a render); its length is about size × (`speedFactor` × speed + `lengthFactor`) from `rendererEmitterSettings`, both 0 when absent, so always set them (Included streaks use `speedFactor` 0.02–0.04 and `lengthFactor` 1.75–2.1); additive glow (`2`) or normal (`1`) |
| `worldSpace` | particles stay where they were born instead of moving with the anchor |

Behaviours act on different things: Speed Over Life scales only the position
update, while gravity (Force Over Life) and a stretched sprite's length still
follow the full velocity. Included manifests leave each texture's
`colorSpace` empty, so colours render paler than the PNG; tint with
`startColor` or Color Over Life rather than over-saturating the art.

Texture URLs are relative paths: `textures/<name>.png` for the effect's own
PNGs. A URL that names one of the creator's built-in textures (the files in
`content/included/vfx/particle/particle-vfx/textures/`, such as
`textures/heart.png`) draws the creator's copy, which Save packages as a file.
So never give your own art a built-in's name: `effects check` fails it and
`effects save` refuses it (Save would keep the built-in art). Prefer the
effect's own art for new effects, under names of its own
(`textures/glossy-heart.png`), and keep a built-in only when the brief reuses
one deliberately.

What the creator saves as written (other forms block Save): Size Over Life as
a multi-part curve; Speed Over Life and Rotation Over Life as a constant, a
range or the creator's straight-line form; Color Over Life with its colour and
alpha keys at the same positions (the creator merges them). A burst fires only
when its `time` falls inside its emitter's cycle (`duration`). A sphere's
`arc` of π (half a turn) emits from its upper half only, which keeps a spray
off the face.

Sizing: the art budget's 512 px is a ceiling; 256 px is plenty for small
sparkles and beads, and a stretched sprite keeps its own proportions (`fix
--trim --pad 8` without `--square`). Declare `max_particles` close to the
estimate: the check fails a budget below it but does not flag one far above
it.

## Rules that `effects check` and Save enforce

- one to eight emitters; at most 16 textures, each a PNG within 4 MiB and
  2048 px (`particle-texture` budget for a sprite, `particle-sheet` when an
  emitter tiles it; a sheet's grid at most 16 × 16);
- every image URL resolves to a listed texture or a built-in one;
- the estimate (each emitter's maximum rate over its duration plus all its
  bursts, a looping emitter over the longest emitter's duration) fits the
  declared budget, and the budget fits 512;
- durations fit `max_duration_seconds` (at most 30 s);
- own textures are not named like a built-in creator texture.

`effects promote` also requires texture paths of plain names at most one
folder deep (`textures/<name>.png`).
