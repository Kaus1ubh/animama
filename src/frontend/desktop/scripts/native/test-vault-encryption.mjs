import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { cacheRoot, desktopRoot } from "../runtime/common.mjs";

/**
 * Run the vault harness inside Electron, where safeStorage is real. Electron
 * keeps its profile (including Windows' OSCrypt key) in a disposable folder.
 */
const outfile = path.join(cacheRoot, "tools", "vault-encryption-harness.mjs");
mkdirSync(path.dirname(outfile), { recursive: true });
await build({
  absWorkingDir: desktopRoot,
  entryPoints: ["scripts/native/vault-encryption-harness.ts"],
  outfile,
  platform: "node",
  bundle: true,
  format: "esm",
  target: "es2023",
  external: ["electron"],
});
const electron = createRequire(import.meta.url)("electron");
const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
const root = mkdtempSync(path.join(tmpdir(), "animama-vault-harness-"));
try {
  const result = spawnSync(electron, [outfile, root], {
    stdio: "inherit",
    env,
    timeout: 120_000,
  });
  if (result.error)
    console.error(`vault encryption failed: ${result.error.message}`);
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
