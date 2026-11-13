import { importBundledTool } from "./bundled-tool.mjs";
import { stagedPackRelease } from "./release-policy.mjs";
import { rmSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildPython,
  desktopRoot,
  parseTarget,
  pythonEnvironment,
  readJson,
  repoRoot,
  run,
  sourceRoot,
  writeJson,
} from "./common.mjs";

export async function stageFeaturePacks(target) {
  const release = {
    ...readJson(path.join(sourceRoot, "feature-pack-releases.json")),
    ...stagedPackRelease(),
  };
  const { buildFeaturePacks } = await importBundledTool(
    "scripts/runtime/feature-pack-build.ts",
  );
  return buildFeaturePacks({
    inputs: {
      "expanded-included-content": path.join(
        target.output,
        "pack-inputs/expanded-included-content",
      ),
    },
    output: path.join(target.output, "feature-packs"),
    catalog: path.join(target.runtime, "pack-catalog.json"),
    appVersion: readJson(path.join(desktopRoot, "package.json")).version,
    release,
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
