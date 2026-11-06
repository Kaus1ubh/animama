# Converting a VRChat Avatar

Animama loads VRM files. An Avatar sold for VRChat (a Unity Avatar 3.0 prefab)
reaches it through a VRM 1.0 export with
[Mochiya Avatar Tools](https://github.com/mochiya-labs/unity-avatar-tools),
run by the Animama Avatar Converter Unity package. Users install it from its
repository,
[raymond-van/animama-avatar-converter](https://github.com/raymond-van/animama-avatar-converter),
whose README is the end-user guide (a Unity menu, or `npx
animama-avatar-converter` in the project's folder). This
page covers the developer workflow in this repository. The
export keeps the humanoid rig, approximates PhysBones as VRM spring bones, maps
the VRChat visemes, blink and look-at, and carries the lilToon material settings
in a `MOCHIYA_materials_liltoon` extension. Face shapes keep their names, so
Animama finds the Avatar's ARKit shapes
([ARKit face shapes](avatar-animation.md#arkit-face-shapes)) and plays emotions
through them and its standard MMD morphs ([Faces on non-VRoid Avatars](avatar-emotion.md#faces-on-non-vroid-avatars)).

## Licence first

Read the Avatar's licence before converting it. Many BOOTH Avatars use the VN3
licence, whose terms each author sets: check that yours allows format
conversion for your own use. VN3 terms commonly forbid redistributing the data
or edited versions.

- Keep the Unity project, the downloaded packages and every exported `.vrm`
  outside any repository. Never add them to tests, content packages, Animama
  Cloud or shared review evidence.
- Never use Mochiya's "Upload to Mochiya" feature on a licensed Avatar. The
  Animama package calls only Detect, Validate and Export, and contains no
  network code.

## Tools

Use these versions together; they match three-liltoon's compatibility table.

| Component | Version |
| --- | --- |
| Unity | 2022.3 LTS (verified with 2022.3.62f3 on Apple Silicon) |
| VRChat SDK | The Avatars template from VRChat Creator Companion |
| lilToon | 2.3.4 or later within 2.x (`jp.lilxyzw.liltoon`) |
| UniGLTF and VRM10 (UniVRM) | `v0.131.2` |
| Mochiya Avatar Tools | 0.1.6 (commit `0826f6e3`; the repository has no tags) |
| Animama Avatar Converter | the release pinned in `vrm-convert-vrchat.mjs` (`EXPORTER_RELEASE`) |

Mochiya rejects lilToon's Lite, Multi, FurOnly and tessellation variants.
Avatars that ship an older lilToon (for example 1.4.0) must be upgraded to 2.3.4
first; compare against screenshots taken before the upgrade, since the look can
change.

## Set up the Unity project

1. Create a VRChat Avatars project. On macOS, `vpm new` requires Unity
   2022.3.22f1, so with a newer 2022.3 editor copy the Creator Companion
   template and resolve it instead:

   ```bash
   cp -R ~/.local/share/VRChatCreatorCompanion/VRCTemplates/Avatar <project>
   cd <project> && vpm resolve project
   ```

   Open it once in Unity and let Unity upgrade it.

2. Import the Avatar's own lilToon package, then the Avatar package, as the
   author's setup guide says. Batch mode works:
   `Unity -batchmode -quit -projectPath <project> -importPackage <file>.unitypackage`.
   Take reference screenshots of the prefab.
3. Replace lilToon with 2.3.4 or later within 2.x: delete `Assets/lilToon` and add
   `jp.lilxyzw.liltoon` from the lilToon VPM repository
   (`https://lilxyzw.github.io/vpm-repos/vpm.json`).

The converter packages need no manual setup: `vrm:convert-vrchat` adds the
Animama package, UniGLTF and UniVRM 1.0 0.131.2 and Mochiya at its tested
commit to `Packages/manifest.json` when they are missing. It stops if the
manifest pins other versions of them; change those entries first. A project
set up for the earlier copied batch script also needs its
`Assets/AnimamaExport/` folder deleted.

## Validate and export

Pick the prefab the Avatar should look like. Many Avatars ship variants, such
as a prefab variant without the jacket; each export captures one prefab.
Variants usually hide a garment by tagging it `EditorOnly`, which VRChat strips
when it builds the Avatar but Mochiya exports. The export strips those objects
first, as a build would, and logs `Stripped EditorOnly object <name>` for each.

Close the project in the Unity editor first; the command refuses a project
that is open. Then, from `src/frontend/web`, convert:

```bash
pnpm -s vrm:convert-vrchat --project <project> \
  --prefab Assets/<Avatar>/Prefabs/<Avatar>.prefab \
  --out <private-dir>/<Avatar>.vrm \
  --name <Avatar> --version <version> --author <author> --copyright "<credit>"
```

The command:

1. runs the Animama Avatar Converter command at its pinned npm version through
   `pnpm dlx`, which adds the packages to the project if needed and runs Unity
   in batch mode: the editor version in `ProjectSettings/ProjectVersion.txt`
   from Unity Hub's folders, or `--unity <editor>` or `ANIMAMA_UNITY_EDITOR`;
2. runs `vrm:optimize` on the export (see [VRM optimization](vrm-optimization.md)),
   keeping the unoptimized file beside the result as `<Avatar>.raw.vrm`;
3. runs `vrm:inspect` on the result.

Unity's log goes to `<Avatar>.export.log` (a requirement check after a failed
compile logs to `<Avatar>.export.requirements.log`), and the command prints its
`[Animama]` lines: Mochiya's full validation report, then the same
plain-language notes as the Unity window. `--validate` stops after validation
and writes no VRM. `--no-optimize` writes the raw export to `--out`; keep it
when comparing against Unity pixel for pixel, since the optimized colour
textures are lossy WebP. The command never overwrites a file. In a fresh
worktree, build the workspace packages first (`pnpm --dir .. packages:build`
from `src/frontend/web`), or the final `vrm:inspect` step fails.

To test unreleased exporter changes, set `ANIMAMA_AVATAR_CONVERTER` to the
absolute path of a local checkout of the package repository; the command then
runs that checkout and installs its Unity package as a `file:` dependency.
Switching between a checkout and the pinned release leaves the other
`com.animama.avatar-converter` entry in `Packages/manifest.json`, which stops the
command; remove that entry first.

Errors in the report stop the export. Expect these warnings:

- **Animator state machines:** VRChat's animator state machines (gesture
  expressions, toggles) are not converted. Animama drives faces itself.
- **Visemes and blink:** visemes, eyelid shapes and eye ranges become VRM
  presets and look-at.
- **PhysBones:** each one becomes a VRM spring. Grabbing, stretching and angle
  limits are lost, and gravity falloff is baked into the rest pose.
- **Colliders:** plane colliders are omitted, and inside-bounds colliders become
  outside colliders.

Unity runs with graphics, never `-nographics`: the exporter reads compressed
textures back through the GPU, and without one it writes flat grey
placeholders (19 of one Avatar's 26 textures, including the hair colour). To
run the export by hand in a project that has the package, pass the same values
to `Unity -batchmode -quit -projectPath <project> -logFile <log>
-executeMethod Animama.AvatarConverter.BatchExport.Export -animamaPrefab <prefab>
-animamaOut <file>` with `-animamaName`, `-animamaVersion`, `-animamaAuthor`
and `-animamaCopyright` (`Animama.AvatarConverter.BatchExport.Validate` without
`-animamaOut` only validates). `Animama.AvatarConverter.BatchRequirements.Check`
lists missing or unsupported dependencies.

VRM 1.0 requires a T-pose rest pose, and VRChat Avatars are often modelled in
an A-pose. The export therefore poses the instance from its Unity humanoid
T-pose first, like UniVRM's "T-Pose (unity internal)" button, and logs
`Applied the humanoid T-pose`. Pass `-animamaKeepPose` to export the modelled
pose instead (`--keep-pose` in the command). Animama normalizes arms that rest
10° or more from a T-pose when it loads them
([Rest normalization](avatar-animation.md#rest-normalization)), so an A-pose
export still plays Gestures with its arms where a T-pose export's go, but other
VRM tools expect the T-pose.

The metadata arguments fill `VRMC_vrm.meta`. Its permissions stay at UniVRM's
restrictive defaults: only the author may use the Avatar, and redistribution and
modification are prohibited.

## Check the export

`vrm:convert-vrchat` ends with `vrm:inspect`; run it again with
`pnpm -s vrm:inspect <private-dir>/<Avatar>.vrm` from `src/frontend/web`.

Check that:

- no texture is a flat colour (a sign of a `-nographics` export);
- the file is VRM 1.0 and under the 100 MiB upload limit. If the optimized
  file is still too large, reduce its textures in Unity and convert again;
- no face mesh reports its names as "primitives, mismatched" (its mesh parts
  name the shapes differently, so they load unnamed);
- the rest pose is a T-pose: arms straight out to the sides. Avatar
  Diagnostics shows the measured rest pose under Motion ("Rest pose"); the
  Gesture renders below show the arms after Animama's normalization, so they
  do not reveal an A-pose export;
- the ARKit count is complete, with any renamed matches as expected, and
  inspect's "mood faces (brow/eye/mouth)" list shows every mood region played
  from an MMD morph (`mmd`) or an ARKit mix (`arkit`);
- "blink and visemes" lists no `none` (an empty preset with no MMD, ARKit or
  VRChat shape to fill it), and "face parts" finds `face_skin` and both eyes.

An export without blink or viseme presets still blinks and speaks: Animama
fills them at load from the `vrc.blink_*` and `vrc.v_*` shapes, MMD or ARKit
shapes ([Faces on non-VRoid Avatars](avatar-emotion.md#faces-on-non-vroid-avatars)).
Eyes modelled inside the face mesh are placed from blinking or the eye bones
and show as estimated ([Eyes without
geometry](avatar-vfx.md#eyes-without-geometry)), and Gestures use stand-in
bones for an upper chest or finger segments the rig lacks ([Optional bones a
rig lacks](avatar-animation.md#optional-bones-a-rig-lacks)).

`pnpm -s animation:render <gesture.json> --out <private-dir> --avatar-file
<private-dir>/<Avatar>.vrm` draws Gesture review sheets on it, and
`pnpm -s effects:bench --avatar-file <private-dir>/<Avatar>.vrm` measures its
frame cost on the GPU. Add `--saturate 10 --breakdown all` to break that cost
down by material, lilToon feature and layer at the GPU's top clock (paced runs
understate savings; see
[frame-cost benchmark](avatar-vfx.md#frame-cost-benchmark)).

Then upload it as a Local Avatar on a local stack, for example by choosing it
in Create Anima (Upload VRM), and check motion, springs, blink, visemes and
look-at in the chat canvas. Correct its face parts in the Avatar Effect
creator's Face parts panel if needed. The Anima's [Avatar
diagnostics](../features/anima-management.md#avatar-diagnostics) list what
Animama found (required extensions, face parts, ARKit coverage, springs and
warnings); their copied report holds no paths or names, so it can be shared
for a private Avatar.

Known limits of a Mochiya 0.1.6 export:

- Materials render with the authored lilToon settings through three-liltoon
  ([Authored lilToon materials](avatar-animation.md#authored-liltoon-materials)).
  That costs far more GPU time per frame than MToon; the Avatar's Materials
  setting can choose the cheaper glTF fallback materials (Simple). The exporter
  writes `metallicFactor` 1 on those fallbacks, so Animama draws them, like
  every lit glTF material, with metalness 0; the `vrm:optimize` compare page
  uses its own loader and still shows them much darker than in Unity.
- Vertex colours are not exported: UniVRM's VRM 1.0 mesh writer (0.131.2)
  writes positions, normals, the first UV set, skinning and morph targets
  only. lilToon
  outlines that read baked vertex colours (`_OutlineVertexR2Width` 2, common
  on hair) therefore fall back to the mesh normal in Animama, so their tips
  draw a little heavier than in Unity (see
  [Outlines from vertex colours](avatar-animation.md#authored-liltoon-materials)).
- Authored blendshape weights are not exported either. A shape key a VRChat
  Avatar keeps at a non-zero weight (for example one that keeps an accessory
  clear of clothing) is at zero in the VRM, so that part can sit differently
  than in Unity.
- PhysBone gravity converts to very small VRM gravity values, and the springs
  rely on the shape they were modelled in. Animama therefore adds no wind or
  updraft to Avatars converted by Mochiya under the Automatic wind setting (see
  [`SpringBonePhysicsController`](avatar-animation.md#springbonephysicscontroller)).
  It recognises them by the `MOCHIYA_avatar_composition` extension, so keep
  it: a tool that drops unknown extensions on re-export brings the updraft
  back.

Review renders work on the private file directly:
`pnpm -s effects:render --with-clip library:<gesture> --avatar-file <private-dir>/<Avatar>.vrm --out <private-dir>/renders/<gesture>.png`.
Keep those renders private as well.

Effects painted onto the face texture (blush, tears, iris overlays such as
star eyes) find the face's own UV island and each iris's texture rectangle,
so they also work on Avatars whose face shares a texture atlas with the body
and whose eye layers share one mesh, as many converted Avatars' do (see
[Painted effects](avatar-vfx.md#painted-effects-face_surface)). Mouth decals
can sit slightly low on such a face. Whole-face art (`face_red`,
`petrified_cracks`, `texture_*`) is clipped to the face skin's own triangles,
so on an atlas it leaves the other parts drawn from that texture (body, inner
mouth, eyes) untouched. That art is laid out for VRoid's dedicated face
texture, so on a small face island it shows mostly its tone: the crack lines
fall outside the face.

To make the file emote in other VRM apps as well, bake its mood presets into a
copy with `pnpm -s vrm:bake-expressions` (see
[Faces on non-VRoid Avatars](avatar-emotion.md#faces-on-non-vroid-avatars)).

## Compare with Unity

To check how closely Animama draws an Avatar's lilToon materials, render the
same views in both:

1. `pnpm -s avatar:parity-render --avatar-file <private-dir>/<Avatar>.vrm
   --out <private-dir>/parity` (from `src/frontend/web`) draws the rest pose
   from the front, the face and the face from its right, with one white key
   light and white ambient light, no tone mapping, on SwiftShader. It writes
   `animama-<view>.png` and `views.json` (cameras and lights in three.js
   coordinates).
2. Copy `scripts/avatars/unity/AnimamaReferenceRender.cs` and
   `Animama.ReferenceRender.asmdef` into the Unity project's
   `Assets/AnimamaReferenceRender/Editor/` and run, with graphics,
   `Unity -batchmode -quit -projectPath <project> -logFile render.log
   -executeMethod AnimamaReferenceRender.Render -animamaPrefab
   Assets/.../Avatar.prefab -animamaViews <private-dir>/parity/views.json
   -animamaOutDir <private-dir>/parity/unity`. It poses the prefab as the
   export does and renders each view with the same camera and lights; its
   ambient is barely directional, because lilToon's lighting is undefined for
   a perfectly uniform ambient.
3. Compare with `pnpm -s effects:render --diff <animama.png> <unity.png>
   --threshold 8`. Lit areas should match to within a step or two. Known
   differences: the export limits above, outline and silhouette edges, and a
   faint MatCap highlight some hair materials show in Unity but not in
   Animama (cause not yet known).

These renders show a third-party Avatar: keep them private.

## Sharing a converted Avatar

Share an Avatar only when its licence allows redistribution; most VN3 terms
forbid it (see [Licence first](#licence-first)). When it does, Library sharing
exports it like any Local Avatar. Packages accept Mochiya's
`MOCHIYA_avatar_composition` and `MOCHIYA_materials_liltoon` extensions, so
the receiver gets the same lilToon materials and spring handling. They also
accept both mesh compressions an optimizer may add
([Avatar files in packages](../../backend/features/custom-animas-and-content.md#avatar-files-in-packages)):

- `EXT_meshopt_compression` (gltfpack, gltf-transform `meshopt`) loads: every
  Avatar loader imports three's meshopt decoder when a file uses it
  (`configureAvatarGltfLoader`). Its WebAssembly is embedded in the module, so
  the page's Content Security Policy must allow `'wasm-unsafe-eval'`, as the
  [app's policy](../architecture/auth-server.md#content-security-policy) does.
- `KHR_draco_mesh_compression` imports, but Animama does not serve the Draco
  decoder yet, so the Avatar does not load. The import review says so before
  the import, and its Diagnostics name the extension
  (`avatar_extension_unsupported`). Compress with meshopt instead.

Any other extension a file requires that the runtime cannot load
(`LOADABLE_GLTF_EXTENSIONS` in `lib/avatar/diagnostics/avatarGltfExtensions.ts`)
also fails the load with that finding, rather than drawing the Avatar without
it. Diagnostics reads it from the file before loading, so it shows for an
upload in Create Anima, an Avatar in the Library and an Anima's Avatar alike.
