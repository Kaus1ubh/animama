import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(frontendRoot, "../..");

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
  commandRunner = runCommand,
  createTemporaryDirectory = () => mkdtemp(join(tmpdir(), "animama-openapi-")),
  removeTemporaryDirectory = (path) => rm(path, { force: true, recursive: true }),
} = {}) {
  const temporaryDirectory = await createTemporaryDirectory();
  const schemaPath = join(temporaryDirectory, "local-openapi.json");

  try {
    await commandRunner(
      "uv",
      [
        "run",
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
          UV_CACHE_DIR: process.env.UV_CACHE_DIR ?? join(tmpdir(), "animama-uv-cache"),
        },
      },
    );
    await commandRunner("pnpm", ["exec", "openapi-ts", "-f", "openapi-ts.config.ts"], {
      cwd: frontendRoot,
      env: {
        ...process.env,
        ANIMAMA_LOCAL_OPENAPI_PATH: schemaPath,
      },
    });
  } finally {
    await removeTemporaryDirectory(temporaryDirectory);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await generateOpenApiClient();
}
