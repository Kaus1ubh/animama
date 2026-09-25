import { rmSync } from "node:fs";
import path from "node:path";
import { importBundledTool } from "./bundled-tool.mjs";
import {
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

const [action] = process.argv.slice(2);
if (!["export", "import"].includes(action) || process.argv.length !== 3)
  throw new Error("Expected export or import");
const target = parseTarget(["--platform", "darwin", "--arch", "arm64"]);
const module = await importBundledTool("scripts/runtime/worker-input.ts");
await module[action === "export" ? "exportWorkerInput" : "importWorkerInput"]({
  root: path.join(cacheRoot, "document-worker", target.target, "signed-input"),
  exchange: path.join(desktopRoot, "release/worker-input"),
  appVersion: readJson(path.join(desktopRoot, "package.json")).version,
  release: readJson(path.join(sourceRoot, "feature-pack-releases.json")),
  writeTar: async (source, files, output) => {
    const inventory = `${output}.inventory.json`;
    writeJson(inventory, files);
    // The worker producer has its own Python environment; core staging need not have run.
    const python = path.join(
      cacheRoot,
      "worker-build-venv/darwin-arm64/bin/python",
    );
    try {
      run(
        python,
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
console.log(
  action === "export"
    ? "Signed helper candidate exported for human review; no approval or publication was made."
    : "Exact reviewed helper imported; no signing or payload changes were made.",
);
