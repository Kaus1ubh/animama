import { execFile, spawn } from "node:child_process";
import { lstat, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import prettierConfig from "../prettier.config.mjs";

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(frontendRoot, "../..");
const generatedRoot = join(
  frontendRoot,
  "packages/runtime-contracts/src/generated",
);
const execFileAsync = promisify(execFile);
const webRequire = createRequire(
  new URL("../web/package.json", import.meta.url),
);

/** Use the locked web formatter on copies, without changing checked-in output. */
export async function canonicalizeGeneratedSource(source, path) {
  const { default: prettier } = await import(
    pathToFileURL(webRequire.resolve("prettier")).href
  );
  return prettier.format(source, {
    ...prettierConfig,
    plugins: [webRequire.resolve("prettier-plugin-tailwindcss")],
    filepath: path,
  });
}

/** Enumerate only files Git expects in the generated client, including deletions. */
async function trackedGeneratedFiles() {
  const prefix = `${relative(repositoryRoot, generatedRoot).replaceAll("\\", "/")}/`;
  const { stdout } = await execFileAsync(
    "git",
    ["ls-files", "-z", "--", prefix],
    {
      cwd: repositoryRoot,
      maxBuffer: 1024 * 1024,
    },
  );
  return stdout
    .split("\0")
    .filter(Boolean)
    .map((path) => path.slice(prefix.length));
}

/** Inventory freshly generated files without following links outside the output. */
async function generatedFiles(root, directory = "") {
  const files = [];
  for (const entry of await readdir(join(root, directory), {
    withFileTypes: true,
  })) {
    const path = directory ? `${directory}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await generatedFiles(root, path)));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Unexpected generated file type: ${path}`);
  }
  return files.sort();
}

/** Compare canonical bytes and bounded path diagnostics, never source contents. */
export async function checkGeneratedClient({
  candidateRoot,
  committedRoot = generatedRoot,
  trackedFiles = trackedGeneratedFiles,
  canonicalize = canonicalizeGeneratedSource,
}) {
  const expected = await generatedFiles(candidateRoot);
  const tracked = new Set(await trackedFiles());
  if (expected.length === 0)
    throw new Error("SDK generator produced no files.");
  const differences = [];
  for (const path of expected) {
    if (!tracked.delete(path)) {
      differences.push(`missing: ${path}`);
      continue;
    }
    let actual;
    try {
      const committedPath = join(committedRoot, path);
      if (!(await lstat(committedPath)).isFile())
        throw new Error(`Expected regular generated file: ${path}`);
      actual = await readFile(committedPath, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      differences.push(`missing: ${path}`);
      continue;
    }
    const candidate = await readFile(join(candidateRoot, path), "utf8");
    let canonicalActual;
    let canonicalCandidate;
    try {
      [canonicalActual, canonicalCandidate] = await Promise.all([
        canonicalize(actual, path),
        canonicalize(candidate, path),
      ]);
    } catch {
      // Formatter errors may contain source excerpts; report only the path.
      throw new Error(
        `Cannot format generated SDK file: ${path.slice(0, 240)}. Check its syntax and installed locked formatter dependencies.`,
      );
    }
    if (!Buffer.from(canonicalActual).equals(Buffer.from(canonicalCandidate))) {
      differences.push(`stale: ${path}`);
    }
  }
  differences.push(...[...tracked].sort().map((path) => `extra: ${path}`));
  if (differences.length) {
    const shown = differences
      .slice(0, 20)
      .map((line) => `  ${line.slice(0, 240)}`);
    const omitted =
      differences.length > 20
        ? `\n  ... ${differences.length - 20} more paths`
        : "";
    throw new Error(
      `Generated SDK is out of date (${differences.length} files):\n${shown.join("\n")}${omitted}\nRun pnpm openapi-ts and review the generated changes.`,
    );
  }
  return expected.length;
}

/** Run one child command while preserving useful generator output. */
export function runCommand(command, args, options) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.once("error", rejectCommand);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolveCommand();
        return;
      }
      const ending = signal ? `signal ${signal}` : `exit code ${code}`;
      rejectCommand(new Error(`${command} failed with ${ending}`));
    });
  });
}

/** Generate the public runtime-contracts SDK exclusively from an offline temporary schema. */
export async function generateOpenApiClient({
  check = false,
  commandRunner = runCommand,
  checkClient = checkGeneratedClient,
  createTemporaryDirectory = () => mkdtemp(join(tmpdir(), "animama-openapi-")),
  removeTemporaryDirectory = (path) =>
    rm(path, { force: true, recursive: true }),
} = {}) {
  const temporaryDirectory = await createTemporaryDirectory();
  const schemaPath = join(temporaryDirectory, "local-openapi.json");
  const outputRoot = check
    ? join(temporaryDirectory, "generated")
    : generatedRoot;

  try {
    await commandRunner(
      "uv",
      [
        "run",
        "--frozen",
        "--no-sync",
        "python",
        "-m",
        "animama.server.export_openapi",
        "--output",
        schemaPath,
      ],
      {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          ANIMAMA_LOG_TO_CONSOLE: "0",
          ANIMAMA_LOG_TO_FILE: "0",
          UV_CACHE_DIR:
            process.env.UV_CACHE_DIR ?? join(tmpdir(), "animama-uv-cache"),
        },
      },
    );
    await commandRunner(
      "pnpm",
      ["exec", "openapi-ts", "-f", "openapi-ts.config.ts"],
      {
        cwd: frontendRoot,
        env: {
          ...process.env,
          ANIMAMA_LOCAL_OPENAPI_PATH: schemaPath,
          ANIMAMA_LOCAL_OPENAPI_OUTPUT: outputRoot,
        },
      },
    );
    if (check) {
      const count = await checkClient({ candidateRoot: outputRoot });
      console.log(`Generated SDK is current (${count} files).`);
    }
  } finally {
    await removeTemporaryDirectory(temporaryDirectory);
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  if (args.some((arg) => arg !== "--check") || args.length > 1) {
    throw new Error("Usage: generate-openapi-client.mjs [--check]");
  }
  await generateOpenApiClient({ check: args.includes("--check") });
}
