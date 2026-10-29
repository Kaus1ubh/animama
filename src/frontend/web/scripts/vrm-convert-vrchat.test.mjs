import assert from "node:assert/strict";
import { test } from "node:test";

import {
  defaultUnityEditor,
  exportLines,
  outputPaths,
  parseArgs,
  sameScript,
  unityArgs,
} from "./vrm-convert-vrchat.mjs";

const REQUIRED = [
  "--project",
  "/unity/Avatar",
  "--prefab",
  "Assets/Avatar/Avatar.prefab",
  "--out",
  "/private/Avatar.vrm",
];

test("the CLI requires a project, a prefab and a .vrm output, and refuses unknown options", () => {
  const { options, flags } = parseArgs([...REQUIRED, "--keep-pose"]);
  assert.equal(options.project, "/unity/Avatar");
  assert.equal(options.prefab, "Assets/Avatar/Avatar.prefab");
  assert.equal(flags.keepPose, true);
  assert.equal(flags.optimize, true);
  assert.equal(parseArgs([...REQUIRED, "--no-optimize"]).flags.optimize, false);

  assert.throws(() => parseArgs(REQUIRED.slice(2)), /--project is required/);
  assert.throws(
    () => parseArgs([...REQUIRED.slice(0, 4), "--out", "/private/Avatar.glb"]),
    /--out must end in \.vrm/,
  );
  assert.throws(
    () => parseArgs([...REQUIRED, "--nographics"]),
    /Unknown option --nographics/,
  );
  assert.throws(
    () => parseArgs([...REQUIRED, "--name"]),
    /--name needs a value/,
  );
  assert.equal(parseArgs(["--help"]).flags.help, true);
});

test("an optimized conversion keeps the raw export beside it; --no-optimize writes one file", () => {
  assert.deepEqual(outputPaths("/private/Avatar.vrm", true), {
    final: "/private/Avatar.vrm",
    raw: "/private/Avatar.raw.vrm",
    log: "/private/Avatar.export.log",
  });
  assert.deepEqual(outputPaths("/private/Avatar.vrm", false), {
    final: "/private/Avatar.vrm",
    raw: "/private/Avatar.vrm",
    log: "/private/Avatar.export.log",
  });
});

test("the default editor is the project's version in the Unity Hub folder", () => {
  assert.equal(
    defaultUnityEditor("2022.3.62f3", "darwin"),
    "/Applications/Unity/Hub/Editor/2022.3.62f3/Unity.app/Contents/MacOS/Unity",
  );
  assert.equal(
    defaultUnityEditor("2022.3.62f3", "win32"),
    "C:\\Program Files\\Unity\\Hub\\Editor\\2022.3.62f3\\Editor\\Unity.exe",
  );
  assert.equal(defaultUnityEditor("2022.3.62f3", "linux"), null);
});

test("Unity runs the batch export with the GPU and only the arguments given", () => {
  const args = unityArgs({
    project: "/unity/Avatar",
    prefab: "Assets/Avatar/Avatar.prefab",
    raw: "/private/Avatar.raw.vrm",
    log: "/private/Avatar.export.log",
    meta: { name: "Avatar", author: "Author" },
    keepPose: false,
    validate: false,
  });
  assert.ok(!args.includes("-nographics"));
  assert.deepEqual(args, [
    "-batchmode",
    "-quit",
    "-projectPath",
    "/unity/Avatar",
    "-logFile",
    "/private/Avatar.export.log",
    "-executeMethod",
    "AnimamaBatchExport.Export",
    "-animamaPrefab",
    "Assets/Avatar/Avatar.prefab",
    "-animamaOut",
    "/private/Avatar.raw.vrm",
    "-animamaName",
    "Avatar",
    "-animamaAuthor",
    "Author",
  ]);

  const validate = unityArgs({
    project: "/unity/Avatar",
    prefab: "Assets/Avatar/Avatar.prefab",
    raw: "/private/Avatar.raw.vrm",
    log: "/private/Avatar.export.log",
    meta: {},
    keepPose: true,
    validate: true,
  });
  assert.equal(
    validate[validate.indexOf("-executeMethod") + 1],
    "AnimamaBatchExport.Validate",
  );
  assert.ok(!validate.includes("-animamaOut"));
  assert.ok(validate.includes("-animamaKeepPose"));
});

test("the log summary keeps every export line and the whole Validate report", () => {
  const log = [
    "Unity Editor version: 2022.3.62f3",
    "[Animama] Stripped EditorOnly object Jacket",
    "UnityEngine.Debug:Log (object)",
    "[Animama] Validate:",
    "Unsupported: Avatar: animator state machines are not executed by VRM.",
    "Warning: Hair: PhysBone motion is approximated with VRM springs.",
    "UnityEngine.StackTraceUtility:ExtractStackTrace ()",
    "[Animama] Export report:",
    "Warning: Hair: PhysBone motion is approximated with VRM springs.",
    "UnityEngine.StackTraceUtility:ExtractStackTrace ()",
  ].join("\n");
  assert.equal(
    exportLines(log),
    [
      "[Animama] Stripped EditorOnly object Jacket",
      "[Animama] Validate:",
      "  Unsupported: Avatar: animator state machines are not executed by VRM.",
      "  Warning: Hair: PhysBone motion is approximated with VRM springs.",
      "[Animama] Export report:",
    ].join("\n"),
  );
});

test("the project's copy of the export script must match the repository's", () => {
  assert.ok(sameScript("line one\r\nline two\r\n", "line one\nline two\n"));
  assert.ok(!sameScript("line one\n", "line one\nline two\n"));
});
