import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { cacheRoot, desktopRoot } from "./common.mjs";

/** Bundle TypeScript build tooling separately; only main/preload enter the application. */
export async function importBundledTool(entry) {
  const tool = path.join(
    cacheRoot,
    "tools",
    `${path.basename(entry, ".ts")}.mjs`,
  );
  mkdirSync(path.dirname(tool), { recursive: true });
  await build({
    absWorkingDir: desktopRoot,
    entryPoints: [entry],
    outfile: tool,
    platform: "node",
    bundle: true,
    format: "esm",
    target: "es2023",
    banner: {
      js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
    },
  });
  return import(pathToFileURL(tool).href);
}
