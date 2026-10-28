import { spawn } from "node:child_process";
import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Convert a VRChat Avatar prefab to a VRM for Animama in one command:
 *
 *   pnpm -s vrm:convert-vrchat --project <unity-project> --prefab <Assets/…/Avatar.prefab> \
 *     --out <private-dir>/<Avatar>.vrm [--name <name>] [--version <version>] \
 *     [--author <author>] [--copyright <credit>] [--keep-pose] [--no-optimize] \
 *     [--validate] [--unity <editor>]
 *
 * It runs the Unity batch export (`scripts/avatars/unity/AnimamaBatchExport.cs`,
 * T-pose unless --keep-pose), then `vrm:optimize`, keeping the raw export
 * beside the result as `<Avatar>.raw.vrm`, then `vrm:inspect`. --no-optimize
 * writes the raw export to --out; --validate only runs Mochiya's validation.
 * The Unity log goes to `<Avatar>.export.log`. See
 * docs/frontend/runtime/vrchat-avatar-conversion.md.
 */

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const repoScript = path.resolve(
  webRoot,
  "../../../scripts/avatars/unity/AnimamaBatchExport.cs",
);
const USAGE = [
  "Usage:",
  "  pnpm -s vrm:convert-vrchat --project <unity-project> --prefab <Assets/…/Avatar.prefab>",
  "    --out <Avatar>.vrm [--name <name>] [--version <version>] [--author <author>]",
  "    [--copyright <credit>] [--keep-pose] [--no-optimize] [--validate] [--unity <editor>]",
].join("\n");

const VALUE_OPTIONS = [
  "project",
  "prefab",
  "out",
  "unity",
  "name",
  "version",
  "author",
  "copyright",
];
const FLAG_OPTIONS = ["keep-pose", "no-optimize", "validate", "help"];
/** VRM metadata options and the batch export arguments that carry them. */
const META_ARGUMENTS = {
  name: "-animamaName",
  version: "-animamaVersion",
  author: "-animamaAuthor",
  copyright: "-animamaCopyright",
};

/** Parse the command line; unknown or incomplete options are errors, not ignored. */
export function parseArgs(argv) {
  const options = {};
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const name = argument.startsWith("--") ? argument.slice(2) : null;
    if (name && FLAG_OPTIONS.includes(name)) seen.add(name);
    else if (name && VALUE_OPTIONS.includes(name)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--"))
        throw new Error(`--${name} needs a value.\n\n${USAGE}`);
      options[name] = value;
      index += 1;
    } else
      throw new Error(
        `${name ? `Unknown option --${name}` : `Unexpected argument ${argument}`}.\n\n${USAGE}`,
      );
  }
  const flags = {
    help: seen.has("help"),
    keepPose: seen.has("keep-pose"),
    optimize: !seen.has("no-optimize"),
    validate: seen.has("validate"),
  };
  if (!flags.help) {
    for (const required of ["project", "prefab", "out"]) {
      if (!options[required])
        throw new Error(`--${required} is required.\n\n${USAGE}`);
    }
    if (!options.out.toLowerCase().endsWith(".vrm"))
      throw new Error(`--out must end in .vrm.\n\n${USAGE}`);
  }
  return { options, flags };
}

/** The finished VRM, the raw Unity export and the Unity log for an --out path. */
export function outputPaths(out, optimize) {
  const stem = out.slice(0, -".vrm".length);
  return {
    final: out,
    raw: optimize ? `${stem}.raw.vrm` : out,
    log: `${stem}.export.log`,
  };
}

/** Where Unity Hub installs an editor version, or null where it has no default. */
export function defaultUnityEditor(version, platform) {
  if (platform === "darwin")
    return `/Applications/Unity/Hub/Editor/${version}/Unity.app/Contents/MacOS/Unity`;
  if (platform === "win32")
    return `C:\\Program Files\\Unity\\Hub\\Editor\\${version}\\Editor\\Unity.exe`;
  return null;
}

/**
 * The batch export's command line. Never -nographics: the exporter reads
 * compressed textures back through the GPU and writes flat grey without one.
 */
export function unityArgs({
  project,
  prefab,
  raw,
  log,
  meta,
  keepPose,
  validate,
}) {
  const args = [
    "-batchmode",
    "-quit",
    "-projectPath",
    project,
    "-logFile",
    log,
    "-executeMethod",
    validate ? "AnimamaBatchExport.Validate" : "AnimamaBatchExport.Export",
    "-animamaPrefab",
    prefab,
  ];
  if (!validate) args.push("-animamaOut", raw);
  for (const [key, argument] of Object.entries(META_ARGUMENTS)) {
    if (meta[key]) args.push(argument, meta[key]);
  }
  if (keepPose) args.push("-animamaKeepPose");
  return args;
}

/** Whether two copies of the export script match, ignoring line endings. */
export function sameScript(projectCopy, repoCopy) {
  const normalise = (text) => text.replace(/\r\n/g, "\n");
  return normalise(projectCopy) === normalise(repoCopy);
}

const exists = (file) =>
  access(file).then(
    () => true,
    () => false,
  );

/** The Unity editor to run: --unity, ANIMAMA_UNITY_EDITOR, or the project's Hub version. */
async function resolveUnityEditor(project, explicit) {
  const configured = explicit ?? process.env.ANIMAMA_UNITY_EDITOR;
  if (configured) return configured;
  const versionFile = path.join(project, "ProjectSettings/ProjectVersion.txt");
  const version = /m_EditorVersion:\s*(\S+)/.exec(
    await readFile(versionFile, "utf8"),
  )?.[1];
  const editor = version && defaultUnityEditor(version, process.platform);
  if (!editor || !(await exists(editor)))
    throw new Error(
      `Unity ${version ?? "(unknown version)"} was not found; pass --unity <editor> or set ANIMAMA_UNITY_EDITOR.`,
    );
  return editor;
}

/** Refuse a project whose copy of the export script differs from the repository's. */
async function checkProjectScript(project) {
  const projectScript = path.join(
    project,
    "Assets/AnimamaExport/Editor/AnimamaBatchExport.cs",
  );
  const copyHint = `Copy scripts/avatars/unity/AnimamaBatchExport.cs and Animama.BatchExport.asmdef into ${path.dirname(projectScript)}.`;
  if (!(await exists(projectScript)))
    throw new Error(`The project has no batch export script. ${copyHint}`);
  const [projectCopy, repoCopy] = await Promise.all([
    readFile(projectScript, "utf8"),
    readFile(repoScript, "utf8"),
  ]);
  if (!sameScript(projectCopy, repoCopy))
    throw new Error(
      `The project's AnimamaBatchExport.cs differs from the repository's. ${copyHint}`,
    );
}

/** Run a command to completion, resolving with its exit code. */
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("exit", (code, signal) => resolve(signal ? 1 : (code ?? 1)));
  });
}

/**
 * The batch export's own lines from a Unity log: each `[Animama]` line, and
 * the whole Validate report, whose lines run on until Unity's stack trace.
 */
export function exportLines(log) {
  const lines = [];
  let inReport = false;
  for (const line of log.split("\n")) {
    if (line.startsWith("[Animama]")) {
      lines.push(line);
      inReport = line.startsWith("[Animama] Validate:");
    } else if (inReport) {
      if (!line.trim() || line.startsWith("UnityEngine.")) inReport = false;
      else lines.push(`  ${line}`);
    }
  }
  return lines.join("\n");
}

const megabytes = async (file) =>
  `${((await stat(file)).size / 1024 / 1024).toFixed(2)} MB`;

async function main(argv) {
  const { options, flags } = parseArgs(argv);
  if (flags.help) {
    console.log(USAGE);
    return 0;
  }
  const project = path.resolve(options.project);
  const paths = outputPaths(path.resolve(options.out), flags.optimize);
  if (!flags.validate) {
    for (const file of new Set([paths.final, paths.raw])) {
      if (await exists(file))
        throw new Error(`${file} exists; choose a new --out.`);
    }
  }
  await checkProjectScript(project);
  const editor = await resolveUnityEditor(project, options.unity);

  console.log(
    `Unity: ${flags.validate ? "validating" : "exporting"} ${options.prefab} (log: ${paths.log})`,
  );
  const exported = await run(
    editor,
    unityArgs({
      project,
      prefab: options.prefab,
      raw: paths.raw,
      log: paths.log,
      meta: options,
      keepPose: flags.keepPose,
      validate: flags.validate,
    }),
  );
  console.log(exportLines(await readFile(paths.log, "utf8").catch(() => "")));
  if (exported === 2) {
    console.error("Mochiya cannot convert this prefab; see Validate above.");
    return 2;
  }
  if (exported !== 0) {
    console.error(`The Unity batch export failed (exit ${exported}).`);
    return 1;
  }
  if (flags.validate) return 0;

  if (flags.optimize) {
    const optimized = await run(
      process.execPath,
      ["scripts/vrm-optimize.mjs", paths.raw, "--out", paths.final],
      { cwd: webRoot },
    );
    if (optimized !== 0) {
      console.error(
        `vrm:optimize failed; the raw export is kept at ${paths.raw}.`,
      );
      return 1;
    }
  }
  const inspected = await run(
    process.execPath,
    ["scripts/vrm-inspect.mjs", paths.final],
    { cwd: webRoot },
  );
  console.log(
    flags.optimize
      ? `Wrote ${paths.final} (${await megabytes(paths.final)}); raw export ${paths.raw} (${await megabytes(paths.raw)}).`
      : `Wrote ${paths.final} (${await megabytes(paths.final)}).`,
  );
  return inspected;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}
