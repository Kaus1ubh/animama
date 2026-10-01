import {
  createReadStream,
  createWriteStream,
  lstatSync,
  rmSync,
} from "node:fs";
import { pipeline } from "node:stream/promises";
import { createZstdCompress } from "node:zlib";
import path from "node:path";
import {
  buildPython,
  pythonEnvironment,
  readJson,
  repoRoot,
  run,
  sha256,
  sourceRoot,
} from "./common.mjs";
import { packSizeReport, saveSizeReport } from "./size.mjs";

/** Measure a real compressed payload; never substitute a stale wrapper app. */
async function archive(target, name, sources) {
  const tar = path.join(target.output, `${name}.tar`);
  const compressed = `${tar}.zst`;
  const sizes = JSON.parse(
    run(
      buildPython(),
      [
        path.join(repoRoot, "src/backend/packaging/desktop/archive_payload.py"),
        "--output",
        tar,
        ...sources,
      ],
      { env: pythonEnvironment(), capture: true },
    ),
  );
  await pipeline(
    createReadStream(tar),
    createZstdCompress(),
    createWriteStream(compressed),
  );
  rmSync(tar);
  return {
    sizes,
    download_bytes: lstatSync(compressed).size,
    sha256: sha256(compressed),
  };
}

export async function measure(target, manifest) {
  const payload = await archive(target, "core-feasibility", [
    target.runtime,
    path.join(target.output, "electron"),
    path.join(target.output, "app"),
  ]);
  const components = new Map([
    ["electron", payload.sizes.electron + payload.sizes.app],
  ]);
  for (const file of manifest.files)
    components.set(
      file.component,
      (components.get(file.component) ?? 0) + file.size_bytes,
    );
  components.set(
    "package_overhead",
    (components.get("package_overhead") ?? 0) +
      lstatSync(path.join(target.runtime, "manifest.json")).size,
  );
  const expandedPath = path.join(
    target.output,
    "pack-inputs/expanded-included-content",
  );
  const releases = readJson(
    path.join(sourceRoot, "feature-pack-releases.json"),
  );
  const deferred = (id) => releases.packs[id].release_status === "deferred";
  const expandedDeferred = deferred("expanded-included-content");
  const expanded = expandedDeferred
    ? null
    : await archive(target, "expanded-input-feasibility", [expandedPath]);
  const documentDeferred = deferred("document-processing");
  const report = {
    schema: "animama-size-report/1",
    target: target.target,
    app_version: manifest.app_version,
    measurement:
      "staged-core-and-excluded-payload-zstd; signed installer overhead requires separate binary release measurements",
    installed_bytes: Object.values(payload.sizes).reduce((a, b) => a + b, 0),
    download_bytes: payload.download_bytes,
    archive_sha256: payload.sha256,
    components: [...components]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, installed_bytes]) => ({ name, installed_bytes })),
    packs: {
      "expanded-included-content": {
        installed_bytes: expanded?.sizes["expanded-included-content"] ?? null,
        download_bytes: expanded?.download_bytes ?? null,
        ...(expandedDeferred ? { state: "deferred" } : {}),
      },
      "document-processing": {
        installed_bytes: null,
        download_bytes: null,
        ...(documentDeferred ? { state: "deferred" } : {}),
      },
    },
  };
  // Approved catalog totals replace feasibility inputs with the exact inventory
  // embedded in this core; only excluded packs use compressed archives.
  for (const pack of readJson(path.join(target.runtime, "pack-catalog.json"))
    .entries) {
    report.packs[pack.id] = packSizeReport(pack);
  }
  saveSizeReport(target.output, report);
  return report;
}
