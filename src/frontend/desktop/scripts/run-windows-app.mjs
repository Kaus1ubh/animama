import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const desktopRoot = fileURLToPath(new URL("..", import.meta.url));
const appPath = join(desktopRoot, "release", "win-unpacked", "Animama.exe");

if (process.platform !== "win32") {
  console.error("run:win must be executed on Windows.");
  console.error(`Expected app path: ${appPath}`);
  process.exit(1);
}

if (!existsSync(appPath)) {
  console.error(`Windows app was not found at ${appPath}`);
  console.error("Run pnpm pack:win first.");
  process.exit(1);
}

const child = spawn(appPath, {
  cwd: dirname(appPath),
  detached: true,
  stdio: "ignore",
});

child.unref();
