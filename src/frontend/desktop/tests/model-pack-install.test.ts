import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
  symlink,
  link,
} from "node:fs/promises";
import { createServer, request as httpRequest, type Server } from "node:http";
import { request as httpsRequest } from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  modelObjectUrl,
  validateManifest,
  type ModelPackManifest,
} from "../src/main-process/feature-packs/catalog.js";
import {
  FeaturePackManager,
  PackInUseError,
  type PackManagerOptions,
} from "../src/main-process/feature-packs/manager.js";
import { RuntimeError } from "../src/main-process/runtime/errors.js";
import { verifyPackFiles } from "../src/main-process/feature-packs/files.js";

// Only the transport boundary is replaced: the catalog still uses the fixed production origin.
vi.mock("node:https", async (original) => ({
  ...(await original<typeof import("node:https")>()),
  request: vi.fn(),
}));
const roots: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
  vi.mocked(httpsRequest).mockReset();
});
const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
async function fixture() {
  const root = await mkdtemp(
    path.join(await realpath(tmpdir()), "model-pack-install-"),
  );
  roots.push(root);
  const payloads = new Map(
    [
      "ATTRIBUTION.md",
      "README.md",
      "config.json",
      "decoder_joint-model.int8.onnx",
      "encoder-model.int8.onnx",
      "nemo128.onnx",
      "vocab.txt",
    ].map((name) => [
      name,
      Buffer.from(name.repeat(name === "vocab.txt" ? 8192 : 1)),
    ]),
  );
  const modelId = "parakeet-tdt-0.6b-v2";
  const files = [...payloads].map(([name, bytes]) => {
    const file = {
      path: name,
      size_bytes: bytes.length,
      sha256: hash(bytes),
      media_type: "application/octet-stream",
      mode: "0644" as const,
    };
    return { ...file, url: modelObjectUrl(modelId, file) };
  });
  const manifest = validateManifest({
    schema: "animama-model-pack/1",
    id: "parakeet-stt",
    model_id: modelId,
    display_name: "Speech",
    version: "0.1.0",
    app_versions: ["0.1.0"],
    platform: "data-only",
    architecture: "data-only",
    installed_bytes: files.reduce((sum, f) => sum + f.size_bytes, 0),
    minimum_peak_free_bytes: 1,
    license_refs: ["fixture"],
    signing: null,
    files,
  }) as ModelPackManifest;
  const requests: { name: string; range?: string }[] = [];
  const control = {
    interrupt: false,
    corrupt: false,
    badRange: false,
    redirect: false,
  };
  const server = createServer((req, res) => {
    const name = decodeURIComponent(
      new URL(req.url!, "http://fixture").pathname.split("/").at(-1)!,
    );
    requests.push({ name, range: req.headers.range });
    const bytes = payloads.get(name)!;
    if (control.redirect) {
      res.writeHead(302, { Location: manifest.files[0].url });
      res.end();
      return;
    }
    let start = Number(
      /^bytes=(\d+)-$/.exec(req.headers.range ?? "")?.[1] ?? 0,
    );
    const ranged = Boolean(req.headers.range);
    res.writeHead(ranged ? 206 : 200, {
      "Content-Length": bytes.length - start,
      ETag: control.badRange && ranged ? '"other"' : '"fixed"',
      ...(ranged
        ? {
            "Content-Range": `bytes ${start}-${bytes.length - 1}/${bytes.length}`,
          }
        : {}),
    });
    if (control.interrupt && name === "vocab.txt") {
      setTimeout(() => res.write(bytes.subarray(start, start + 8192)), 150);
      return;
    }
    const response = Buffer.from(bytes.subarray(start));
    if (control.corrupt && name === "vocab.txt") response[0] ^= 1;
    res.end(response);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("fixture listener missing");
  vi.mocked(httpsRequest).mockImplementation(((
    url: URL,
    options: object,
    callback: Parameters<typeof httpRequest>[2],
  ) =>
    httpRequest(
      new URL(url.pathname, `http://127.0.0.1:${address.port}`),
      options,
      callback,
    )) as typeof httpsRequest);
  const catalog = {
    entries: [manifest],
    development: false,
    distribution: null,
  };
  const make = async (extra: Partial<PackManagerOptions> = {}) => {
    const manager = new FeaturePackManager({
      root: path.join(root, "packs"),
      downloads: path.join(root, "downloads"),
      catalog,
      freeBytes: async () => 1_000_000_000n,
      onProgress: () => {},
      transition: async (change) => change.commit(),
      ...extra,
    });
    await manager.initialize();
    return manager;
  };
  return { root, manifest, catalog, payloads, requests, control, make };
}

describe("verified raw model installation", () => {
  it("installs the complete inventory and reuses it across a compatible app catalog without downloading", async () => {
    const f = await fixture();
    const manager = await f.make();
    await manager.install("parakeet-stt");
    const active = manager.activePacks()["parakeet-stt"]!;
    await verifyPackFiles(active.root, f.manifest);
    expect(await readFile(path.join(active.root, "ATTRIBUTION.md"))).toEqual(
      f.payloads.get("ATTRIBUTION.md"),
    );
    expect(f.requests).toHaveLength(7);
    f.manifest.app_versions = ["0.2.0"];
    const restarted = await f.make();
    expect(restarted.list().find((s) => s.id === "parakeet-stt")?.state).toBe(
      "installed",
    );
    await restarted.install("parakeet-stt");
    expect(f.requests).toHaveLength(7);
  });
  it.each([false, true])(
    "retains completed files and resumes after process restart (mismatched range: %s)",
    async (badRange) => {
      const f = await fixture();
      f.control.interrupt = true;
      let partial!: () => void;
      const started = new Promise<void>((resolve) => (partial = resolve));
      const manager = await f.make({
        onProgress: (status) => {
          if ((status.transferredBytes ?? 0) > 8192) partial();
        },
      });
      const install = manager.install("parakeet-stt");
      const rejected = expect(install).rejects.toThrow("pack_cancelled");
      await started;
      await manager.close();
      await rejected;
      expect(manager.activePacks()).toEqual({});
      f.control.interrupt = false;
      f.control.badRange = badRange;
      const restarted = await f.make();
      await restarted.install("parakeet-stt");
      expect(f.requests.filter((r) => r.name !== "vocab.txt")).toHaveLength(6);
      expect(f.requests.filter((r) => r.name === "vocab.txt")[1]?.range).toBe(
        "bytes=8192-",
      );
      if (badRange) expect(f.requests.at(-1)?.range).toBeUndefined();
      expect(restarted.activePacks()["parakeet-stt"]).toBeDefined();
    },
  );
  it("rejects corrupt raw bytes without activation, then retries only the failed file", async () => {
    const f = await fixture();
    f.control.corrupt = true;
    const manager = await f.make();
    await expect(manager.install("parakeet-stt")).rejects.toThrow(
      "pack_file_hash_invalid",
    );
    expect(manager.activePacks()).toEqual({});
    f.control.corrupt = false;
    await manager.install("parakeet-stt");
    expect(f.requests.filter((r) => r.name !== "vocab.txt")).toHaveLength(6);
    expect(f.requests.filter((r) => r.name === "vocab.txt")).toHaveLength(2);
  });
  it("does not make a network request without enough free space or after an untrusted redirect", async () => {
    const f = await fixture();
    const blocked = await f.make({ freeBytes: async () => 1n });
    await expect(blocked.install("parakeet-stt")).rejects.toThrow(
      "pack_insufficient_disk",
    );
    expect(f.requests).toEqual([]);
    f.control.redirect = true;
    const manager = await f.make();
    await expect(manager.install("parakeet-stt")).rejects.toThrow(
      "pack_download_redirect",
    );
    expect(f.requests).toHaveLength(1);
    expect(manager.activePacks()).toEqual({});
  });
  it.each(["extra", "symlink", "hardlink"])(
    "rejects %s entries in retained model downloads",
    async (kind) => {
      const f = await fixture();
      f.control.corrupt = true;
      const manager = await f.make();
      await expect(manager.install("parakeet-stt")).rejects.toThrow(
        "pack_file_hash_invalid",
      );
      const directory = path.join(
        f.root,
        "downloads",
        (await readdir(path.join(f.root, "downloads")))[0],
      );
      if (kind === "extra")
        await writeFile(path.join(directory, "unexpected"), "data");
      else {
        await rm(path.join(directory, "0.complete"));
        const outside = path.join(f.root, "outside");
        await writeFile(outside, "keep");
        await (kind === "symlink" ? symlink : link)(
          outside,
          path.join(directory, "0.complete"),
        );
      }
      const before = f.requests.length;
      await expect(manager.install("parakeet-stt")).rejects.toThrow(
        kind === "extra" ? "pack_inventory_invalid" : "pack_path_invalid",
      );
      expect(f.requests).toHaveLength(before);
      expect(manager.activePacks()).toEqual({});
    },
  );
  it("rechecks a corrupt completed cache file and refetches only it plus the failed file", async () => {
    const f = await fixture();
    f.control.corrupt = true;
    const manager = await f.make();
    await expect(manager.install("parakeet-stt")).rejects.toThrow(
      "pack_file_hash_invalid",
    );
    const directory = path.join(
      f.root,
      "downloads",
      (await readdir(path.join(f.root, "downloads")))[0],
    );
    await writeFile(path.join(directory, "0.complete"), "corrupt");
    f.control.corrupt = false;
    await manager.install("parakeet-stt");
    expect(f.requests.filter((r) => r.name === "ATTRIBUTION.md")).toHaveLength(
      2,
    );
    expect(f.requests.filter((r) => r.name === "README.md")).toHaveLength(1);
  });
  it("rolls a failed replacement back to the prior verified model and retries retained complete bytes", async () => {
    const f = await fixture();
    let reject = false;
    const manager = await f.make({
      transition: async (change) => {
        await change.commit();
        if (reject) throw new RuntimeError("pack_activation_failed");
      },
    });
    await manager.install("parakeet-stt");
    const old = manager.activePacks()["parakeet-stt"]!;
    const oldBytes = await readFile(path.join(old.root, "vocab.txt"));
    const priorPointer = await readFile(
      path.join(f.root, "packs/active.json"),
      "utf8",
    );
    const changed = structuredClone(f.manifest);
    changed.version = "0.2.0";
    const bytes = Buffer.from("new vocabulary");
    f.payloads.set("vocab.txt", bytes);
    changed.files.at(-1)!.size_bytes = bytes.length;
    changed.files.at(-1)!.sha256 = hash(bytes);
    changed.files.at(-1)!.url = modelObjectUrl(
      changed.model_id,
      changed.files.at(-1)!,
    );
    changed.installed_bytes = changed.files.reduce(
      (sum, file) => sum + file.size_bytes,
      0,
    );
    f.catalog.entries = [changed];
    reject = true;
    await expect(manager.install("parakeet-stt")).rejects.toThrow(
      "pack_activation_failed",
    );
    expect(manager.activePacks()["parakeet-stt"]!.root).toBe(old.root);
    expect(await readFile(path.join(old.root, "vocab.txt"))).toEqual(oldBytes);
    expect(await readFile(path.join(f.root, "packs/active.json"), "utf8")).toBe(
      priorPointer,
    );
    const requests = f.requests.length;
    reject = false;
    await manager.install("parakeet-stt");
    expect(f.requests).toHaveLength(requests);
    expect(manager.activePacks()["parakeet-stt"]!.manifest.version).toBe(
      "0.2.0",
    );
  });
  it("preserves GPU dependencies and the active-use removal barrier for model packs", async () => {
    const f = await fixture();
    f.payloads.set("encoder-model.fp16.onnx", Buffer.from("gpu encoder"));
    const gpu = structuredClone(f.manifest);
    gpu.id = "parakeet-stt-webgpu";
    gpu.model_id = "parakeet-tdt-0.6b-v2-webgpu";
    gpu.files = ["ATTRIBUTION.md", "README.md", "encoder-model.fp16.onnx"].map(
      (name) => {
        const bytes = f.payloads.get(name)!;
        const file = {
          path: name,
          size_bytes: bytes.length,
          sha256: hash(bytes),
          media_type: "application/octet-stream",
          mode: "0644" as const,
        };
        return { ...file, url: modelObjectUrl(gpu.model_id, file) };
      },
    );
    gpu.installed_bytes = gpu.files.reduce(
      (sum, file) => sum + file.size_bytes,
      0,
    );
    f.catalog.entries.push(gpu);
    let inUse = false;
    const manager = await f.make({
      transition: async (change) => {
        if (change.removing && inUse)
          throw new PackInUseError([
            { kind: "lease", id: "preview", label: "Close preview" },
          ]);
        await change.commit();
      },
    });
    await expect(manager.install(gpu.id)).rejects.toThrow(
      "pack_dependency_missing",
    );
    expect(f.requests).toEqual([]);
    await manager.install("parakeet-stt");
    await manager.install(gpu.id);
    await expect(manager.remove("parakeet-stt")).rejects.toThrow(
      "pack_dependent_installed",
    );
    inUse = true;
    await expect(manager.remove(gpu.id)).rejects.toThrow("pack_in_use");
    expect(manager.activePacks()[gpu.id]).toBeDefined();
    inUse = false;
    await manager.remove(gpu.id);
    await manager.remove("parakeet-stt");
    expect(manager.activePacks()).toEqual({});
  });
});
