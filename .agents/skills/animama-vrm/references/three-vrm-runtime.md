# three-vrm runtime

Use for loading, update order, animation, expressions, look-at, constraints, springs, and disposal. API links follow the documentation site; implementation links are pinned to the researched 3.5.2 baseline. Check the installed version before relying on implementation details.

## Loading and animation

Outside Animama, the basic import sequence is `GLTFLoader` → register `new VRMLoaderPlugin(parser)` → load GLB → check `gltf.userData.vrm` → attach `vrm.scene`. The plugin assembles the VRM components; the base GLTFLoader does not supply their behavior. Apply any deliberate root-facing convention after import. [three-vrm API and usage](https://pixiv.github.io/three-vrm/docs/modules/three-vrm)

Inside Animama, reuse `Avatar` and the canvas/content preparation path. Its shared loader registers both `VRMLoaderPlugin` and `VRMAnimationLoaderPlugin`; prepared resource maps are handled by a LoadingManager URL modifier. A second independent loader can miss the app's resource ownership, orientation, or controller setup.

For VRMA, `VRMAnimationLoaderPlugin` exposes `gltf.userData.vrmAnimations`. `createVRMAnimationClip(animation, vrm)` produces a Three.js clip for a specific avatar's normalized bones, expressions, and look-at proxy. Bind that clip through an AnimationMixer for the target avatar. It already performs VRM 0 sign conversion and hips-height scaling. A raw animation resource can be reusable; a generated target-bound clip should not be assumed interchangeable across avatars. [Animation API](https://pixiv.github.io/three-vrm/docs/modules/three-vrm-animation.html), [adapter source](https://github.com/pixiv/three-vrm/blob/v3.5.2/packages/three-vrm-animation/src/createVRMAnimationClip.ts)

Animama's `AnimationManager` owns this conversion, mixer, clip caches, playback transitions, and uncache operations. Its optional rooted playback removes translation tracks while retaining rotation/expression/look-at tracks; inspect the active setting before diagnosing missing root motion.

## Frame ownership

Advance application animation before `vrm.update(deltaSeconds)`. The 3.5.2 VRM update order is:

```text
normalized humanoid → raw bones
look-at
expression bindings
node constraints
spring bones
material updates
```

Sources: [VRMCore.update](https://github.com/pixiv/three-vrm/blob/v3.5.2/packages/three-vrm-core/src/VRMCore.ts), [VRM.update](https://github.com/pixiv/three-vrm/blob/v3.5.2/packages/three-vrm/src/VRM.ts).

Identify the last writer when changes disappear. Typical conflicts are mixer versus manual pose, normalized transfer versus raw rotation, gaze versus eye pose, and expression binding versus direct morph/material changes. `vrm.update` is not a general-purpose IK solver; hand targeting and foot planting require application logic. Do not add a second update to a canvas already owned by an actor. Follow its existing zero-time refresh path for static pose changes and its normal seconds-based frame loop for simulation.

## Expressions and lip-sync

Use `vrm.expressionManager?.getExpression(name)`, `setValue(name, weight)`, and the manager's available expressions to determine support. Runtime weights are in `[0,1]`; not every preset exists on every avatar. VRM 0 import maps legacy presets, including `joy → happy`, `sorrow → sad`, `fun → relaxed`, and vowel names to `aa`, `ih`, `ou`, `ee`, `oh`. A preset may drive multiple morphs and material properties rather than one similarly named morph target. [Expression importer](https://github.com/pixiv/three-vrm/blob/v3.5.2/packages/three-vrm-core/src/expressions/VRMExpressionLoaderPlugin.ts), [manager API](https://pixiv.github.io/three-vrm/docs/classes/three-vrm.VRMExpressionManager.html)

Expressions can override blink, mouth, and look-at with none/block/blend policies; binary expressions also have different weight behavior. Animama gives `happy`/`relaxed` without a native blink policy a calibrated `overrideBlinkAmount` at load (`src/frontend/web/src/lib/avatar/eyelidClosure.ts`), so blink cannot close eyelids past shut; manager weights stay authored while blink morphs are attenuated. Preserve those bindings instead of adding a competing direct `morphTargetInfluences` writer. In Animama, route emotion, blinking, speech, and action overlays through the existing `ExpressionController` composition. Exact channels and timing are documented in `docs/frontend/runtime/avatar-emotion.md` and `docs/frontend/runtime/avatar-lipsync.md`. [Expression specification](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/expressions.md)

## Gaze

Look-at can drive eye bones or expressions. Its frame accounts for the head's rest orientation and configured offset; raw head-local +Z is not universally the gaze axis. three-vrm exposes a target Object3D and look-at APIs; inspect the active owner before also writing eye quaternions. In Animama, cursor/head procedural motion, VRMA look-at, and expression overrides may all affect the outcome. [Look-at specification](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/lookAt.md), [VRMLookAt API](https://pixiv.github.io/three-vrm/docs/classes/three-vrm.VRMLookAt.html)

## Secondary motion and constraints

`VRMC_node_constraint` defines roll, aim, and rotation relationships, commonly for twist bones or clothing. It is distinct from humanoid control and spring simulation. Account for constrained raw transforms when attaching effects or sampling geometry after a frame; a normalized node can represent the input rather than the final constrained result. [Constraint specification](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_node_constraint-1.0/README.md)

`VRMC_springBone` uses ordered joint chains, stiffness, drag, gravity, and sphere/capsule colliders for secondary motion. VRM 1's terminal joint defines a tail; legacy VRM 0 handling can create an inferred endpoint. Do not translate joint lists or numeric parameters as though the schemas were identical. Inspect the center/reference space when physics behaves differently after moving an avatar. Animama's `spring-bone/SpringBonePhysicsController.ts` tunes settings before the library simulation. [Spring-bone specification](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_springBone-1.0/README.md)

## Lifetime and optimization

Use the owning `Avatar.dispose()` / `unload()` path in Animama. It tears down controllers and then uses `VRMUtils.deepDispose` for the loaded scene. React actors render `<primitive dispose={null}>` because ownership is explicit. Remove mixer actions/listeners and release app URL leases through their owners; late async results must not remount or cache a disposed avatar.

`removeUnnecessaryVertices`, `combineSkeletons`, and `combineMorphs` are available utilities; `removeUnnecessaryJoints` is deprecated in the current API. Optimization can affect associations, inspection, or morph/expression bindings. Apply it only at an appropriate load boundary and validate those consumers; Animama already removes unnecessary vertices during load. Resource disposal must not destroy textures or materials still shared by another owner. [VRMUtils API](https://pixiv.github.io/three-vrm/docs/classes/three-vrm.VRMUtils.html)
