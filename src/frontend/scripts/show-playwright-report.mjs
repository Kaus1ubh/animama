import { readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { resolvePackageBinary } from "./e2e/run-support.mjs";

const require = createRequire(import.meta.url);
const frontendRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repositoryRoot = path.resolve(frontendRoot, "../..");
const latestRunPath = path.join(
  repositoryRoot,
  ".animama-e2e",
  "latest-run.json",
);

async function main() {
  let latestRun;
  try {
    latestRun = JSON.parse(await readFile(latestRunPath, "utf8"));
  } catch {
    throw new Error(
      "No Playwright run is available. Run `pnpm e2e:test` first.",
    );
  }

  const htmlReportPath = path.resolve(repositoryRoot, latestRun.htmlReport);
  const playwrightPackagePath = require.resolve("playwright/package.json");
  const playwrightPackage = JSON.parse(
    await readFile(playwrightPackagePath, "utf8"),
  );
  const playwrightCliPath = resolvePackageBinary(
    playwrightPackagePath,
    playwrightPackage,
    "playwright",
  );
  const child = spawn(
    process.execPath,
    [playwrightCliPath, "show-report", htmlReportPath],
    {
      cwd: frontendRoot,
      shell: false,
      stdio: "inherit",
    },
  );
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
  process.exitCode = exitCode;
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
