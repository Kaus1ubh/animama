import { constants as fileFlags } from "node:fs";
import { spawn } from "node:child_process";
import { constants } from "node:os";
import { mkdir, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const frontendRoot = fileURLToPath(new URL("..", import.meta.url));
const repositoryRoot = path.resolve(frontendRoot, "../..");

/** Full source validation, sharing freshly built package outputs in this checkout only. */
export function sourceCommands(e2eTests) {
  return [
    ["pnpm", "packages:build"],
    ["pnpm", "e2e:check:source"],
    ["pnpm", "e2e:test:unit"],
    ["node", "--test", "scripts/ci-source.test.mjs", ...e2eTests],
    ["node", "--test", "scripts/generate-openapi-client.test.mjs"],
    ["pnpm", "openapi-ts:check"],
    ["pnpm", "i18n:check"],
    ["pnpm", "--filter", "animama-web", "check:source"],
    ["pnpm", "desktop:check"],
    ["pnpm", "packages:check"],
    ["pnpm", "packages:test"],
    ["pnpm", "web:lint"],
    ["pnpm", "--filter", "animama-web", "test:source"],
    ["pnpm", "--filter", "animama-web", "test:browser:source"],
    ["pnpm", "desktop:test"],
    ["pnpm", "--filter", "animama-web", "build:source"],
  ];
}

/** Keep output visible and preserve nonzero exits and signal termination. */
export function runCommand(command) {
  return new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: frontendRoot,
      stdio: "inherit",
    });
    child.once("error", (error) =>
      resolve({ code: 1, signal: null, error: error.message }),
    );
    child.once("close", (code, signal) =>
      resolve({
        code: code ?? 128 + (constants.signals[signal] ?? 1),
        signal,
      }),
    );
  });
}

/** Stop before dependent checks on failure; write progress after every command. */
export async function validateSource(
  commands,
  { run = runCommand, save, now = () => performance.now() },
) {
  const receipt = { schema_version: 1, status: "running", commands: [] };
  await save(receipt);
  for (const command of commands) {
    const started = now();
    let result;
    try {
      result = await run(command);
    } catch (error) {
      result = { code: 1, signal: null, error: String(error) };
    }
    receipt.commands.push({
      command,
      duration_ms: Math.round(now() - started),
      ...result,
    });
    if (result.code !== 0) {
      receipt.status = "failed";
      await save(receipt);
      return result.code;
    }
    await save(receipt);
  }
  receipt.status = "passed";
  await save(receipt);
  return 0;
}

/** Refuse symlink targets while allowing a caller to reuse an ordinary receipt file. */
export async function saveReceipt(receiptPath, receipt) {
  const file = await open(
    receiptPath,
    fileFlags.O_WRONLY |
      fileFlags.O_CREAT |
      fileFlags.O_TRUNC |
      fileFlags.O_NOFOLLOW,
    0o600,
  );
  try {
    await file.writeFile(`${JSON.stringify(receipt, null, 2)}\n`);
  } finally {
    await file.close();
  }
}

async function main() {
  const args = process.argv.slice(2).filter((value) => value !== "--");
  if (
    args.length !== 2 ||
    args[0] !== "--receipt" ||
    !path.isAbsolute(args[1])
  ) {
    throw new Error(
      "Usage: pnpm ci:source --receipt /absolute/path/outside/repository/source.json",
    );
  }
  const receiptPath = path.resolve(args[1]);
  const withinRepository = (candidate) => {
    const relative = path.relative(repositoryRoot, candidate);
    return (
      relative === "" ||
      (!relative.startsWith(`..${path.sep}`) &&
        relative !== ".." &&
        !path.isAbsolute(relative))
    );
  };
  if (withinRepository(receiptPath))
    throw new Error("Receipt must be outside the repository");
  await mkdir(path.dirname(receiptPath), { recursive: true });
  if (withinRepository(await realpath(path.dirname(receiptPath))))
    throw new Error("Receipt parent resolves inside repository");
  const e2eTests = (await readdir(path.join(frontendRoot, "scripts/e2e")))
    .filter((name) => name.endsWith(".test.mjs"))
    .sort()
    .map((name) => `scripts/e2e/${name}`);
  if (!e2eTests.length) throw new Error("No E2E runner tests found");
  process.exitCode = await validateSource(sourceCommands(e2eTests), {
    save: (receipt) => saveReceipt(receiptPath, receipt),
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
