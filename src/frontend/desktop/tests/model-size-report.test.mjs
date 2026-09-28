import { afterEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

const inputs = vi.hoisted(() => ({ manifests: {}, deferred: false }));
vi.mock("../scripts/runtime/common.mjs", async (original) => {
  const real = await original();
  return {
    ...real,
    buildPython: () => "python3",
    readJson: (file) => {
      const value = real.readJson(file);
      if (path.basename(file) === "feature-pack-releases.json")
        for (const [id, pack] of Object.entries(value.packs))
          pack.release_status =
            inputs.deferred && id.startsWith("parakeet")
              ? "deferred"
              : "active";
      return value;
    },
  };
});
vi.mock("../scripts/runtime/optional-inputs.mjs", async (original) => {
  const real = await original();
  return {
    ...real,
    auditOptionalInputs: (target) =>
      real.auditOptionalInputs(target, inputs.manifests),
  };
});
import { measure } from "../scripts/runtime/measure.mjs";
import { releaseSizes } from "../scripts/runtime/release-artifacts.mjs";
const roots = [];
afterEach(() => {
  inputs.deferred = false;
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "animama-model-size-"));
  roots.push(root);
  const target = {
    output: root,
    runtime: path.join(root, "runtime"),
    target: "darwin-arm64",
  };
  const put = (relative, value) => {
    const file = path.join(root, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, value);
    return file;
  };
  put("runtime/manifest.json", "{}");
  put("runtime/data", "runtime");
  put("electron/main", "electron");
  put("app/main", "app");
  put("pack-inputs/expanded-included-content/content", "expanded");
  const receipt = { schema: "animama-optional-inputs/1" };
  const sizes = {};
  for (const [id, model, key, option, license] of [
    [
      "parakeet-stt",
      "parakeet-tdt-0.6b-v2",
      "parakeet",
      "manifestFile",
      "parakeet-input",
    ],
    [
      "parakeet-stt-webgpu",
      "parakeet-tdt-0.6b-v2-webgpu",
      "parakeet_webgpu",
      "webgpuManifestFile",
      "parakeet-webgpu-input",
    ],
  ]) {
    const manifest = JSON.parse(
      readFileSync(
        new URL(`../../../../models/${model}/manifest.json`, import.meta.url),
        "utf8",
      ),
    );
    const files = [];
    for (const entry of manifest.files) {
      const bytes = Buffer.from(`verified ${id}: ${entry.path}`);
      entry.size = bytes.length;
      entry.sha256 = hash(bytes);
      put(`pack-inputs/${id}/${entry.path}`, bytes);
      files.push({
        path: entry.path,
        size_bytes: entry.size,
        sha256: entry.sha256,
        license_refs: [license],
      });
    }
    files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const text = JSON.stringify(manifest);
    inputs.manifests[option] = put(`${id}-manifest.json`, text);
    receipt[key] = {
      manifest_sha256: hash(text),
      declared_license: manifest.license,
      review: "pending",
      files,
    };
    put(`pack-inputs/${id}/PACK-REVIEW.txt`, "Not downloaded. ".repeat(100));
    sizes[id] = files.reduce((sum, file) => sum + file.size_bytes, 0);
  }
  put("optional-inputs.json", JSON.stringify(receipt));
  const catalog = {
    entries: [
      {
        schema: "animama-model-pack/1",
        id: "parakeet-stt",
        installed_bytes: sizes["parakeet-stt"],
        minimum_peak_free_bytes: 1000,
      },
      {
        schema: "animama-feature-pack/1",
        id: "expanded-included-content",
        installed_bytes: 800,
        archive_bytes: 80,
        minimum_peak_free_bytes: 2000,
      },
      {
        schema: "animama-feature-pack/1",
        id: "document-processing",
        installed_bytes: 900,
        archive_bytes: 90,
        minimum_peak_free_bytes: 2000,
      },
    ],
  };
  put("runtime/pack-catalog.json", JSON.stringify(catalog));
  return {
    root,
    target,
    put,
    sizes,
    catalog,
    manifest: {
      app_version: "0.1.0",
      files: [{ component: "frozen_backend", size_bytes: 7 }],
    },
  };
}

describe("raw model size reporting", () => {
  it("measures complete raw inventories including notices without creating Parakeet archives", async () => {
    const f = fixture();
    const report = await measure(f.target, f.manifest);
    expect(report.packs["parakeet-stt"].download_bytes).toBe(
      f.sizes["parakeet-stt"],
    );
    expect(report.packs["parakeet-stt-webgpu"]).toMatchObject({
      installed_bytes: f.sizes["parakeet-stt-webgpu"],
      download_bytes: f.sizes["parakeet-stt-webgpu"],
    });
    for (const id of ["parakeet-stt", "parakeet-stt-webgpu"])
      expect(
        existsSync(path.join(f.root, `${id}-input-feasibility.tar.zst`)),
      ).toBe(false);
    expect(existsSync(path.join(f.root, "core-feasibility.tar.zst"))).toBe(
      true,
    );
    expect(
      existsSync(path.join(f.root, "expanded-input-feasibility.tar.zst")),
    ).toBe(true);
    expect(report.packs["expanded-included-content"].download_bytes).toBe(80);
    expect(report.packs["document-processing"].download_bytes).toBe(90);
    expect(
      readFileSync(path.join(f.root, "size-report.md"), "utf8"),
    ).not.toContain("; compressed");
  });
  it("keeps deferred model measurements explicitly unavailable", async () => {
    const f = fixture();
    inputs.deferred = true;
    f.put("runtime/pack-catalog.json", JSON.stringify({ entries: [] }));
    const report = await measure(f.target, f.manifest);
    expect(report.packs["parakeet-stt"]).toEqual({
      installed_bytes: null,
      download_bytes: null,
      state: "deferred",
    });
  });
  it("refuses changed staged model bytes instead of reporting an unverified estimate", async () => {
    const f = fixture();
    f.put("pack-inputs/parakeet-stt/vocab.txt", "corrupt");
    await expect(measure(f.target, f.manifest)).rejects.toThrow(
      "integrity mismatch",
    );
  });
  it("reports approved mixed model/archive catalogs in the signed release report", () => {
    const f = fixture();
    const app = path.join(f.root, "Animama.app");
    f.put("Animama.app/Contents/Resources/runtime/manifest.json", "{}");
    f.put("Animama.app/Contents/Resources/runtime/backend", "runtime");
    f.put("Animama-0.1.0-arm64.dmg", "dmg");
    f.put("Animama-0.1.0-arm64.zip", "zip");
    const report = releaseSizes(app, f.root, f.manifest, f.catalog);
    expect(report.packs["parakeet-stt"]).toMatchObject({
      installed_bytes: f.sizes["parakeet-stt"],
      download_bytes: f.sizes["parakeet-stt"],
    });
    expect(report.packs["document-processing"].download_bytes).toBe(90);
    expect(report.packs["expanded-included-content"].download_bytes).toBe(80);
  });
});
