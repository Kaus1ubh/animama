# Converting a VRChat Avatar

Animama loads VRM files. An Avatar sold for VRChat (a Unity Avatar 3.0 prefab)
reaches it through a VRM 1.0 export with
[Mochiya Avatar Tools](https://github.com/mochiya-labs/unity-avatar-tools). The
export keeps the humanoid rig, approximates PhysBones as VRM spring bones, maps
the VRChat visemes, blink and look-at, and carries the lilToon material settings
in a `MOCHIYA_materials_liltoon` extension. Face shapes keep their names, so
Animama finds the Avatar's ARKit shapes
([ARKit face shapes](avatar-animation.md#arkit-face-shapes)) and plays emotions
through them ([ARKit Avatars](avatar-emotion.md#arkit-avatars)).

## Licence first

Read the Avatar's licence before converting it. Many BOOTH Avatars use the VN3
licence, which allows format conversion for your own use but forbids
redistributing the data or edited versions.

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

Close the project in the Unity editor first; batch mode cannot open a project
that is already open. Then validate:

```bash
Unity -batchmode -nographics -quit -projectPath <project> -logFile validate.log \
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

Export writes a new file and refuses to overwrite one:

```bash
Unity -batchmode -nographics -quit -projectPath <project> -logFile export.log \
  -executeMethod AnimamaBatchExport.Export \
  -animamaPrefab Assets/<Avatar>/Prefabs/<Avatar>.prefab \
  -animamaOut <private-dir>/<Avatar>.vrm \
  -animamaName <Avatar> -animamaVersion <version> -animamaAuthor <author> \
  -animamaCopyright "<credit>"
```

The metadata arguments fill `VRMC_vrm.meta`. Its permissions stay at UniVRM's
restrictive defaults: only the author may use the Avatar, and redistribution and
modification are prohibited.

## Check the export

From `src/frontend/web`:

```bash
pnpm -s vrm:inspect <private-dir>/<Avatar>.vrm
```

Check that:

- the file is VRM 1.0 and under the 100 MiB upload limit (otherwise run
  `pnpm -s vrm:optimize`, then inspect again to confirm
  `MOCHIYA_materials_liltoon` survived);
- every face mesh stores its names at mesh level, not "primitives only";
- the ARKit count is complete, with any renamed matches as expected.

Then upload it as a Local Avatar on a local stack, for example by choosing it
in Create Anima (Upload VRM), and check motion, springs, blink, visemes and
look-at in the chat canvas. Correct its face parts in the Avatar Effect
creator's Face parts panel if needed.

Known limits of a Mochiya 0.1.4 export:

- Materials render with Animama's glTF fallback. The exporter leaves glTF's
  default `metallicFactor` of 1 on every fallback material, so the Avatar looks
  much darker than in Unity. The authored lilToon look needs lilToon rendering.
- PhysBone gravity converts to very small VRM gravity values. Hair and cloth
  then hold their modelled rest pose, and Animama's subtle spring updraft can
  lift them; a ponytail may stand up and a jacket hem flare out.

To make the file emote in other VRM apps as well, bake its mood presets into a
copy with `pnpm -s vrm:bake-expressions` (see
[ARKit Avatars](avatar-emotion.md#arkit-avatars)).
