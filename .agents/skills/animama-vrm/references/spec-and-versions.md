# VRM specification and version differences

Use for file inspection, schema questions, and separating format guarantees from runtime conventions. For coordinate math continue to [bones and posing](bones-and-posing.md).

## glTF foundation

A `.vrm` is a GLB containing glTF 2.0 data plus VRM extensions. glTF provides the scene graph, meshes/primitives, accessors, skins, materials, textures, and morph targets. VRM adds humanoid roles and avatar behavior. A generic glTF viewer may render geometry without implementing expressions, MToon, or secondary motion.

glTF uses right-handed coordinates, Y up, meters, local transforms composed as `T * R * S`, and quaternions `[x, y, z, w]`. A node's local transform is relative to its parent; its world transform includes ancestors. Skin joints and inverse bind matrices connect the skeleton to vertices. Humanoid roles annotate nodes and are separate from that skinning data. [glTF 2.0 specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html)

## Detect the actual schema

| Concern | VRM 0.x | VRM 1.0 |
| --- | --- | --- |
| Core JSON extension | `extensions.VRM` | `extensions.VRMC_vrm` |
| File's forward direction | −Z | +Z |
| Exported bone rest rotations | Normalized: no local bone rotation | Nonidentity rest rotations allowed |
| `humanoid.humanBones` | Array of bone/node entries | Object keyed by semantic bone name |
| Chest and neck | Required | Optional |
| Expression definitions | `blendShapeMaster.blendShapeGroups` | `expressions.preset` / `expressions.custom` |
| Gaze configuration | Inside `firstPerson` | Separate core `lookAt` property |
| Secondary motion | `secondaryAnimation` | `VRMC_springBone` extension |
| MToon | Legacy `materialProperties` | Per-material `VRMC_materials_mtoon` |
| Node constraints | No equivalent standardized extension | `VRMC_node_constraint` |

The extension modules have their own specification versions. `exporterVersion`, core `specVersion`, runtime `metaVersion`, and npm package version are different values. Do not infer the schema from filenames, exporter names, or the number in the library package.

The change is not a field-renaming migration: coordinates, expressions, materials, spring chains, and permission metadata also differ. Use the library's import adapters for runtime consumption. A request to convert/export files needs its own loss/preservation analysis. [VRM 0 specification](https://github.com/vrm-c/vrm-specification/blob/master/specification/0.0/README.md), [VRM 1 changes](https://vrm.dev/en/vrm1/changed/), [humanoid changes](https://vrm.dev/en/vrm1/humanoid/)

## Humanoid structure

VRM 1 requires 15 semantic bones: `hips`, `spine`, `head`; left/right `upperArm`, `lowerArm`, `hand`; left/right `upperLeg`, `lowerLeg`, `foot`. These are semantic names such as `leftUpperArm`, not required scene-node names. Eyes, jaw, shoulders, neck, chest, upper chest, toes, and fingers can be absent. Follow the specification's parent relationships; optional ancestors can be omitted and non-humanoid intermediate nodes can exist.

VRM 1 thumb roles are `ThumbMetacarpal`, `ThumbProximal`, and `ThumbDistal` for each side. VRM 0 used `ThumbProximal`, `ThumbIntermediate`, and `ThumbDistal` for those successive joints. Let the loader map legacy roles; do not rename already imported runtime bones again. Bone availability and skin weights are independent: a mapped bone need not affect the mesh area you expected. [Humanoid specification](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/humanoid.md)

## Avatar extensions

- `VRMC_vrm` requires metadata and humanoid information; look-at, expressions, and first-person settings are additional core sections. Moving the whole avatar belongs at its scene/root transform; moving hips is skeletal motion. [VRM 1 core](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/README.md)
- Expressions can bind morph weights, material colors, and texture transforms. Preset names are semantic controls, not a guaranteed morph-target inventory. [Expressions](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/expressions.md)
- First-person annotations control which mesh nodes appear from the avatar's viewpoint (`auto`, both views, or one view). They do not identify cheek landmarks or face textures. [First-person specification](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/firstPerson.md)
- Metadata describes creator attribution and model-use permissions. Preserve it during transformations; library licensing does not grant permission to redistribute a particular avatar. VRM 0/1 permission fields are not interchangeable. [VRM 1 metadata](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/meta.md)

## Animation is a separate layer

VRM avatar assets are not an embedded glTF animation library. VRM Animation (`.vrma`, `VRMC_vrm_animation`) defines portable humanoid, expression, and look-at animation. Its humanoid tracks use rotation, hips translation, and no scale animation. Ordinary FBX/glTF animation clips need a suitable retargeting path; a filename change does not produce VRMA. [VRM Animation specification](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm_animation-1.0/README.md)

Animama's `animaPose/1.0` and `animaPoseClip/1.0`/`animaPoseClip/2.0` are app schemas, separate from VRM/VRMA. They can also reference app effect/sound events. Check the app schema before applying a VRMA restriction to these documents.
