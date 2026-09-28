# three.quarks mechanics

Read this for simulation, serialized effects, renderer behavior, and differences
between the library and Animama's creator. For controls, see [creator.md](creator.md).

## Ownership and update loop

`quarks.core` supplies particle data, shapes, generators, and behaviors.
`three.quarks` supplies `ParticleSystem`, `ParticleEmitter`, `QuarksLoader`, and
`BatchedRenderer` for Three.js. Animama uses these directly; it does not use the
separate `quarks.r3f` declarative API for its particle controller.

Each `ParticleSystem` owns simulation settings and an emitter Object3D. The
emitter must belong to a scene, and its system must be registered with a
`BatchedRenderer`. Call `batchRenderer.update(deltaSeconds)` in the render loop.
Simulation updates particles on the CPU; compatible systems share rendering
batches and instanced buffers. Different textures, render modes, geometry, or
other pipeline settings can split batches. Batching does not make particle
simulation, transparency overdraw, or long trails free.

In 0.17.1, the simulation clamps one update's delta to 0.1 seconds. Animama's
instance timer and the creator's timeline have their own clocks, so a stalled tab
can advance the playback window farther than the simulation.

## Emission and the three clocks

| Setting | Meaning |
| --- | --- |
| `duration`, `looping` | Emitter cycle and whether emission starts another cycle |
| `startLife` | Lifetime of each spawned particle, independent of the cycle |
| `emissionOverTime` | Particles emitted per second |
| `emissionOverDistance` | Particles per meter of emitter travel; a stationary preview cannot demonstrate this |
| `emissionBursts` | Entries with spawn time, count generator, probability, cycle, and interval fields |
| Animama playback duration | External lifetime of the whole effect, described in [integration.md](integration.md) |

A non-looping emitter can finish emission while its particles remain alive. A
whole-effect clear disposes the instance immediately, including surviving
particles. For continuous emission, the natural tail may extend approximately one
maximum particle lifetime beyond the final emission time.

Initial values are sampled at spawn. Over-life behaviors use normalized particle
age (`age / life`); they do not use the whole-effect playback fraction. `prewarm`
pre-simulates a looping system, but has no dedicated creator control at this
baseline.

**Burst limitation in 0.17.1:** `cycle` and `interval` survive serialization, but
the emission loop consumes each burst entry once per emitter cycle. An isolated
simulation with count 1, probability 1, cycle 3, and interval 0.1 emitted one
particle over 0.75 seconds, as did cycle 1. Do not promise repeated bursts from
the UI fields alone. Separate burst entries work at the library level; the UI
edits the first entry only. Separate emitters with different burst times are a
UI-accessible alternative when appropriate. Reverify this after library upgrades.

## Shapes and direction

The creator edits Point, Sphere, Cone, and Rectangle. Quarks supports other
shapes, but importing a valid library shape does not guarantee portable Save.

- Point spawns at the origin with randomized outward velocity; it is not a
  directional nozzle. Zero initial speed keeps particles there until behaviors
  move them.
- Sphere distributes spawn positions and outward velocities over its configured
  volume/shell and arc.
- Cone emits around local +Z in the installed implementation. Do not assume that
  increasing speed makes particles move upward in avatar +Y.
- Rectangle lies in local XY and initially sends particles outward in that plane.
  Width and height describe the emission region, not sprite size.

Thickness changes interior versus boundary distribution. Shape mode, spread,
and shape speed control where emission samples travel around the shape; shape
speed is distinct from initial particle speed. The creator offers Random, Loop,
PingPong, and Burst distribution modes. Use the shape/direction outline to check
orientation and the global transform to rotate the effect; the emitter Position
panel edits local translation, not a per-emitter rotation gizmo.

## Generators and behaviors

| Concept | Library representation and creator meaning |
| --- | --- |
| Constant | `ConstantValue`: one scalar |
| Range | `IntervalValue`: randomized value between endpoints |
| Linear over life | Creator writes a single linear `PiecewiseBezier` segment |
| Initial color | `ConstantColor` or `ColorRange`; creator themes populate values |
| Color over life | Gradient or random blend between gradients, multiplied by initial RGBA |
| Size over life | Curve multiplier applied to initial size |
| Speed over life | Modifier of particle movement, not a new absolute initial speed |
| Force over life | Changes velocity over time on X/Y/Z |
| Frame over life | `PiecewiseBezier` drives the sprite atlas tile index over particle age |

The creator also edits rotation, 3D rotation, orbit, noise, turbulence, speed
limiting, and trail width. 3D rotation is relevant to Mesh mode; Width Over Length
is relevant to Trail mode. Behavior order is serialized and can affect simulation;
there is no general behavior-reordering UI.

RGBA values use 0–1. Color Over Life multiplies initial RGBA rather than replacing
it. Size Over Life multiplies the initial size rather than specifying meters.
Do not assume a control named Size Over Life supplies a freeform curve editor:
the creator's toggle installs/preserves a predefined curve. Advanced scalar
controls generally support constant, range, and linear forms. Some imported
curves/settings remain in JSON but are not editable or saveable through the
portable creator contract.

## Rendering and textures

| Render mode | Value | Behavior |
| --- | --- | --- |
| Billboard | 0 | Camera-facing sprite |
| Stretched Billboard | 1 | Sprite stretched using velocity, speed factor, and length factor |
| Mesh | 2 | Instanced geometry with 3D orientation |
| Trail | 3 | Ribbon from particle history, with start length and optional local-origin following |
| Horizontal Billboard | 4 | Plane constrained horizontally |
| Vertical Billboard | 5 | Upright billboard with constrained facing |

Mesh mode uses the serialized `instancingGeometry`; selecting it does not import
a model. The blank creator starts with plane geometry. Trail start length controls
stored history length, not the whole effect's duration in seconds.

Normal and additive blending have different compositing results. Depth testing
can occlude particles behind avatar geometry. Render order controls draw ordering;
it does not override depth testing. Depth writes and alpha test are separate
settings; changing them can produce clipped edges or inter-particle occlusion.

Atlas columns and rows are `uTileCount` and `vTileCount`. Frame indices are zero
based, and authored frame count can be smaller than tile capacity. `blendTiles`
interpolates adjacent frames. Frame Over Life ties animation speed to particle
lifetime, not an independent FPS setting.

**Soft-particle integration limitation:** Quarks needs a scene depth texture via
`BatchedRenderer.setDepthTexture(...)`. Animama exposes the toggle and fade
distances but has no call supplying that texture at this baseline. Do not claim
working geometry-intersection fading merely because the toggle is enabled.

## JSON and lifecycle

A Quarks resource is an ObjectLoader-style document: `metadata`, `geometries`,
`materials`, `textures`, `images`, and an `object` hierarchy. A `ParticleEmitter`
node has a `ps` system definition; resource UUIDs connect system → material →
texture → image URL. This is distinct from the outer Animama catalog descriptor.

`QuarksLoader.load` fetches JSON; `parse` consumes an object. Register loaded
emitters with `QuarksUtil.addToBatchRenderer`. Animama clones cached prefabs for
separate instances. Library controls include play, pause, stop/restart, endEmit,
and dispose. Stopping emission is different from clearing particles. Resource
cleanup must respect shared prefab geometry/materials; Animama handles instance,
prefab, batch, and Blob URL ownership at their respective lifetimes.

## Verify library-sensitive details

- Version: `src/frontend/web/package.json` and `src/frontend/pnpm-lock.yaml`.
- Installed source: resolve the active checkout's `three.quarks` and `quarks.core`
  packages; inspect `ParticleSystem`, `BatchedRenderer`, the relevant shape, or
  behavior. Do not depend on another checkout's node_modules path.
- Primary upstream reference: [three.quarks repository](https://github.com/Alchemist0823/three.quarks).
  Context7 library ID: `/alchemist0823/three.quarks`, after resolving it.
- App deserialization fixtures: `src/frontend/web/src/lib/avatar/particle-vfx/QuarksCompatibility.test.ts`
  and its `fixtures/` directory. Parsing proves format compatibility, not rendered
  appearance or the behavior of every exposed control.
