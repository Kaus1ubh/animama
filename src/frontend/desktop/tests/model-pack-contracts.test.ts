import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  validateManifest,
  versionDirectory,
} from "../src/main-process/feature-packs/catalog.js";
import {
  buildFeaturePacks,
  inventoryPack,
} from "../scripts/runtime/feature-pack-build.js";

const roots: string[] = [];
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const modelId = "parakeet-tdt-0.6b-v2";
const names = [
  "ATTRIBUTION.md",
  "README.md",
  "config.json",
  "decoder_joint-model.int8.onnx",
  "encoder-model.int8.onnx",
  "nemo128.onnx",
  "vocab.txt",
];
function modelManifest() {
  const files = names.map((name) => ({
    path: name,
    size_bytes: 4,
    sha256: digest(name),
    media_type: "application/octet-stream",
    mode: "0644",
    url: `https://downloads.animama.ai/models/${modelId}/${digest(name)}/${name}`,
  }));
  return {
    schema: "animama-model-pack/1",
    id: "parakeet-stt",
    model_id: modelId,
    display_name: "Offline speech recognition",
    version: "0.1.0",
    app_versions: ["0.1.0"],
    platform: "data-only",
    architecture: "data-only",
    installed_bytes: files.length * 4,
    minimum_peak_free_bytes: 1,
    license_refs: ["parakeet-input"],
    signing: null,
    files,
  };
}
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

describe("shared model pack contracts", () => {
  it("allows each complete pinned raw model inventory within its release download budget", async () => {
    const budgets = JSON.parse(
      await readFile(
        new URL("../runtime/size-budgets.json", import.meta.url),
        "utf8",
      ),
    ).packs;
    for (const [id, model] of [
      ["parakeet-stt", "parakeet-tdt-0.6b-v2"],
      ["parakeet-stt-webgpu", "parakeet-tdt-0.6b-v2-webgpu"],
    ]) {
      const canonical = JSON.parse(
        await readFile(
          new URL(`../../../../models/${model}/manifest.json`, import.meta.url),
          "utf8",
        ),
      );
      const bytes = canonical.files.reduce(
        (sum: number, file: { size: number }) => sum + file.size,
        0,
      );
      expect(bytes).toBeLessThanOrEqual(budgets[id].download_bytes);
      expect(bytes).toBeLessThanOrEqual(budgets[id].installed_bytes);
    }
  });
  it("accepts pinned objects and notices independently of app-release transport", () => {
    const manifest = modelManifest();
    expect(
      validateManifest(manifest, false, {
        kind: "github",
        owner: "example",
        repo: "app",
      }),
    ).toEqual(manifest);
    expect(versionDirectory(validateManifest(manifest))).toMatch(
      /^0\.1\.0-[a-f0-9]{16}$/,
    );
    expect(
      versionDirectory(
        validateManifest({ ...manifest, app_versions: ["0.2.0"] }),
      ),
    ).toBe(versionDirectory(validateManifest(manifest)));
    const changed = structuredClone(manifest);
    changed.files[0].sha256 = digest("new attribution");
    changed.files[0].url = `https://downloads.animama.ai/models/${modelId}/${changed.files[0].sha256}/ATTRIBUTION.md`;
    expect(versionDirectory(validateManifest(changed))).not.toBe(
      versionDirectory(validateManifest(manifest)),
    );
  });
  it("rejects mixed/legacy model archives and any divergent object reference", () => {
    const manifest = modelManifest();
    for (const extra of [
      { archive_bytes: 12 },
      { url: "https://downloads.animama.ai/archive.tar.zst" },
      { id: "expanded-included-content" },
      { model_id: "other-model" },
    ]) {
      expect(() => validateManifest({ ...manifest, ...extra })).toThrow();
    }
    for (const url of [
      manifest.files[0].url.replace("downloads.animama.ai", "evil.invalid"),
      `${manifest.files[0].url}?token=x`,
      manifest.files[0].url.replace(digest(names[0]), "a".repeat(64)),
      manifest.files[0].url.replace("ATTRIBUTION.md", "other.md"),
    ]) {
      const changed = structuredClone(manifest);
      changed.files[0].url = url;
      expect(() => validateManifest(changed)).toThrow("pack_url_invalid");
    }
    const { model_id: _, ...archive } = manifest;
    expect(() =>
      validateManifest({
        ...archive,
        schema: "animama-feature-pack/1",
        url: "https://github.com/example/app/releases/download/v0.1.0/base.tar.zst",
        archive_bytes: 123,
        archive_sha256: "a".repeat(64),
        files: manifest.files.map(({ url: _, ...file }) => file),
      }),
    ).toThrow("pack_manifest_invalid");
  });
  it("produces approved raw references from the canonical inventory without invoking an archive writer", async () => {
    const root = await mkdtemp(
      path.join(await realpath(tmpdir()), "model-pack-contract-"),
    );
    roots.push(root);
    const input = path.join(root, "inputs");
    await mkdir(input);
    for (const name of names) await writeFile(path.join(input, name), name);
    const files = await inventoryPack(input, "parakeet-stt");
    const canonical = path.join(root, "manifest.json");
    await writeFile(
      canonical,
      JSON.stringify({
        schema_version: 1,
        model_id: modelId,
        license: "CC-BY-4.0",
        files: files.map((file) => ({
          path: file.path,
          size: file.size_bytes,
          sha256: file.sha256,
        })),
      }),
    );
    const ids = [
      "parakeet-stt",
      "parakeet-stt-webgpu",
      "expanded-included-content",
      "document-processing",
    ];
    const writeTar = vi.fn(async () => {
      throw new Error("Model packs must not invoke the archive writer");
    });
    const options = {
      inputs: Object.fromEntries(
        ids.map((id) => [
          id,
          id === "parakeet-stt" ? input : path.join(root, id),
        ]),
      ),
      output: path.join(root, "output"),
      catalog: path.join(root, "pack-catalog.json"),
      appVersion: "0.1.0",
      modelManifests: { "parakeet-stt": canonical },
      release: {
        release_base_url:
          "https://github.com/example/app/releases/download/v0.1.0",
        macos: { team_id: null, designated_requirement: null },
        packs: Object.fromEntries(
          ids.map((id) => [
            id,
            {
              release_status: id === "parakeet-stt" ? "active" : "deferred",
              version: "0.1.0",
              approved_inventory_sha256: null,
              license_refs: ["parakeet-input"],
            },
          ]),
        ),
      },
      budgets: Object.fromEntries(
        ids.map((id) => [
          id,
          { installed_bytes: 1_000_000, download_bytes: null },
        ]),
      ),
      writeTar,
    } as Parameters<typeof buildFeaturePacks>[0];
    expect((await buildFeaturePacks(options)).entries).toEqual([]);
    options.release.packs["parakeet-stt"].approved_inventory_sha256 = digest(
      JSON.stringify(files),
    );
    const result = await buildFeaturePacks(options);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].schema).toBe("animama-model-pack/1");
    expect(result.entries[0].files.map((file) => file.path)).toEqual(names);
    expect(writeTar).not.toHaveBeenCalled();
    expect(
      (await readdir(options.output)).some((name) => name.endsWith(".tar.zst")),
    ).toBe(false);
    const report = JSON.parse(
      await readFile(
        path.join(options.output, "pack-build-report.json"),
        "utf8",
      ),
    );
    expect(report.reports[0].download_bytes).toBe(
      files.reduce((sum, file) => sum + file.size_bytes, 0),
    );
    options.appVersion = "0.2.0";
    expect((await buildFeaturePacks(options)).entries[0].files).toEqual(
      result.entries[0].files,
    );
    const changedCanonical = JSON.parse(await readFile(canonical, "utf8"));
    changedCanonical.files[0].sha256 = "f".repeat(64);
    await writeFile(canonical, JSON.stringify(changedCanonical));
    await expect(buildFeaturePacks(options)).rejects.toThrow(/manifest/i);
  });
});
