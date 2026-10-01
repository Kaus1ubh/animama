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

const inputs = vi.hoisted(() => ({ deferred: false }));
vi.mock("../scripts/runtime/common.mjs", async (original) => {
  const real = await original();
  return {
    ...real,
    buildPython: () => "python3",
    readJson: (file) => {
      const value = real.readJson(file);
      if (path.basename(file) === "feature-pack-releases.json")
        for (const pack of Object.values(value.packs))
          pack.release_status = inputs.deferred ? "deferred" : "active";
      return value;
    },
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
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "animama-pack-size-"));
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
  const catalog = {
    entries: [
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
    catalog,
    manifest: {
      app_version: "0.1.0",
      files: [{ component: "frozen_backend", size_bytes: 7 }],
    },
  };
}

describe("pack size reporting", () => {
  it("measures the core and excluded payload and reports exact catalog archives", async () => {
    const f = fixture();
    const report = await measure(f.target, f.manifest);
    expect(Object.keys(report.packs).sort()).toEqual([
      "document-processing",
      "expanded-included-content",
    ]);
    expect(existsSync(path.join(f.root, "core-feasibility.tar.zst"))).toBe(
      true,
    );
    expect(
      existsSync(path.join(f.root, "expanded-input-feasibility.tar.zst")),
    ).toBe(true);
    expect(report.packs["expanded-included-content"]).toEqual({
      installed_bytes: 800,
      download_bytes: 80,
      minimum_peak_free_bytes: 2000,
    });
    expect(report.packs["document-processing"].download_bytes).toBe(90);
    expect(
      readFileSync(path.join(f.root, "size-report.md"), "utf8"),
    ).not.toContain("; compressed");
  });
  it("keeps deferred pack measurements explicitly unavailable", async () => {
    const f = fixture();
    inputs.deferred = true;
    f.put("runtime/pack-catalog.json", JSON.stringify({ entries: [] }));
    const report = await measure(f.target, f.manifest);
    expect(
      existsSync(path.join(f.root, "expanded-input-feasibility.tar.zst")),
    ).toBe(false);
    for (const id of ["expanded-included-content", "document-processing"])
      expect(report.packs[id]).toEqual({
        installed_bytes: null,
        download_bytes: null,
        state: "deferred",
      });
  });
  it("reports approved archive catalogs in the signed release report", () => {
    const f = fixture();
    const app = path.join(f.root, "Animama.app");
    f.put("Animama.app/Contents/Resources/runtime/manifest.json", "{}");
    f.put("Animama.app/Contents/Resources/runtime/backend", "runtime");
    f.put("Animama-0.1.0-arm64.dmg", "dmg");
    f.put("Animama-0.1.0-arm64.zip", "zip");
    const report = releaseSizes(app, f.root, f.manifest, f.catalog);
    expect(report.packs["document-processing"].download_bytes).toBe(90);
    expect(report.packs["expanded-included-content"]).toMatchObject({
      installed_bytes: 800,
      download_bytes: 80,
    });
  });
});
