---
name: animama-vrm
description: "Understand, inspect, and work with VRM 0/1 models and three-vrm in Animama. Use for avatar canvases, bone orientation and retargeting, Gesture/Pose authoring, expressions, materials, and Avatar Effect creation or debugging."
---

# Animama VRM

Use this as the foundation for VRM work in Animama's web runtime and creator routes. It supplies domain knowledge and source navigation; it does not authorize saving content, changing code, or replacing the user's requested workflow.

## Establish the context

Identify the loaded model's VRM version, the owning canvas/editor, and the relevant installed three-vrm version. Use `vrm.meta.metaVersion` (`"0"` or `"1"`) at runtime; inspect the GLB's `VRM` or `VRMC_vrm` extension when working with the file. A package version such as `3.5.2` is not a model format version.

Keep three kinds of evidence distinct:

- **Specification:** what a conforming VRM/glTF file means.
- **Library:** what the installed three-vrm implementation does.
- **Animama:** our pose basis, controller ownership, content contracts, and material/landmark heuristics.

Reference baseline: researched 2026-09-24; Animama revision `f09d5d7c63fb17f943497f66d4125168af1c9874`; lockfile resolves `@pixiv/three-vrm` and `@pixiv/three-vrm-animation` **3.5.2**, Three.js **0.182.0**. Recheck `src/frontend/pnpm-lock.yaml` and the named source symbols when they differ. Repository paths below are relative to the active Animama Git root, never to this skill or a particular worktree. Follow that checkout's agent guides for code changes.

## Read the relevant reference

| Task | Read |
| --- | --- |
| Inspect a file, distinguish VRM 0/1, understand humanoid semantics | [Specification and versions](references/spec-and-versions.md) |
| Pose bones, orient hands, use a gizmo, retarget or serialize a pose | [Bones and posing](references/bones-and-posing.md) |
| Load/update/dispose three-vrm; work with expressions, gaze, constraints, springs, VRMA | [three-vrm runtime](references/three-vrm-runtime.md) |
| Find the canvas owner, understand chat versus creator previews, navigate app contracts | [Animama runtime and creators](references/animama-runtime-and-creators.md) |
| Inspect skinning/materials, choose or troubleshoot an Avatar Effect, use UV/placement guides | [Materials and Avatar VFX](references/materials-and-avatar-vfx.md) |

For a creator task, read its domain reference plus the applicable section of the app reference. Do not load every reference for a narrow question. Prefer the linked specifications, API docs, and version-matched implementation to Unity examples or generic tutorials.

## Decision rules

- Name the coordinate space and pose meaning before doing rotation math: world, model, raw parent-local, normalized parent-local, or Animama's canonical serialized basis; rest-relative versus current local transform. Facing direction alone does not identify a raw bone's axes.
- Use semantic humanoid mappings rather than mesh/node names. Optional bones and expressions may be absent. Prefer normalized bones for posing and inspect raw bones when the authored skeleton matters.
- Establish who writes the property each frame. A raw rotation can be replaced by normalized transfer; an editor edit can be replaced by animation; a morph or material edit can be replaced by an expression. Use the existing controller boundary.
- Keep root facing correction and pose-basis conversion separate. Reuse Animama's conversion helpers; do not flip serialized drafts or double-convert VRMA tracks.
- Treat face UVs, material roles, and facial VFX anchors as model-dependent app behavior. A valid VRM does not guarantee a compatible face atlas or a material named `face_skin`.
- Use the production creator preview and its selected model when authoring content. If a binding is missing or art is misplaced, inspect the binding/anchor/transform before changing the model or inventing a fallback.

## Evidence for the task

For orientation changes, check the relevant VRM versions, save/reopen or serialization/playback boundary, and Undo/Redo when editing. For VFX, check the actual model, animated expressions, oblique views, stacking/cleanup, and any affected texture slots. Select only the checks relevant to the change; [app guidance](references/animama-runtime-and-creators.md#validation-by-boundary) points to existing tests.

Distinguish source reasoning, automated checks, and observed browser results. Quaternion correctness does not establish a natural-looking hand or successful decal placement. Report model-specific limits and checks not performed.
