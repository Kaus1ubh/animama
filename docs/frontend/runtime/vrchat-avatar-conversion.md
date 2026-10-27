# Converting a VRChat Avatar

Animama loads VRM files. An Avatar sold for VRChat (a Unity Avatar 3.0 prefab)
reaches it through a VRM 1.0 export with
[Mochiya Avatar Tools](https://github.com/mochiya-labs/unity-avatar-tools). The
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
- Never use Mochiya's "Upload to Mochiya" feature on a licensed Avatar. The batch
  script below calls only Detect, Validate and Export.

## Tools

Use these versions together; they match three-liltoon's compatibility table.

| Component | Version |
| --- | --- |
| Unity | 2022.3 LTS (verified with 2022.3.62f3 on Apple Silicon) |
| VRChat SDK | The Avatars template from VRChat Creator Companion |
| lilToon | 2.3.4 or later (`jp.lilxyzw.liltoon`) |
| UniGLTF and VRM10 (UniVRM) | `v0.131.2` |
| Mochiya Avatar Tools | 0.1.4 (commit `d98e9091`; the repository has no tags) |

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
3. Replace lilToon with 2.3.4 or later: delete `Assets/lilToon` and add
   `jp.lilxyzw.liltoon` from the lilToon VPM repository
   (`https://lilxyzw.github.io/vpm-repos/vpm.json`).
4. Add the converter packages to `Packages/manifest.json`:

   ```json
   "com.vrmc.gltf": "https://github.com/vrm-c/UniVRM.git?path=/Packages/UniGLTF#v0.131.2",
   "com.vrmc.vrm": "https://github.com/vrm-c/UniVRM.git?path=/Packages/VRM10#v0.131.2",
   "org.mochiya.avatar-tools": "https://github.com/mochiya-labs/unity-avatar-tools.git#d98e9091ab22c305a2661be78911b275a1cd3092"
   ```

5. Copy `scripts/avatars/unity/AnimamaBatchExport.cs` and
   `Animama.BatchExport.asmdef` from this repository into the project's
   `Assets/AnimamaExport/Editor/`. The assembly definition gives the script
   access to the Mochiya and VRM editor assemblies.

## Validate and export

Pick the prefab the Avatar should look like. Many Avatars ship variants, such
as a prefab variant without the jacket; each export captures one prefab.

Close the project in the Unity editor first; batch mode cannot open a project
that is already open. `Unity` below is the editor binary; on macOS it lives in
the Hub's install folder, for example
`/Applications/Unity/Hub/Editor/<version>/Unity.app/Contents/MacOS/Unity`.
Then validate:

```bash
Unity -batchmode -quit -projectPath <project> -logFile validate.log \
  -executeMethod AnimamaBatchExport.Validate \
  -animamaPrefab Assets/<Avatar>/Prefabs/<Avatar>.prefab \
  -animamaName <Avatar> -animamaVersion <version> -animamaAuthor <author> \
  -animamaCopyright "<credit>"
```

The `[Animama]` lines in the log list Mochiya's report. Errors stop the export.
Expect these warnings:

- **Animator state machines:** VRChat's animator state machines (gesture
  expressions, toggles) are not converted. Animama drives faces itself.
- **Visemes and blink:** visemes, eyelid shapes and eye ranges become VRM
  presets and look-at.
- **PhysBones:** each one becomes a VRM spring. Grabbing, stretching and angle
  limits are lost, and gravity falloff is baked into the rest pose.
- **Colliders:** plane colliders are omitted, and inside-bounds colliders become
  outside colliders.

Export writes a new file and refuses to overwrite one. Do not pass
`-nographics`: the exporter reads compressed textures back through the GPU,
and without one it writes flat grey placeholders (19 of Lapwing's 26 textures,
including the hair colour).

```bash
Unity -batchmode -quit -projectPath <project> -logFile export.log \
  -executeMethod AnimamaBatchExport.Export \
  -animamaPrefab Assets/<Avatar>/Prefabs/<Avatar>.prefab \
  -animamaOut <private-dir>/<Avatar>.vrm \
  -animamaName <Avatar> -animamaVersion <version> -animamaAuthor <author> \
  -animamaCopyright "<credit>"
```

VRM 1.0 requires a T-pose rest pose, and VRChat Avatars are often modelled in
an A-pose. The script therefore poses the instance from its Unity humanoid
T-pose first, like UniVRM's "T-Pose (unity internal)" button, and logs
`Applied the humanoid T-pose`. Pass `-animamaKeepPose` to export the modelled
pose instead. Animama normalizes arms that rest 10° or more from a T-pose when
it loads them
([Rest normalization](avatar-animation.md#rest-normalization)), so an A-pose
export still plays Gestures with its arms where a T-pose export's go, but other
VRM tools expect the T-pose.

The metadata arguments fill `VRMC_vrm.meta`. Its permissions stay at UniVRM's
restrictive defaults: only the author may use the Avatar, and redistribution and
modification are prohibited.

## Check the export

From `src/frontend/web`:

```bash
pnpm -s vrm:inspect <private-dir>/<Avatar>.vrm
```

Check that:

- no texture is a flat colour (a sign of a `-nographics` export);
- the file is VRM 1.0 and under the 100 MiB upload limit. `vrm:optimize` does
  not support Mochiya's extensions, so reduce an oversized Avatar's textures in
  Unity and export again;
- every face mesh stores its names at mesh level, not "primitives only";
- the rest pose is a T-pose: arms straight out to the sides. Avatar
  Diagnostics shows the measured rest pose under Motion ("Rest pose"); the
  Gesture renders below show the arms after Animama's normalization, so they
  do not reveal an A-pose export;
- the ARKit count is complete, with any renamed matches as expected, and
  inspect's "mood faces (brow/eye/mouth)" list shows every mood region played
  from an MMD morph (`mmd`) or an ARKit mix (`arkit`).

`pnpm -s animation:render <gesture.json> --out <private-dir> --avatar-file
<private-dir>/<Avatar>.vrm` draws Gesture review sheets on it, and
`pnpm -s effects:bench --avatar-file <private-dir>/<Avatar>.vrm` measures its
frame cost on the GPU. Add `--fps 60 --breakdown all` to break that cost down
by material, lilToon feature and layer.

Then upload it as a Local Avatar on a local stack, for example by choosing it
in Create Anima (Upload VRM), and check motion, springs, blink, visemes and
look-at in the chat canvas. Correct its face parts in the Avatar Effect
creator's Face parts panel if needed. The Anima's [Avatar
diagnostics](../features/anima-management.md#avatar-diagnostics) list what
Animama found (required extensions, face parts, ARKit coverage, springs and
warnings); their copied report holds no paths or names, so it can be shared
for a private Avatar.

Known limits of a Mochiya 0.1.4 export:

- Materials render with the authored lilToon settings through three-liltoon
  ([Authored lilToon materials](avatar-animation.md#authored-liltoon-materials)).
  That costs far more GPU time per frame than MToon; the Avatar's Materials
  setting can choose the cheaper glTF fallback materials (Simple). The exporter
  writes `metallicFactor` 1 on those fallbacks, so Animama draws them with
  metalness 0; the `vrm:optimize` compare page uses its own loader and still
  shows them much darker than in Unity.
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
mouth, eyes) untouched.

To make the file emote in other VRM apps as well, bake its mood presets into a
copy with `pnpm -s vrm:bake-expressions` (see
[Faces on non-VRoid Avatars](avatar-emotion.md#faces-on-non-vroid-avatars)).

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
  the page's CSP must allow `'wasm-unsafe-eval'` (the app's does).
- `KHR_draco_mesh_compression` imports, but Animama does not serve the Draco
  decoder yet, so the Avatar does not load. The import review says so before
  the import, and its Diagnostics name the extension
  (`avatar_extension_unsupported`). Compress with meshopt instead.

Any other extension a file requires that the runtime cannot load
(`LOADABLE_GLTF_EXTENSIONS` in `lib/avatar/diagnostics/avatarGltfExtensions.ts`)
also fails the load with that finding, rather than drawing the Avatar without
it. Diagnostics reads it from the file before loading, so it shows for an
upload in Create Anima, an Avatar in the Library and an Anima's Avatar alike.
