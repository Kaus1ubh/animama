import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

// pnpm forwards a literal '--' through nested workspace scripts. Normalize it
// so the documented trailing filename filter actually reaches Vitest.
const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(new URL("../package.json", import.meta.url));
const entry = path.join(
  path.dirname(require.resolve("vitest/package.json")),
  "vitest.mjs",
);
const result = spawnSync(
  process.execPath,
  [entry, "run", ...process.argv.slice(2).filter((arg) => arg !== "--")],
  { cwd: root, stdio: "inherit" },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
