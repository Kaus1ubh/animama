# Animama runtime and creator integration

Use to locate the owner of behavior before editing code or operating a creator. Paths are relative to the active repository. This is a source map for the baseline recorded in `SKILL.md`; current source and maintained app contracts take precedence when they change.

## Source map

| Boundary | Primary source |
| --- | --- |
| Main canvas, model mounting and disposal | `src/frontend/web/src/ui/main/canvas/AvatarCanvasActor.tsx`, `AvatarSceneHost.tsx` in the same directory |
| VRM load, controller composition, first pose, frame update | `src/frontend/web/src/lib/avatar/Avatar.ts` |
| VRMA conversion, mixer, cache, playback | `src/frontend/web/src/lib/avatar/AnimationManager.ts` |
| Canonical pose schema, inheritance, playback, version conversion | `src/frontend/web/src/lib/avatar/poses/animaPose.ts`, `PoseController.ts`, `poseRetargeting.ts` in that directory |
| Timed app clips and events | `src/frontend/web/src/lib/avatar/poses/animaPoseClip/` |
| Expression composition and procedural motion | `src/frontend/web/src/lib/avatar/ExpressionController.ts`, `ProceduralAnimationController.ts` in that directory |
| Exact model/motion/media content closure | `src/frontend/web/src/lib/runtime-content/AnimaRuntimeCatalog.ts` |
| Shared Action creator and document model | `src/frontend/web/src/ui/action-editor/ActionEditorPage.tsx`, `ActionEditorWorkspace.tsx` in that directory |
| Pose editing and preview ownership | `src/frontend/web/src/ui/pose-creator/`, `src/frontend/web/src/stores/pose-creator-store.ts` |
| Avatar Effect editor | `src/frontend/web/src/ui/avatar-effect-creator/AvatarEffectCreatorPage.tsx` |
| Shared FX preview avatar | `src/frontend/web/src/ui/content-creator/useContentCreatorAvatar.ts` |
| Library content preview | `src/frontend/web/src/ui/content-preview/ContentPreviewScene.tsx` |
| File versus live runtime inspection | `src/frontend/web/src/lib/avatar/VRMDocument.ts`, `VRMEditorSession.ts`, `vrmEditorInspection.ts` in that directory |

Maintained guides: `docs/frontend/runtime/avatar-animation.md`, `avatar-vfx.md`, `avatar-particle-vfx.md`, `scene-vfx.md`, and `vrm-inspector-editor.md` in the same directory. Read the relevant sections rather than the entire avatar subsystem.

## Model loading and the main canvas

The main actor consumes the selected model from the Anima's prepared runtime content. Stable content/runtime revision identity determines a load; a temporary download or Blob URL is not model identity. The mounted catalog also owns prepared motion/media dependencies. Reuse this resolution path instead of fetching arbitrary public paths around a missing entry.

`Avatar.load` creates the VRM runtime and controllers. It retains `sourceGltf`, `sourceUrl`, and `sourceKey` for inspection; corrects VRM 0 root facing; builds face landmarks and texture anchors; and creates VFX/particle controllers. `prepareFirstFrame()` verifies and applies the default `relaxedRest` pose, updates the rig/world transforms, then allows attachment. Preserve this boundary when working on a T-pose flash or load fallback.

Main runtime update sequence in `Avatar.update`:

1. Remove previous procedural offsets, then advance the animation mixer.
2. Apply idle-exit blending and sampled pose clips.
3. Apply procedural layers, reaction samples, and expression composition.
4. Update avatar VFX and spring tuning, then call `vrm.update`.
5. Update particles after constraints/springs settle their anchors; update debug helpers.

This makes writer ownership concrete. A new per-frame React mutation outside these controllers can be overwritten or accumulate offsets. The source comment mentioning “IK” at `vrm.update` does not establish an IK solver in three-vrm.

## Creator routes and authoring contracts

| Surface | Route / behavior |
| --- | --- |
| Gesture creator | `/gestures/new`, `/gestures/:gestureId/edit`; Anima Clip documents expose Pose and Clip modes in the shared Action editor; VRMA imports have a different editing surface |
| Saved Pose editing | `/poses/:poseId/edit`; static bone/expression content |
| Reaction creator | Action editor for expression/effect/sound timing; rejects humanoid tracks |
| Avatar Effect creator | `/avatar-effects/new` (usually opened from the Effects template picker, optionally with `?template=<id>`), `/avatar-effects/:avatarEffectId/edit`; preview on either Included Avatar or the active Anima's model using the production VFX controller |

For browser work, navigate through the available UI and confirm the loaded item/model. Treat a creator's draft, Play/Stop, and Save as different operations; use the user's requested scope to decide whether to persist changes.

Pose preview is not a chat avatar loop. `PoseCreatorAvatarActor.tsx` disables automatic animation, applies the chosen base/drafts, and calls `updatePoseCreatorAvatarFrame` from `poseCreatorAvatarFrame.ts`. That helper advances VFX → VRM → particles; timeline sampling is owned by the creator's preview/ticker components. Calling full `Avatar.update` here can reintroduce unrelated motion or expression writers.

The Avatar Effect creator uses `useContentCreatorAvatar` to own a static avatar and its VRM frame update; `AvatarEffectPreviewActor` in the creator page advances VFX while playing. Inspect both callbacks when changing ordering. Do not assume every preview shares the main actor's complete loop.

Gesture Pose mode uses canonical drafts and the helpers in [bones and posing](bones-and-posing.md). Capturing/editing a static pose, inserting it into a timeline, and saving a reusable Pose are distinct operations. Selected poses copy effective values into the Gesture, including inherited/base channels; insertion bakes the candidate clip so later source edits/deletion do not change it. Reaction's Relaxed Rest body is preview-only and is not serialized into its document. Reuse current action/pose persistence APIs rather than writing live Three.js objects into editor state.

Avatar Effects are reusable dependencies selected inside Gestures/Reactions. The action event owns Start/End timing. An effect's artwork/transform/animation settings are content, while preview camera/guides/Play state are authoring controls. Legacy effect `lifetime` fields are ignored.

## Inspection is not export

`VRMDocument` preserves raw GLB JSON/resources and also creates a sanitized gltf-transform view. Sanitization removes VRM extension declarations from that parser input; raw extension data remains necessary for metadata/material inspection. Do not serialize that sanitized view as a “converted VRM” and assume extension fidelity.

`VRMEditorSession` combines document data with the currently rendered Avatar and owns runtime-only overrides. `buildRuntimePrimitiveBindings` in `vrmEditorInspection.ts` resolves live node/mesh/primitive usages from loader associations. A material definition can be used by several rendered primitives. Source material index alone is not a safe target identity for a localized edit.

## Validation by boundary

Use the repository's current test commands. For a focused Vitest check, run `pnpm exec vitest run <test paths>` from `src/frontend/web` with required workspace packages already built. The full `pnpm web:test` command from `src/frontend` also runs package builds and Node checks. Useful existing targets:

- Orientation and pose persistence: tests beside `poseCreatorAuthoring.ts`, especially `poseCreatorVrmBasis.test.ts` and the hand authoring/interaction/persistence tests.
- Creator frame ownership: `src/frontend/web/src/ui/pose-creator/poseCreatorAvatarFrame.test.ts`.
- Pose/clip sampling and schema: tests under `src/frontend/web/src/lib/avatar/poses/animaPoseClip/`.
- VFX lifetime and portable document behavior: `src/frontend/web/src/lib/avatar/vfx/effect-image.test.ts`, `vfx/editor/document.test.ts` under the avatar directory, and creator history/preview tests near the affected component.
- Canvas first pose: `src/frontend/web/src/ui/main/canvas/firstPosedFrame.test.ts`.

For code that changes real avatar presentation, test the affected creator on the intended model. Add a second version/proportion when the claim is cross-model portability. Verify preview → Save → reopen/playback where that boundary changes, and that Stop/Destroy/unmount restores owned state. Math/schema tests cannot establish rendered skin deformation, thumb contact, or texture alignment. Skill structure validation alone does not constitute a creator/browser pilot.
