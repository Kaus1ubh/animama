import { build } from "esbuild";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
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
const tool = path.join(cacheRoot, "tools/worker-input.mjs");
mkdirSync(path.dirname(tool), { recursive: true });
await build({
  absWorkingDir: desktopRoot,
  entryPoints: ["scripts/runtime/worker-input.ts"],
  outfile: tool,
  platform: "node",
  bundle: true,
  format: "esm",
  target: "es2023",
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
});
const module = await import(pathToFileURL(tool).href);
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
