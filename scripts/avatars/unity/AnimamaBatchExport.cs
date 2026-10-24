// Batch entry points for converting a VRChat avatar prefab to VRM 1.0 with
// Mochiya Avatar Tools, for use in Animama. Copy this file and
// Animama.BatchExport.asmdef into the Unity project's
// Assets/AnimamaExport/Editor/; see
// docs/frontend/runtime/vrchat-avatar-conversion.md.
//
//   Unity -batchmode -quit -projectPath <project> \
//     -executeMethod AnimamaBatchExport.Validate|Export \
//     -animamaPrefab Assets/.../Avatar.prefab -animamaOut /abs/path/Avatar.vrm
//
// Never uploads anything: it calls only Detect, Validate and Export.
using System;
using System.Collections.Generic;
using System.IO;
using Mochiya.AvatarTools.Editor;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

public static class AnimamaBatchExport
{
    public static void Validate() => Run(export: false);

    public static void Export() => Run(export: true);

    private static void Run(bool export)
    {
        var prefabPath = Arg("-animamaPrefab");
        var outPath = Arg("-animamaOut");
        try
        {
            if (string.IsNullOrEmpty(prefabPath)) throw new ArgumentException("-animamaPrefab is required.");
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath)
                ?? throw new FileNotFoundException("Prefab not found: " + prefabPath);

            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var root = (GameObject)PrefabUtility.InstantiatePrefab(prefab);

            var target = MochiyaAvatarWorkflow.Detect(root);
            Debug.Log($"[Animama] Detect: kind={target.Kind} prepared={target.IsPrepared} reason={target.Reason} error={target.Error}");

            var profile = ScriptableObject.CreateInstance<MochiyaExportProfile>();
            profile.Metadata.Name = Arg("-animamaName") ?? prefab.name;
            profile.Metadata.Version = Arg("-animamaVersion") ?? "1.0";
            profile.Metadata.Authors = new List<string> { Arg("-animamaAuthor") ?? MochiyaExportProfile.DefaultAuthor };
            profile.Metadata.CopyrightInformation = Arg("-animamaCopyright") ?? "";

            var report = MochiyaAvatarWorkflow.Validate(root, true, profile);
            Debug.Log("[Animama] Validate:\n" + report);
            if (!report.CanConvert) { EditorApplication.Exit(2); return; }

            if (export)
            {
                if (string.IsNullOrEmpty(outPath)) throw new ArgumentException("-animamaOut is required for Export.");
                if (File.Exists(outPath)) throw new IOException("Output exists; choose a new path: " + outPath);
                var exported = MochiyaAvatarWorkflow.Export(root, outPath, profile);
                Debug.Log("[Animama] Export report:\n" + exported);
                Debug.Log($"[Animama] Wrote {outPath} ({new FileInfo(outPath).Length} bytes)");
            }
            EditorApplication.Exit(0);
        }
        catch (Exception error)
        {
            Debug.LogError("[Animama] Failed: " + error);
            EditorApplication.Exit(1);
        }
    }

    private static string Arg(string name)
    {
        var args = Environment.GetCommandLineArgs();
        var index = Array.IndexOf(args, name);
        return index >= 0 && index + 1 < args.Length ? args[index + 1] : null;
    }
}
