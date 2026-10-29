import { spawn } from "node:child_process";
import { access, stat } from "node:fs/promises";
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
 * It runs the Animama Avatar Export command (the public
 * raymond-van/animama-avatar-export repository) at its pinned release through
 * `pnpm dlx`. That command adds its Unity package and dependencies to the
 * project's Packages/manifest.json and runs the Unity batch export (T-pose
 * unless --keep-pose), writing Unity's log to `<Avatar>.export.log`. This
 * command then runs `vrm:optimize`, keeping the raw export beside the result as
 * `<Avatar>.raw.vrm`, and `vrm:inspect`. --no-optimize writes the raw export to
 * --out; --validate only runs Mochiya's validation.
 *
 * ANIMAMA_AVATAR_EXPORT runs a local checkout of the exporter instead, with
 * that checkout's Unity package, to test unreleased changes.
 * See docs/frontend/runtime/vrchat-avatar-conversion.md.
 */

/** The exporter release this command runs; its tag also selects the Unity package. */
export const EXPORTER_RELEASE =
  "github:raymond-van/animama-avatar-export#v0.1.0";

const webRoot = fileURLToPath(new URL("..", import.meta.url));
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
/** Options passed on to the exporter unchanged. */
const PASSED_OPTIONS = ["name", "version", "author", "copyright", "unity"];

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

/** The finished VRM, the raw Unity export and Unity's log for an --out path. */
export function outputPaths(out, optimize) {
  const stem = out.slice(0, -".vrm".length);
  return {
    final: out,
    raw: optimize ? `${stem}.raw.vrm` : out,
    log: `${stem}.export.log`,
  };
}

/**
 * The exporter to run and the Unity package entry it should install: the
 * pinned release (which installs its own package), or a local checkout's
 * folder with that checkout's package. pnpm links a checkout, so edits apply
 * on the next run.
 */
export function exporterSource(checkout) {
  if (!checkout) return { spec: EXPORTER_RELEASE, packageSpec: null };
  const folder = path.resolve(checkout);
  return {
    spec: folder,
    packageSpec: `file:${path.join(folder, "Packages", "com.animama.avatar-export")}`,
  };
}

/** The exporter's arguments for this conversion; it writes the raw export and the log. */
export function exporterArgs({ options, flags, raw, log, packageSpec }) {
  const args = [
    "--project",
    options.project,
    "--prefab",
    options.prefab,
    "--out",
    raw,
    "--log",
    log,
  ];
  for (const key of PASSED_OPTIONS) {
    if (options[key]) args.push(`--${key}`, options[key]);
  }
  if (flags.keepPose) args.push("--keep-pose");
  if (flags.validate) args.push("--validate");
  if (packageSpec) args.push("--package", packageSpec);
  return args;
}

/**
 * The `pnpm dlx` command line that runs the exporter. pnpm is started through
 * Node when it is a script, so no shell is needed on Windows, and with the
 * default reporter: `pnpm -s` passes a silent one down, which would hide a
 * failure to fetch or start the exporter.
 */
export function exporterCommand(npmExecPath, nodePath, spec, args) {
  if (!npmExecPath)
    throw new Error("Run this through pnpm: pnpm -s vrm:convert-vrchat …");
  const dlx = [
    "--reporter=default",
    "dlx",
    `--package=${spec}`,
    "animama-avatar-export",
    ...args,
  ];
  return /\.[cm]?js$/.test(npmExecPath)
    ? { command: nodePath, args: [npmExecPath, ...dlx] }
    : { command: npmExecPath, args: dlx };
}

/**
 * This command's exit code for the exporter's: 0 and 2 (cannot convert) pass
 * through; anything else is 1.
 */
export function conversionExitCode(exporterExitCode) {
  return exporterExitCode === 0 || exporterExitCode === 2
    ? exporterExitCode
    : 1;
}

const exists = (file) =>
  access(file).then(
    () => true,
    () => false,
  );

/** Run a command to completion, resolving with its exit code. */
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("exit", (code, signal) => resolve(signal ? 1 : (code ?? 1)));
  });
}

const megabytes = async (file) =>
  `${((await stat(file)).size / 1024 / 1024).toFixed(2)} MB`;

async function main(argv) {
  const { options, flags } = parseArgs(argv);
  if (flags.help) {
    console.log(USAGE);
    return 0;
  }
  const paths = outputPaths(path.resolve(options.out), flags.optimize);
  if (!flags.validate) {
    for (const file of new Set([paths.final, paths.raw])) {
      if (await exists(file))
        throw new Error(`${file} exists; choose a new --out.`);
    }
  }

  const source = exporterSource(process.env.ANIMAMA_AVATAR_EXPORT);
  const exporter = exporterCommand(
    process.env.npm_execpath,
    process.execPath,
    source.spec,
    exporterArgs({
      options: { ...options, project: path.resolve(options.project) },
      flags,
      raw: paths.raw,
      log: paths.log,
      packageSpec: source.packageSpec,
    }),
  );
  const exported = await run(exporter.command, exporter.args);
  if (exported > 2)
    console.error(
      `The exporter ${source.spec} did not run (exit ${exported}); check the network, Git and ANIMAMA_AVATAR_EXPORT.`,
    );
  if (exported !== 0) return conversionExitCode(exported);
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
