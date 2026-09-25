import { createHash, randomBytes } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { zstdCompressSync } from "node:zlib";
import { pack, type Headers } from "tar-stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  downloadUrl,
  loadPackCatalog,
  manifestDigest,
  validateManifest,
  versionDirectory,
  type PackManifest,
} from "../src/main-process/feature-packs/catalog.js";
import { downloadPack } from "../src/main-process/feature-packs/download.js";
import { extractPack } from "../src/main-process/feature-packs/extract.js";
import {
  FeaturePackManager,
  type PackTransition,
} from "../src/main-process/feature-packs/manager.js";
import { RuntimeError } from "../src/main-process/runtime/errors.js";
import { runCommand } from "../src/main-process/runtime/processes.js";
import {
  DOCUMENT_EXECUTABLE,
  verifyExecutablePack,
} from "../src/main-process/feature-packs/signature.js";
import {
  buildFeaturePacks,
  buildPackArchive,
  inventoryPack,
} from "../scripts/runtime/feature-pack-build.js";
import {
  exportWorkerInput,
  importWorkerInput,
} from "../scripts/runtime/worker-input.js";

// Command-boundary tests prove the verification policy, not a native signature.
vi.mock("../src/main-process/runtime/processes.js", () => ({
  runCommand: vi.fn(async () => ""),
}));

const roots: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  vi.mocked(runCommand).mockReset().mockResolvedValue("");
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

describe("feature-packs executable custody", () => {
  it.skipIf(process.platform !== "darwin")(
    "requires the pinned OS publisher and Gatekeeper assessment after inventory verification",
    async () => {
      const root = await temporary();
      const bytes = Buffer.from("feedfacf00000000", "hex");
      const file = path.join(root, DOCUMENT_EXECUTABLE);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, bytes, { mode: 0o755 });
      const input = await fixture();
      const manifest: PackManifest = {
        ...input.manifest,
        id: "document-processing",
        platform: "darwin",
        architecture: "arm64",
        installed_bytes: bytes.length,
        signing: {
          publisher: "TESTTEAM01",
          requirement: "identifier com.animama.document-worker",
        },
        files: [
          {
            path: DOCUMENT_EXECUTABLE,
            size_bytes: bytes.length,
            sha256: sha(bytes),
            media_type: "application/octet-stream",
            mode: "0755",
          },
        ],
      };
      await verifyExecutablePack(root, manifest);
      const calls = vi.mocked(runCommand).mock.calls;
      expect(calls).toHaveLength(3);
      expect(calls[0]?.[0]).toBe("/usr/bin/codesign");
      expect(calls[0]?.[1]).toEqual([
        "--verify",
        "--strict",
        "-R",
        '=anchor apple generic and certificate leaf[subject.OU] = "TESTTEAM01"',
        file,
      ]);
      expect(calls[1]?.[1]).toContain("--deep");
      expect(calls[1]?.[1]).toContain(
        '=(anchor apple generic and certificate leaf[subject.OU] = "TESTTEAM01") and (identifier com.animama.document-worker)',
      );
      expect(calls[2]?.[0]).toBe("/usr/sbin/spctl");
      vi.mocked(runCommand).mockRejectedValueOnce(
        new Error("invalid signature"),
      );
      await expect(verifyExecutablePack(root, manifest)).rejects.toThrow(
        "pack_signature_invalid",
      );
      vi.mocked(runCommand).mockClear();
      await writeFile(file, "corrupt");
      await expect(verifyExecutablePack(root, manifest)).rejects.toThrow();
      expect(runCommand).not.toHaveBeenCalled();
    },
  );
});
async function temporary(): Promise<string> {
  const root = await mkdtemp(
    path.join(await realpath(tmpdir()), "animama-packs-test-"),
  );
  roots.push(root);
  return root;
}
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
async function tarBytes(
  entries: { name: string; bytes?: Buffer; header?: Partial<Headers> }[],
): Promise<Buffer> {
  const archive = pack();
  const chunks: Buffer[] = [];
  const consume = (async () => {
    for await (const chunk of archive) chunks.push(Buffer.from(chunk));
  })();
  for (const entry of entries)
    archive.entry(
      {
        name: entry.name,
        size: entry.bytes?.length ?? 0,
        mode: 0o644,
        mtime: new Date(0),
        ...entry.header,
      },
      entry.bytes ?? Buffer.alloc(0),
    );
  archive.finalize();
  await consume;
  return Buffer.concat(chunks);
}
async function fixture(bytes = Buffer.from('{"fixture":true}')) {
  const tar = await tarBytes([{ name: "config.json", bytes }]);
  const archive = zstdCompressSync(tar);
  const manifest: PackManifest = {
    schema: "animama-feature-pack/1",
    id: "parakeet-stt",
    display_name: "Offline speech recognition",
    version: "0.1.0",
    app_versions: ["0.1.0"],
    platform: "data-only",
    architecture: "data-only",
    url: "https://github.com/example/animama/releases/download/v0.1.0/parakeet.tar.zst",
    archive_bytes: archive.length,
    archive_sha256: sha(archive),
    installed_bytes: bytes.length,
    minimum_peak_free_bytes: 100,
    license_refs: ["fixture-only"],
    signing: null,
    files: [
      {
        path: "config.json",
        size_bytes: bytes.length,
        sha256: sha(bytes),
        media_type: "application/json",
        mode: "0644",
      },
    ],
  };
  return { tar, archive, manifest, bytes };
}
async function serve(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("missing test listener");
  return `http://127.0.0.1:${address.port}/pack.tar.zst`;
}
async function hostedFixture() {
  const input = await fixture();
  input.manifest.url = await serve((_req, res) => {
    res.writeHead(200, {
      "Content-Length": input.archive.length,
      ETag: '"fixture"',
    });
    res.end(input.archive);
  });
  return input;
}
async function manager(
  manifest: PackManifest,
  options: {
    root?: string;
    transition?: (change: PackTransition) => Promise<void>;
    freeBytes?: bigint;
  } = {},
) {
  const root = options.root ?? (await temporary());
  const progress = vi.fn();
  const instance = new FeaturePackManager({
    root: path.join(root, "packs"),
    downloads: path.join(root, "downloads"),
    catalog: { entries: [manifest], development: true, distribution: null },
    freeBytes: async () => options.freeBytes ?? 100_000_000_000n,
    onProgress: progress,
    transition: options.transition ?? (async (change) => change.commit()),
  });
  await instance.initialize();
  return { instance, root, progress };
}

describe("feature-packs catalog and authority", () => {
  it("accepts a pinned catalog but rejects a packaged development override and arbitrary download hosts", async () => {
    const { manifest } = await fixture();
    validateManifest(manifest);
    const root = await temporary();
    const body = {
      schema: "animama-pack-catalog/1",
      app_version: "0.1.0",
      entries: [manifest],
    };
    const catalog = path.join(root, "pack-catalog.json");
    await writeFile(
      catalog,
      JSON.stringify({ id: sha(Buffer.from(JSON.stringify(body))), ...body }),
    );
    expect(
      (
        await loadPackCatalog({
          runtimeRoot: root,
          appVersion: "0.1.0",
          isPackaged: true,
        })
      ).entries,
    ).toHaveLength(1);
    await expect(
      loadPackCatalog({
        runtimeRoot: root,
        appVersion: "0.1.0",
        isPackaged: true,
        fixturePath: catalog,
      }),
    ).rejects.toThrow("development_override_forbidden");
    expect(() =>
      validateManifest({
        ...manifest,
        url: "https://hostile.invalid/payload.tar.zst",
      }),
    ).toThrow("pack_url_invalid");
    expect(() =>
      validateManifest({ ...manifest, url: "http://127.0.0.1:1234/payload" }),
    ).toThrow("pack_url_invalid");
  });
  it("pins pack downloads to the distribution sealed in the update policy", async () => {
    const { manifest } = await fixture();
    const r2 = {
      kind: "r2" as const,
      base_url: "https://downloads.example.test/desktop",
    };
    const github = {
      kind: "github" as const,
      owner: "example",
      repo: "animama",
    };
    const r2Url =
      "https://downloads.example.test/desktop/v0.1.0/parakeet.tar.zst";
    const r2Manifest = { ...manifest, url: r2Url };
    expect(validateManifest(r2Manifest, false, r2).url).toBe(r2Url);
    expect(validateManifest(manifest, false, github).url).toBe(manifest.url);
    for (const [url, distribution] of [
      [manifest.url, r2],
      [r2Url, github],
      [r2Url, null],
      [
        "https://github.com/other/repo/releases/download/v0.1.0/parakeet.tar.zst",
        github,
      ],
      [
        "https://downloads.example.test/desktop/v0.1.0/parakeet.tar.zst?x=1",
        r2,
      ],
      ["https://downloads.example.test/desktop/latest/parakeet.tar.zst", r2],
      ["https://downloads.example.test/desktop/v0.1.0/a/parakeet.tar.zst", r2],
      ["https://downloads.example.test/other/v0.1.0/parakeet.tar.zst", r2],
      ["https://evil.example.test/desktop/v0.1.0/parakeet.tar.zst", r2],
    ] as const)
      expect(() =>
        validateManifest({ ...manifest, url }, false, distribution),
      ).toThrow("pack_url_invalid");
    // R2 serves the object directly; any redirect leaves the sealed origin.
    expect(() =>
      downloadUrl("https://release-assets.githubusercontent.com/x", {
        development: false,
        distribution: r2,
        redirect: true,
      }),
    ).toThrow("pack_url_invalid");
    expect(
      downloadUrl("https://release-assets.githubusercontent.com/x", {
        development: false,
        distribution: github,
        redirect: true,
      }).hostname,
    ).toBe("release-assets.githubusercontent.com");

    const root = await temporary();
    const body = {
      schema: "animama-pack-catalog/1",
      app_version: "0.1.0",
      entries: [r2Manifest],
    };
    await writeFile(
      path.join(root, "pack-catalog.json"),
      JSON.stringify({ id: sha(Buffer.from(JSON.stringify(body))), ...body }),
    );
    const load = () =>
      loadPackCatalog({
        runtimeRoot: root,
        appVersion: "0.1.0",
        isPackaged: true,
      });
    // Without a sealed R2 policy, an R2 pack URL is not trusted.
    await expect(load()).rejects.toThrow("pack_url_invalid");
    await writeFile(
      path.join(root, "update-policy.json"),
      JSON.stringify({
        schema: "animama-update-policy/2",
        distribution: r2,
        channel: "stable",
        team_id: "TESTTEAM01",
      }),
    );
    expect(await load()).toMatchObject({ distribution: r2 });
    await writeFile(
      path.join(root, "update-policy.json"),
      JSON.stringify({ distribution: { kind: "r2", base_url: "http://x" } }),
    );
    await expect(load()).rejects.toThrow("pack_catalog_invalid");
    await writeFile(
      path.join(root, "update-policy.json"),
      JSON.stringify({ distribution: null }),
    );
    await expect(load()).rejects.toThrow("pack_catalog_invalid");
  });
  it.each([
    "../escape",
    "/absolute",
    "a//b",
    "a/./b",
    "a\\b",
    "C:drive",
    "nul.txt",
    "trailing.",
    "e\u0301.txt",
  ])("rejects nonportable manifest paths: %s", async (name) => {
    const { manifest } = await fixture();
    expect(() =>
      validateManifest({
        ...manifest,
        files: [{ ...manifest.files[0], path: name }],
      }),
    ).toThrow();
  });
  it("rejects case/Unicode aliases and missing executable publisher metadata", async () => {
    const { manifest } = await fixture();
    for (const names of [
      ["A/file", "a/other"],
      ["SS", "ß"],
    ]) {
      expect(() =>
        validateManifest({
          ...manifest,
          installed_bytes: 2 * manifest.installed_bytes,
          files: names.map((name) => ({ ...manifest.files[0], path: name })),
        }),
      ).toThrow("pack_path_collision");
    }
    expect(() =>
      validateManifest({ ...manifest, id: "document-processing" }),
    ).toThrow("pack_signature_required");
  });
});

describe("feature-packs extraction", () => {
  it("writes only verified files and preserves exact modes", async () => {
    const input = await fixture();
    const root = await temporary();
    const archive = path.join(root, "archive");
    await writeFile(archive, input.archive);
    await extractPack(
      archive,
      path.join(root, "staging"),
      input.manifest,
      new AbortController().signal,
    );
    expect(await readFile(path.join(root, "staging/config.json"))).toEqual(
      input.bytes,
    );
    expect(
      (await stat(path.join(root, "staging/config.json"))).mode & 0o777,
    ).toBe(0o644);
  });
  it.each(["../escape", "/absolute", "a//b", "config.json/config.json"])(
    "does not extract malicious archive path %s",
    async (name) => {
      const input = await fixture();
      const root = await temporary();
      const archive = path.join(root, "archive");
      await writeFile(
        archive,
        zstdCompressSync(await tarBytes([{ name, bytes: input.bytes }])),
      );
      await expect(
        extractPack(
          archive,
          path.join(root, "staging"),
          input.manifest,
          new AbortController().signal,
        ),
      ).rejects.toThrow();
    },
  );
  it.each([49, 50, 51, 52, 54, 55, 83, 120, 103, 76, 75, 115])(
    "rejects special, sparse, PAX, and GNU type byte %i before extraction",
    async (type) => {
      const input = await fixture();
      const raw = Buffer.from(input.tar);
      raw[156] = type;
      raw.fill(32, 148, 156);
      const checksum = raw
        .subarray(0, 512)
        .reduce((sum, byte) => sum + byte, 0);
      raw.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
      const root = await temporary();
      const archive = path.join(root, "archive");
      await writeFile(archive, zstdCompressSync(raw));
      await expect(
        extractPack(
          archive,
          path.join(root, "staging"),
          input.manifest,
          new AbortController().signal,
        ),
      ).rejects.toThrow("pack_entry_type_invalid");
    },
  );
  it("rejects duplicates, undeclared bytes, file hash mismatches, and expansion bombs", async () => {
    const input = await fixture();
    const root = await temporary();
    const variants = [
      [
        { name: "config.json", bytes: input.bytes },
        { name: "config.json", bytes: input.bytes },
      ],
      [{ name: "extra.json", bytes: input.bytes }],
      [{ name: "config.json", bytes: Buffer.alloc(input.bytes.length, 42) }],
      [{ name: "config.json", bytes: Buffer.alloc(2 * 1024 * 1024) }],
    ];
    for (const [index, entries] of variants.entries()) {
      const archive = path.join(root, `archive-${index}`);
      await writeFile(archive, zstdCompressSync(await tarBytes(entries)));
      await expect(
        extractPack(
          archive,
          path.join(root, `staging-${index}`),
          input.manifest,
          new AbortController().signal,
        ),
      ).rejects.toThrow();
    }
  });
});

describe("feature-packs download and recovery", () => {
  it("repairs corrupt inactive bytes and cleans interrupted staging without trusting it", async () => {
    const input = await hostedFixture();
    const first = await manager(input.manifest);
    await first.instance.install(input.manifest.id);
    const active = first.instance.activePacks()[input.manifest.id]!;
    await first.instance.close();
    await writeFile(path.join(active.root, "config.json"), "corrupted");
    const interrupted = path.join(
      path.dirname(active.root),
      ".staging-00000000-0000-4000-8000-000000000001",
    );
    await mkdir(interrupted);
    await writeFile(path.join(interrupted, "untrusted"), "never mounted");
    const next = await manager(input.manifest, { root: first.root });
    expect(next.instance.activePacks()).toEqual({});
    await expect(stat(interrupted)).rejects.toMatchObject({ code: "ENOENT" });
    await next.instance.install(input.manifest.id);
    expect(await readFile(path.join(active.root, "config.json"))).toEqual(
      input.bytes,
    );
    expect(
      (await readdir(path.dirname(active.root))).some((name) =>
        name.startsWith(".rejected-"),
      ),
    ).toBe(true);
    await next.instance.remove(input.manifest.id);
    expect(await readdir(path.dirname(active.root))).toEqual([]);
    await next.instance.close();
  });
  it.each([true, false, "wrong-length", "wrong-etag"])(
    "resumes only with proven range/ETag identity (range response: %s)",
    async (ranges) => {
      const input = await fixture();
      const requests: (string | undefined)[] = [];
      input.manifest.url = await serve((req, res) => {
        requests.push(req.headers.range);
        const start = ranges && req.headers.range ? 17 : 0;
        res.writeHead(start ? 206 : 200, {
          ETag: ranges === "wrong-etag" && start ? '"different"' : '"exact"',
          "Content-Length":
            input.archive.length -
            start +
            (ranges === "wrong-length" && start ? 1 : 0),
          ...(start
            ? {
                "Content-Range": `bytes ${start}-${input.archive.length - 1}/${input.archive.length}`,
              }
            : {}),
        });
        res.end(input.archive.subarray(start));
      });
      const root = await temporary();
      const partial = path.join(root, "partial");
      await writeFile(partial, input.archive.subarray(0, 17));
      await writeFile(
        `${partial}.json`,
        JSON.stringify({
          url: input.manifest.url,
          sha256: input.manifest.archive_sha256,
          etag: '"exact"',
        }),
      );
      await downloadPack({
        distribution: null,
        manifest: input.manifest,
        partial,
        development: true,
        signal: new AbortController().signal,
        progress: () => undefined,
      });
      expect(await readFile(partial)).toEqual(input.archive);
      expect(requests).toEqual(
        ranges === true ? ["bytes=17-"] : ["bytes=17-", undefined],
      );
    },
  );
  it.each(["length", "hash"])(
    "rejects incorrect archive %s",
    async (failure) => {
      const input = await fixture();
      input.manifest.url = await serve((_req, res) => {
        res.writeHead(200, {
          "Content-Length":
            input.archive.length + (failure === "length" ? 1 : 0),
        });
        res.end(Buffer.alloc(input.archive.length));
      });
      await expect(
        downloadPack({
          distribution: null,
          manifest: input.manifest,
          partial: path.join(await temporary(), "partial"),
          development: true,
          signal: new AbortController().signal,
          progress: () => undefined,
        }),
      ).rejects.toThrow(
        failure === "length"
          ? "pack_download_length_invalid"
          : "pack_archive_hash_invalid",
      );
    },
  );
  it("cancels a download and preserves its bounded partial for safe retry", async () => {
    const input = await fixture(randomBytes(128 * 1024));
    input.manifest.url = await serve((_req, res) => {
      res.writeHead(200, {
        "Content-Length": input.archive.length,
        ETag: '"slow"',
      });
      res.write(input.archive.subarray(0, 1024));
      const timer = setTimeout(
        () => res.end(input.archive.subarray(1024)),
        1000,
      );
      res.on("close", () => clearTimeout(timer));
    });
    const { instance, root, progress } = await manager(input.manifest);
    const installation = instance.install("parakeet-stt");
    const rejected = expect(installation).rejects.toThrow("pack_cancelled");
    await vi.waitFor(() =>
      expect(progress).toHaveBeenCalledWith(
        expect.objectContaining({ transferredBytes: 1024 }),
      ),
    );
    instance.cancel("parakeet-stt");
    await rejected;
    expect(instance.activePacks()).toEqual({});
    expect(
      (await stat(path.join(root, "downloads/parakeet-stt.0.1.0.partial")))
        .size,
    ).toBe(1024);
    await instance.close();
  });
  it.each(["before-response", "mid-stream"])(
    "reports a pack download failure and safely retries a disconnect %s",
    async (failure) => {
      const input = await fixture(randomBytes(128 * 1024));
      const requests: (string | undefined)[] = [];
      let interrupted: ServerResponse | undefined;
      input.manifest.url = await serve((req, res) => {
        requests.push(req.headers.range);
        if (requests.length === 1 && failure === "before-response") {
          res.destroy();
          return;
        }
        const start = req.headers.range ? 1024 : 0;
        res.writeHead(start ? 206 : 200, {
          "Content-Length": input.archive.length - start,
          ETag: '"retry"',
          ...(start
            ? {
                "Content-Range": `bytes ${start}-${input.archive.length - 1}/${input.archive.length}`,
              }
            : {}),
        });
        if (requests.length === 1) {
          interrupted = res;
          res.write(input.archive.subarray(0, 1024));
        } else res.end(input.archive.subarray(start));
      });
      const { instance, progress } = await manager(input.manifest);
      const rejected = expect(instance.install("parakeet-stt")).rejects.toThrow(
        "pack_download_failed",
      );
      if (failure === "mid-stream") {
        await vi.waitFor(() =>
          expect(progress).toHaveBeenCalledWith(
            expect.objectContaining({ transferredBytes: 1024 }),
          ),
        );
        interrupted!.destroy();
      }
      await rejected;
      expect(instance.list()[0]).toMatchObject({
        state: "failed",
        error: "pack_download_failed",
      });
      expect(instance.activePacks()).toEqual({});
      await instance.install("parakeet-stt");
      expect(requests).toEqual([
        undefined,
        failure === "mid-stream" ? "bytes=1024-" : undefined,
      ]);
      expect(instance.list()[0].state).toBe("installed");
      await instance.close();
    },
  );
  it("keeps the prior pointer on transition failure and reconstructs only verified installed state", async () => {
    const input = await hostedFixture();
    const first = await manager(input.manifest);
    await first.instance.install("parakeet-stt");
    expect(first.instance.list()[0]).toMatchObject({
      state: "installed",
      available: true,
    });
    await first.instance.close();
    const prior = await readFile(
      path.join(first.root, "packs/active.json"),
      "utf8",
    );
    const second = await manager(input.manifest, {
      root: first.root,
      transition: async (change) => {
        await change.commit();
        throw new RuntimeError("pack_in_use");
      },
    });
    expect(second.instance.list()[0]).toMatchObject({ state: "installed" });
    await expect(second.instance.remove("parakeet-stt")).rejects.toThrow(
      "pack_in_use",
    );
    expect(
      await readFile(path.join(first.root, "packs/active.json"), "utf8"),
    ).toBe(prior);
    expect(second.instance.activePacks()["parakeet-stt"]?.root).toBe(
      first.instance.activePacks()["parakeet-stt"]?.root,
    );
    await second.instance.close();
    const root = path.join(
      first.root,
      "packs/parakeet-stt/versions",
      versionDirectory(input.manifest),
    );
    await writeFile(path.join(root, "config.json"), "corrupt");
    const recovered = await manager(input.manifest, { root: first.root });
    expect(recovered.instance.list()[0]).toMatchObject({ state: "failed" });
    expect(recovered.instance.activePacks()).toEqual({});
    await recovered.instance.close();
  });
  it("reports an app-matched replacement without mounting old untrusted bytes", async () => {
    const input = await hostedFixture();
    const first = await manager(input.manifest);
    await first.instance.install("parakeet-stt");
    await first.instance.close();
    const replacement = { ...input.manifest, version: "0.2.0" };
    expect(manifestDigest(replacement)).not.toBe(
      manifestDigest(input.manifest),
    );
    const next = await manager(replacement, { root: first.root });
    expect(next.instance.list()[0]).toMatchObject({
      state: "update_available",
    });
    expect(next.instance.activePacks()).toEqual({});
    await next.instance.install("parakeet-stt");
    expect(next.instance.list()[0]).toMatchObject({
      state: "installed",
      version: "0.2.0",
    });
    await stat(
      path.join(
        first.root,
        "packs/parakeet-stt/versions",
        versionDirectory(input.manifest),
      ),
    );
    await next.instance.remove("parakeet-stt");
    expect(next.instance.activePacks()).toEqual({});
    await next.instance.close();
  });
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "keeps failed deletion retryable after restart without remounting the pack",
    async () => {
      const input = await hostedFixture();
      const first = await manager(input.manifest);
      await first.instance.install("parakeet-stt");
      const versions = path.join(first.root, "packs/parakeet-stt/versions");
      await chmod(versions, 0o300);
      try {
        await expect(first.instance.remove("parakeet-stt")).rejects.toThrow(
          "pack_cleanup_pending",
        );
        expect(first.instance.activePacks()).toEqual({});
        expect(first.instance.list()[0]).toMatchObject({
          hasInstalledFiles: true,
          error: "pack_cleanup_pending",
        });
      } finally {
        await chmod(versions, 0o700);
        await first.instance.close();
      }
      const restarted = await manager(input.manifest, { root: first.root });
      expect(restarted.instance.activePacks()).toEqual({});
      expect(restarted.instance.list()[0]).toMatchObject({
        state: "not_installed",
        hasInstalledFiles: true,
      });
      await restarted.instance.remove("parakeet-stt");
      expect(await readdir(versions)).toEqual([]);
      expect(restarted.instance.list()[0].hasInstalledFiles).toBe(false);
      await restarted.instance.close();
    },
  );
  it("does not download without disk space, a catalog entry, or a valid pack ID", async () => {
    const input = await fixture();
    const result = await manager(input.manifest, { freeBytes: 1n });
    await expect(result.instance.install("parakeet-stt")).rejects.toThrow(
      "pack_insufficient_disk",
    );
    await expect(
      result.instance.install("document-processing"),
    ).rejects.toThrow("pack_unpublished");
    expect(() => result.instance.install("../../arbitrary")).toThrow(
      "feature_pack_invalid",
    );
    await result.instance.close();
  });
});

describe("feature-packs build artifacts", () => {
  const writeTar = async (
    source: string,
    files: PackManifest["files"],
    output: string,
  ) => {
    const entries = [];
    for (const file of files)
      entries.push({
        name: file.path,
        bytes: await readFile(path.join(source, file.path)),
        header: { mode: parseInt(file.mode, 8) },
      });
    await writeFile(output, await tarBytes(entries));
  };
  it.skipIf(process.platform !== "darwin")(
    "reuses exact reviewed helper bytes without rebuilding or silently approving a candidate",
    async () => {
      const root = await temporary();
      const input = path.join(root, "signed-input");
      const executable = path.join(input, DOCUMENT_EXECUTABLE);
      await mkdir(path.dirname(executable), { recursive: true });
      const nativeBytes = Buffer.from("feedfacf00000000", "hex");
      await writeFile(executable, nativeBytes, { mode: 0o755 });
      const options = {
        root: input,
        exchange: path.join(root, "exchange"),
        appVersion: "0.1.0",
        writeTar,
        release: {
          release_base_url:
            "https://github.com/example/animama/releases/download/v0.1.0",
          macos: {
            team_id: "TESTTEAM01",
            designated_requirement: "identifier com.animama.document-worker",
          },
          packs: {
            "document-processing": {
              version: "0.1.0",
              approved_inventory_sha256: null as string | null,
              license_refs: ["fixture"],
            },
          },
        },
      };
      await exportWorkerInput(options);
      const review = JSON.parse(
        await readFile(
          path.join(options.exchange, "worker-review.json"),
          "utf8",
        ),
      );
      expect(review.release_approved).toBe(false);
      await expect(importWorkerInput(options)).rejects.toThrow(
        "reviewed inventory",
      );
      // This is a fixture-only approval. OS verification remains mocked at the command boundary.
      options.release.packs["document-processing"].approved_inventory_sha256 =
        review.inventory_sha256;
      await writeFile(
        path.join(input, "old-build-marker"),
        "keep until verified",
      );
      await importWorkerInput(options);
      expect(await readFile(executable)).toEqual(nativeBytes);
      expect(await readdir(input)).not.toContain("old-build-marker");
      await writeFile(
        path.join(options.exchange, "document-worker-input.tar.zst"),
        "tampered",
      );
      await expect(importWorkerInput(options)).rejects.toThrow(
        "archive changed",
      );
      expect(await readFile(executable)).toEqual(nativeBytes);
    },
  );
  it("round-trips the actual archive before returning measured release metadata", async () => {
    const input = await fixture();
    const root = await temporary();
    await writeFile(path.join(root, "config.json"), input.bytes);
    const manifest = await buildPackArchive({
      root,
      output: path.join(root, "result.tar.zst"),
      writeTar,
      manifest: input.manifest,
    });
    expect((await stat(path.join(root, "result.tar.zst"))).size).toBe(
      manifest.archive_bytes,
    );
    expect(manifest.archive_sha256).toBe(
      sha(await readFile(path.join(root, "result.tar.zst"))),
    );
    expect(manifest.minimum_peak_free_bytes).toBeGreaterThan(
      manifest.archive_bytes + manifest.installed_bytes,
    );
  });
  it("leaves unapproved inputs unpublished, then pins only the exact reviewed inventory", async () => {
    const root = await temporary();
    const inputs = path.join(root, "expanded");
    await mkdir(inputs);
    await writeFile(path.join(inputs, "fixture.json"), "{}");
    const release = {
      release_base_url:
        "https://github.com/example/animama/releases/download/v0.1.0",
      macos: { team_id: null, designated_requirement: null },
      packs: Object.fromEntries(
        [
          "parakeet-stt",
          "expanded-included-content",
          "document-processing",
        ].map((id) => [
          id,
          {
            release_status: "active" as const,
            version: "0.1.0",
            approved_inventory_sha256: null as string | null,
            license_refs: ["fixture-only"],
          },
        ]),
      ),
    };
    const options = {
      inputs: {
        "expanded-included-content": inputs,
        "parakeet-stt": path.join(root, "missing-speech"),
        "document-processing": path.join(root, "missing-worker"),
      },
      output: path.join(root, "archives"),
      catalog: path.join(root, "pack-catalog.json"),
      appVersion: "0.1.0",
      release,
      budgets: Object.fromEntries(
        [
          "parakeet-stt",
          "expanded-included-content",
          "document-processing",
        ].map((id) => [id, { installed_bytes: 100_000, download_bytes: null }]),
      ),
      writeTar,
    } as Parameters<typeof buildFeaturePacks>[0];
    expect((await buildFeaturePacks(options)).entries).toEqual([]);
    const files = await inventoryPack(inputs, "expanded-included-content");
    options.release.packs[
      "expanded-included-content"
    ].approved_inventory_sha256 = sha(Buffer.from(JSON.stringify(files)));
    const built = await buildFeaturePacks(options);
    expect(built.entries).toHaveLength(1);
    expect(
      (
        await loadPackCatalog({
          runtimeRoot: root,
          appVersion: "0.1.0",
          isPackaged: true,
        })
      ).entries,
    ).toEqual(built.entries);
    const compatible = options.release.packs["expanded-included-content"];
    compatible.release_status = "deferred";
    expect((await buildFeaturePacks(options)).entries).toEqual([]);
    const deferred = JSON.parse(
      await readFile(
        path.join(options.output, "pack-build-report.json"),
        "utf8",
      ),
    );
    expect(deferred.reports).toContainEqual({
      id: "expanded-included-content",
      state: "deferred",
    });
    expect(await readdir(options.output)).not.toContain(
      "expanded-included-content-0.1.0-data-only.tar.zst",
    );
    compatible.release_status = "active";
    compatible.app_versions = ["0.1.0", "0.2.0"];
    compatible.release_tag = "v0.1.0";
    const beforeUpdate = await buildFeaturePacks(options);
    options.appVersion = "0.2.0";
    options.release.release_base_url =
      "https://github.com/example/animama/releases/download/v0.2.0";
    const afterUpdate = await buildFeaturePacks(options);
    expect(afterUpdate.entries).toEqual(beforeUpdate.entries);
    expect(
      (
        await loadPackCatalog({
          runtimeRoot: root,
          appVersion: "0.2.0",
          isPackaged: true,
        })
      ).entries,
    ).toEqual(beforeUpdate.entries);
    await writeFile(path.join(inputs, "fixture.json"), '{"changed":true}');
    expect((await buildFeaturePacks(options)).entries).toEqual([]);
  });
  it("pins pack URLs under the selected R2 release folder and rejects unsafe bases", async () => {
    const root = await temporary();
    const inputs = path.join(root, "expanded");
    await mkdir(inputs);
    await writeFile(path.join(inputs, "fixture.json"), "{}");
    const files = await inventoryPack(inputs, "expanded-included-content");
    const packs = Object.fromEntries(
      ["parakeet-stt", "expanded-included-content", "document-processing"].map(
        (id) => [
          id,
          {
            release_status:
              id === "expanded-included-content"
                ? ("active" as const)
                : ("deferred" as const),
            version: "0.1.0",
            approved_inventory_sha256:
              id === "expanded-included-content"
                ? sha(Buffer.from(JSON.stringify(files)))
                : null,
            license_refs: ["fixture-only"],
          },
        ],
      ),
    );
    const options = {
      inputs: {
        "expanded-included-content": inputs,
        "parakeet-stt": path.join(root, "missing-speech"),
        "document-processing": path.join(root, "missing-worker"),
      },
      output: path.join(root, "archives"),
      catalog: path.join(root, "pack-catalog.json"),
      appVersion: "0.2.0",
      release: {
        release_base_url: "https://downloads.example.test/desktop/v0.2.0",
        distribution: {
          kind: "r2" as const,
          base_url: "https://downloads.example.test/desktop",
        },
        macos: { team_id: null, designated_requirement: null },
        packs,
      },
      budgets: Object.fromEntries(
        [
          "parakeet-stt",
          "expanded-included-content",
          "document-processing",
        ].map((id) => [id, { installed_bytes: 100_000, download_bytes: null }]),
      ),
      writeTar,
    } as Parameters<typeof buildFeaturePacks>[0];
    const [entry] = (await buildFeaturePacks(options)).entries;
    expect(entry.url).toBe(
      "https://downloads.example.test/desktop/v0.2.0/expanded-included-content-0.1.0-data-only.tar.zst",
    );
    // A retained pack keeps its original release folder on the same transport.
    packs["expanded-included-content"].app_versions = ["0.1.0", "0.2.0"];
    packs["expanded-included-content"].release_tag = "v0.1.0";
    expect((await buildFeaturePacks(options)).entries[0].url).toBe(
      "https://downloads.example.test/desktop/v0.1.0/expanded-included-content-0.1.0-data-only.tar.zst",
    );
    for (const base of [
      "http://downloads.example.test/desktop/v0.2.0",
      "https://downloads.example.test:8443/desktop/v0.2.0",
      "https://user@downloads.example.test/desktop/v0.2.0",
      "https://downloads.example.test/desktop/v0.2.0?x=1",
      "https://downloads.example.test/desktop/v0.2.0/",
    ]) {
      options.release.release_base_url = base;
      await expect(buildFeaturePacks(options)).rejects.toThrow(
        "Invalid fixed pack release configuration",
      );
    }
  });
});
