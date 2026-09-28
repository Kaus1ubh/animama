# Bone orientation, posing, and retargeting

Use for Gesture Pose mode, hands, gizmos, procedural motion, and saved-pose compatibility. Repository paths are relative to the active Animama root.

## Keep the spaces and representations explicit

| Representation | Meaning |
| --- | --- |
| Scene/world | Includes canvas placement and every ancestor transform |
| Model/root space | Coordinates relative to the avatar root, before app placement |
| Raw parent-local | Authored glTF node transform; VRM 1 rest rotations may be nonidentity |
| Normalized parent-local | three-vrm's control hierarchy, converted back to raw bones during humanoid update |
| Animama canonical pose | Serialized/editor values authored in a VRM 1-style basis; converted at runtime boundaries for VRM 0 |

A normalized rig is not a generic world-space rig. `Object3D.quaternion` is still parent-local. For a desired world orientation under a rigid/uniformly scaled hierarchy, `qLocal = inverse(qParentWorld) * qDesiredWorld`; account separately for rest-relative pose APIs. Quaternion multiplication order matters: `q * delta` applies a local-axis delta, while `delta * q` applies it in the parent basis. Convert degrees to radians for Three.js, normalize quaternions, and compare orientations by angular distance because `q` and `-q` encode the same rotation.

Refresh relevant world matrices before computing world/local transforms, bounds, or anchors after a pose change. Do not repair apparent orientation by changing inverse bind matrices; that changes the skin's bind relationship. [glTF transformations and skinning](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html)

## What the rest pose guarantees

VRM 1's prescribed visible T-pose faces +Z with anatomical left toward +X and right toward −X. Feet point +Z; the visible soles meet Y=0. Arms, hands, and four fingers extend along X. Palms face −Y and the four fingers' nails +Y. Thumbs point diagonally outward/+Z at 45 degrees, with nails rolled outward: left nail toward −X/+Z, right nail toward +X/+Z. Node scales are positive and uniform.

Those are rest-pose appearance rules, not a guarantee that each raw bone's local X follows its limb. A rotated raw bone frame is valid in VRM 1. A bent elbow, posed parent, or rotated canvas root also changes the relationship between local and visible axes. [T-pose specification](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/tpose.md)

## three-vrm pose APIs

- Use `getNormalizedBoneNode(name)` for ordinary control-rig posing; check for `null`.
- Use `getRawBoneNode(name)` for authored node inspection or a deliberate attachment to the actual skeleton. An attachment to the normalized rig follows the control pose; an attachment to raw bones can reflect later constraints. Choose the intended behavior.
- `autoUpdateHumanBones` defaults to true. Normalized-to-raw transfer can overwrite raw edits every update. A raw-only animation pipeline must deliberately own that transfer policy; do not disable it globally to patch an editor symptom.
- `getNormalizedPose()` / `setNormalizedPose()` and the raw equivalents use local transforms relative to rest. `normalizedRestPose` / `rawRestPose` contain actual local rest transforms. `getNormalizedAbsolutePose()` means current local transforms, not world transforms. Avoid the deprecated ambiguous `getBoneNode`, `getPose`, and `setPose` APIs.

Sources: [VRMHumanoid API](https://pixiv.github.io/three-vrm/docs/classes/three-vrm.VRMHumanoid.html), [3.5.2 implementation](https://github.com/pixiv/three-vrm/blob/v3.5.2/packages/three-vrm-core/src/humanoid/VRMHumanoid.ts).

Normalization compensates for authored rest frames. It does not promise identical reach or hand contact on different proportions, or perfect redistribution across missing optional bones. Raw local quaternions cannot generally be copied between arbitrary skeletons. Retarget through a rest-aware representation; account for optional parents and hips translation scale when needed. [Official pose compatibility guidance](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm_animation-1.0/how_to_transform_human_pose.md)

## VRM 0 correction: two independent operations

1. `VRMUtils.rotateVRM0(vrm)` assigns `vrm.scene.rotation.y = Math.PI` for version `"0"`. It corrects root facing and does not rewrite bone data, bind matrices, or pose values. Animama already calls it in `Avatar._loadVrm`. Do not add another scene turn in the editor. [Utility implementation](https://github.com/pixiv/three-vrm/blob/v3.5.2/packages/three-vrm/src/VRMUtils/rotateVRM0.ts)
2. Animama's canonical pose conversion conjugates rotations by a half-turn about Y: `[x,y,z,w] → [-x,y,-z,w]`; positions become `[-x,y,-z]`. This conversion is its own inverse. Apply it only between the canonical basis and a VRM 0 normalized runtime, not as a generic left/right fix.

Reuse `src/frontend/web/src/lib/avatar/poses/poseRetargeting.ts`:

- `isVrm0`
- `convertPoseQuaternionBasis`: editor read/write boundary
- `retargetPoseForVrm0`, `retargetClipSampleForVrm0`: playback boundary

Serialized drafts and saved poses remain canonical. `createVRMAnimationClip()` already adapts VRMA tracks for the target version and scales hips translation using rest hip heights. Do not run the app's conversion again on those generated tracks. [3.5.2 animation adapter](https://github.com/pixiv/three-vrm/blob/v3.5.2/packages/three-vrm-animation/src/createVRMAnimationClip.ts)

## Animama Pose mode

`src/frontend/web/src/ui/pose-creator/poseCreatorAuthoring.ts` owns canonical **XYZ Euler degrees** for UI drafts and quaternion serialization. Reuse `captureBoneBaseQuaternion`, `readPoseCreatorBoneRotationDegrees`, `applyBoneDraft`, and `restoreBoneBaseQuaternion`. Preview writes update the VRM at zero elapsed time so raw geometry reflects the change. The UI Euler values describe the current canonical rotation; they are not deltas from the inherited pose.

`PoseCreatorBoneGizmo.tsx` attaches local-space TransformControls to a normalized bone. Controls mutate the node before `objectChange`; the existing drag-start handler captures the inherited base first. Route numeric and gizmo changes through `usePoseCreatorBoneRotation.ts` so mirroring, cleanup, and Undo grouping stay consistent. Do not reset the base from an already mutated node.

`animaPose/1.0` parent inheritance is sparse replacement of supplied transform fields, not multiplication of quaternion offsets. `PoseController.applyPose` resets to normalized T-pose before applying the resolved pose. The app's `relaxedRest` is a default pose selected by `Avatar`, not a hidden additive base for every saved pose. Here “absolute override” means replacing a pose channel; it does not mean world-space or `getNormalizedAbsolutePose()` values.

Sources: `src/frontend/web/src/lib/avatar/poses/animaPose.ts`, `src/frontend/web/src/lib/avatar/poses/PoseController.ts`, `docs/frontend/runtime/avatar-animation.md`.

## Hands and fingers

Reuse `src/frontend/web/src/ui/pose-creator/poseCreatorHandAuthoring.ts` and `poseCreatorHandInteraction.ts`. The app adjusts fingers in the canonical basis, with side-dependent axes; thumb handling differs from the four fingers. Geometry-assisted thumb presets use normalized joint offsets and retained metacarpal orientation. Current hand-panel segments edit thumb proximal/distal, leaving the metacarpal pose intact. This is an app UI choice, not the full VRM thumb specification.

Do not prescribe “curl all fingers around local X.” Inspect the selected bone, rest direction, parent orientation, and intended palm plane. Both-hand mode checks each available bone; it must not invent a missing counterpart. Numeric limits bound the requested adjustment rather than clamping an entire inherited pose.

Useful checks: start with neutral and already posed hands, rotate the hand/forearm, apply a small curl and spread, then inspect thumb and fingertip direction. Test canonical save/playback plus Undo/Redo across VRM 0 and 1. Existing tests include `poseCreatorVrmBasis.test.ts`, `poseCreatorHandAuthoring.test.ts`, `poseCreatorHandInteraction.test.ts`, and `poseCreatorHandPersistence.test.ts` in the same UI directory. These mathematical/state tests do not prove visual calibration on real avatars.
