// Batch entry point that renders a VRChat avatar prefab in Unity for comparing
// its lilToon materials with Animama's (three-liltoon). Copy this file and
// Animama.ReferenceRender.asmdef into the Unity project's
// Assets/AnimamaReferenceRender/Editor/ (the project needs UniGLTF, which the
// export package installs); see docs/frontend/runtime/vrchat-avatar-conversion.md.
//
//   Unity -batchmode -quit -projectPath <project> \   (no -nographics: the
//                                                        renders need the GPU)
//     -executeMethod AnimamaReferenceRender.Render \
//     -animamaPrefab Assets/.../Avatar.prefab -animamaViews /abs/views.json \
//     -animamaOutDir /abs/dir
//
// views.json is what `pnpm -s avatar:parity-render` writes beside its own
// renders: per view a name, the drawing size, and a camera (position, target,
// vertical field of view in degrees) and lights (one directional light's
// direction toward the light and linear colour, and the linear ambient colour
// lilToon receives) in three.js world coordinates. The avatar is posed exactly
// as for export (UniVRM's humanoid T-pose unless -animamaKeepPose), so the
// exported VRM's rest pose matches. Writes <outDir>/<name>.png per view.
using System;
using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;

public static class AnimamaReferenceRender
{
    [Serializable]
    private class Views { public View[] views; }

    [Serializable]
    private class View
    {
        public string name;
        public int width;
        public int height;
        public float[] cameraPosition;
        public float[] cameraTarget;
        public float fov;
        public float[] lightDirection;
        public float[] lightColor;
        public float[] ambientColor;
        public float[] background;
    }

    public static void Render()
    {
        try
        {
            var prefabPath = Arg("-animamaPrefab") ?? throw new ArgumentException("-animamaPrefab is required.");
            var viewsPath = Arg("-animamaViews") ?? throw new ArgumentException("-animamaViews is required.");
            var outDir = Arg("-animamaOutDir") ?? throw new ArgumentException("-animamaOutDir is required.");
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath)
                ?? throw new FileNotFoundException("Prefab not found: " + prefabPath);
            if (QualitySettings.activeColorSpace != ColorSpace.Linear)
                throw new InvalidOperationException("The project must use the Linear colour space (VRChat projects do); the colour conversions assume it.");
            var views = JsonUtility.FromJson<Views>(File.ReadAllText(viewsPath));
            Directory.CreateDirectory(outDir);

            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var root = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
            root.transform.SetPositionAndRotation(Vector3.zero, Quaternion.identity);
            if (!HasArg("-animamaKeepPose") && !UniGLTF.InternalTPose.TryMakePoseValid(root))
                throw new InvalidOperationException("Could not apply the humanoid T-pose; pass -animamaKeepPose to render the modelled pose.");

            var lightObject = new GameObject("Animama key light");
            var light = lightObject.AddComponent<Light>();
            light.type = LightType.Directional;
            light.shadows = LightShadows.None;
            // A per-pixel main light, as three-liltoon's directional light is,
            // whatever the quality level's pixel light count.
            light.renderMode = LightRenderMode.ForcePixel;
            light.intensity = 1;
            var cameraObject = new GameObject("Animama camera");
            var camera = cameraObject.AddComponent<Camera>();
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.nearClipPlane = 0.01f;
            camera.farClipPlane = 20;
            camera.allowMSAA = true;
            RenderSettings.fog = false;
            // No reflection probe: three-liltoon binds no environment cubemap
            // unless the scene has one.
            RenderSettings.defaultReflectionMode = DefaultReflectionMode.Custom;
            RenderSettings.customReflectionTexture = null;

            foreach (var view in views.views)
            {
                // three.js (glTF, VRM 1.0) and Unity differ by a mirrored X axis.
                camera.transform.position = FromThree(view.cameraPosition);
                camera.transform.LookAt(FromThree(view.cameraTarget), Vector3.up);
                camera.fieldOfView = view.fov;
                camera.aspect = (float)view.width / view.height;
                camera.backgroundColor = LinearColor(view.background).gamma;
                light.transform.rotation = Quaternion.LookRotation(-FromThree(view.lightDirection).normalized);
                // Colours arrive linear, as lilToon receives them in three-liltoon.
                light.color = LinearColor(view.lightColor).gamma;
                // Barely directional ambient (sky 1% brighter than the
                // ground): three-liltoon supplies only the constant SH term,
                // and lilToon's OpenLit normalizes the SH direction, which is
                // undefined for a perfectly flat ambient in Unity (NaN). With
                // a vanishing direction Unity's result tends to the constant
                // term, which is what Animama's three-liltoon patch uses.
                var ambient = LinearColor(view.ambientColor);
                RenderSettings.ambientMode = AmbientMode.Trilight;
                RenderSettings.ambientSkyColor = (ambient * 1.01f).gamma;
                RenderSettings.ambientEquatorColor = ambient.gamma;
                RenderSettings.ambientGroundColor = (ambient * 0.99f).gamma;
                DynamicGI.UpdateEnvironment();

                var target = new RenderTexture(view.width, view.height, 24, RenderTextureFormat.ARGB32, RenderTextureReadWrite.sRGB)
                {
                    antiAliasing = 4,
                };
                camera.targetTexture = target;
                camera.Render();
                RenderTexture.active = target;
                // RGB only: Animama's parity canvas is opaque, and cutout edges
                // could otherwise leave partial alpha in Unity's target.
                var image = new Texture2D(view.width, view.height, TextureFormat.RGB24, false);
                image.ReadPixels(new Rect(0, 0, view.width, view.height), 0, 0);
                image.Apply();
                RenderTexture.active = null;
                camera.targetTexture = null;
                File.WriteAllBytes(Path.Combine(outDir, view.name + ".png"), image.EncodeToPNG());
                UnityEngine.Object.DestroyImmediate(image);
                target.Release();
                Debug.Log($"[Animama] Rendered {view.name} ({view.width}x{view.height})");
            }
            EditorApplication.Exit(0);
        }
        catch (Exception error)
        {
            Debug.LogError("[Animama] Failed: " + error);
            EditorApplication.Exit(1);
        }
    }

    private static Vector3 FromThree(float[] v) => new Vector3(-v[0], v[1], v[2]);

    private static Color LinearColor(float[] c) => new Color(c[0], c[1], c[2], c.Length > 3 ? c[3] : 1);

    private static bool HasArg(string name) => Array.IndexOf(Environment.GetCommandLineArgs(), name) >= 0;

    private static string Arg(string name)
    {
        var args = Environment.GetCommandLineArgs();
        var index = Array.IndexOf(args, name);
        return index >= 0 && index + 1 < args.Length ? args[index + 1] : null;
    }
}
