import { build } from "esbuild";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildPython,
  cacheRoot,
  desktopRoot,
  parseTarget,
  pythonEnvironment,
  readJson,
  repoRoot,
  run,
  sourceRoot,
  writeJson,
} from "./common.mjs";

/** Bundle build tooling separately; only main/preload enter the application. */
export async function stageFeaturePacks(target) {
  const tool = path.join(cacheRoot, "tools/feature-pack-build.mjs");
  mkdirSync(path.dirname(tool), { recursive: true });
  await build({
    absWorkingDir: desktopRoot,
    entryPoints: ["scripts/runtime/feature-pack-build.ts"],
    outfile: tool,
    platform: "node",
    bundle: true,
    format: "esm",
    target: "es2023",
    banner: {
      js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
    },
  });
  const { buildFeaturePacks } = await import(pathToFileURL(tool).href);
  return buildFeaturePacks({
    inputs: {
      "parakeet-stt": path.join(target.output, "pack-inputs/parakeet-stt"),
      "expanded-included-content": path.join(
        target.output,
        "pack-inputs/expanded-included-content",
      ),
      "document-processing": path.join(
        cacheRoot,
        "document-worker",
        target.target,
        "signed-input",
      ),
    },
    output: path.join(target.output, "feature-packs"),
    catalog: path.join(target.runtime, "pack-catalog.json"),
    appVersion: readJson(path.join(desktopRoot, "package.json")).version,
    release: readJson(path.join(sourceRoot, "feature-pack-releases.json")),
    budgets: readJson(path.join(sourceRoot, "size-budgets.json")).packs,
    writeTar: async (source, files, output) => {
      const inventory = `${output}.inventory.json`;
      writeJson(inventory, files);
      try {
        run(
          buildPython(),
          [
            path.join(
              repoRoot,
              "src/backend/packaging/desktop/archive_feature_pack.py",
            ),
            "--source",
            source,
            "--inventory",
            inventory,
            "--output",
            output,
          ],
          { env: pythonEnvironment() },
        );
      } finally {
        rmSync(inventory, { force: true });
      }
    },
  });
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  await stageFeaturePacks(parseTarget());
}
