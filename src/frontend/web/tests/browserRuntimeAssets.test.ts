import { createHash } from "node:crypto";
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  copyBrowserRuntimeAssets,
  resolveBrowserRuntimeAssets,
  verifyOptionalBrowserCatalogs,
} from "../../scripts/browser-runtime-assets.mjs";
import { installBrowserRuntimeAssets } from "../vite-plugins/browser-runtime-assets";

const roots: string[] = [];
const servers: Server[] = [];
const repo = fileURLToPath(new URL("../../../..", import.meta.url));
function fixture(text = "0123456789") {
  const root = mkdtempSync(path.join(tmpdir(), "animama-browser-assets-"));
  roots.push(root);
  const manifest = JSON.parse(
    readFileSync(
      path.join(repo, "models/browser-runtime/manifest.json"),
      "utf8",
    ),
  );
  const modelDirectory = path.join(root, "store");
  const packagesRoot = path.join(root, "packages");
  const manifestPath = path.join(root, "models/browser-runtime/manifest.json");
  const modelEntries: object[] = [];
  for (const entry of manifest.files) {
    entry.size = Buffer.byteLength(text);
    entry.sha256 = createHash("sha256").update(text).digest("hex");
    const source = entry.source;
    const directory =
      source.kind === "model-store"
        ? modelDirectory
        : path.join(packagesRoot, source.package);
    mkdirSync(path.dirname(path.join(directory, source.path)), {
      recursive: true,
    });
    writeFileSync(path.join(directory, source.path), text);
    if (source.kind === "package")
      writeFileSync(
        path.join(directory, "package.json"),
        JSON.stringify({ name: source.name, version: source.version }),
      );
    else
      modelEntries.push({
        path: source.path,
        target: entry.path,
        size: entry.size,
        sha256: entry.sha256,
      });
  }
  mkdirSync(path.dirname(manifestPath), { recursive: true });
  mkdirSync(path.join(root, "models/browser-speech"), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(manifest));
  writeFileSync(
    path.join(root, "models/browser-speech/manifest.json"),
    JSON.stringify({ files: modelEntries }),
  );
  return { root, manifestPath, modelDirectory, packagesRoot, manifest };
}
async function listen(
  assets: ReturnType<typeof resolveBrowserRuntimeAssets>,
  publicRoot?: string,
) {
  let handler: (
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ) => void;
  installBrowserRuntimeAssets(
    {
      middlewares: {
        use(value) {
          handler = value;
        },
      },
    },
    assets,
    publicRoot,
  );
  const server = createServer((req, res) =>
    handler(req, res, () => {
      res.statusCode = 418;
      res.end();
    }),
  );
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP");
  return `http://127.0.0.1:${address.port}`;
}
afterEach(async () => {
  for (const server of servers.splice(0)) {
    if (!server.listening) continue;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("verified browser runtime inputs", () => {
  it("preserves all 23 reviewed target paths and independent distribution copies", () => {
    const value = fixture();
    const assets = resolveBrowserRuntimeAssets(value);
    expect(assets).toHaveLength(23);
    const builtRoot = path.join(value.root, "dist");
    copyBrowserRuntimeAssets(assets, builtRoot);
    rmSync(value.modelDirectory, { recursive: true });
    rmSync(value.packagesRoot, { recursive: true });
    expect(
      resolveBrowserRuntimeAssets({
        manifestPath: value.manifestPath,
        builtRoot,
      }),
    ).toHaveLength(23);
  });
  it("rejects extra built bytes and unsafe output links", () => {
    const value = fixture();
    const assets = resolveBrowserRuntimeAssets(value);
    const builtRoot = path.join(value.root, "dist");
    copyBrowserRuntimeAssets(assets, builtRoot);
    writeFileSync(path.join(builtRoot, "onnx/extra.wasm"), "unexpected");
    expect(() =>
      resolveBrowserRuntimeAssets({
        manifestPath: value.manifestPath,
        builtRoot,
      }),
    ).toThrow("unlisted files");
    const outside = path.join(value.root, "outside");
    mkdirSync(outside);
    const linked = path.join(value.root, "linked-output");
    mkdirSync(linked);
    symlinkSync(outside, path.join(linked, "onnx"), "junction");
    expect(() => copyBrowserRuntimeAssets(assets, linked)).toThrow(
      "Unsafe browser runtime build directory",
    );
  });
  it("preserves separate optional catalogs in development and built output", async () => {
    const value = fixture();
    const publicRoot = path.join(value.root, "public");
    const relative = "onnx/models/pocket-tts/animas/test-anima_voices.bin";
    mkdirSync(path.dirname(path.join(publicRoot, relative)), {
      recursive: true,
    });
    writeFileSync(path.join(publicRoot, relative), "user-catalog");
    verifyOptionalBrowserCatalogs(publicRoot);
    const assets = resolveBrowserRuntimeAssets(value);
    const development = await listen(assets, publicRoot);
    expect(await (await fetch(`${development}/${relative}`)).text()).toBe(
      "user-catalog",
    );
    expect(
      (
        await fetch(
          `${development}/onnx/models/pocket-tts/animas/missing_voices.bin`,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await fetch(
          `${development}/onnx/models/pocket-tts/animas/test-anima.txt`,
        )
      ).status,
    ).toBe(404);
    const builtRoot = path.join(value.root, "dist");
    cpSync(publicRoot, builtRoot, { recursive: true });
    copyBrowserRuntimeAssets(assets, builtRoot);
    const builtAssets = resolveBrowserRuntimeAssets({
      manifestPath: value.manifestPath,
      builtRoot,
    });
    expect(builtAssets).toHaveLength(23);
    const preview = await listen(builtAssets, builtRoot);
    expect(await (await fetch(`${preview}/${relative}`)).text()).toBe(
      "user-catalog",
    );
    const replacement = path.join(value.root, "outside.bin");
    writeFileSync(replacement, "outside");
    rmSync(path.join(publicRoot, relative));
    symlinkSync(replacement, path.join(publicRoot, relative));
    expect((await fetch(`${development}/${relative}`)).status).toBe(404);
    expect(() => verifyOptionalBrowserCatalogs(publicRoot)).toThrow(
      "Linked browser runtime asset path",
    );
  });
  it("rejects unlisted names and links among optional built catalogs", () => {
    const value = fixture();
    const builtRoot = path.join(value.root, "dist");
    copyBrowserRuntimeAssets(resolveBrowserRuntimeAssets(value), builtRoot);
    const directory = path.join(builtRoot, "onnx/models/pocket-tts/animas");
    mkdirSync(directory);
    const bad = path.join(directory, "unexpected.bin");
    writeFileSync(bad, "user-catalog");
    expect(() =>
      resolveBrowserRuntimeAssets({
        manifestPath: value.manifestPath,
        builtRoot,
      }),
    ).toThrow("unlisted files");
    rmSync(bad);
    symlinkSync(
      path.join(builtRoot, "onnx/models/pocket-tts/bundle.json"),
      path.join(directory, "test-anima_voices.bin"),
    );
    expect(() =>
      resolveBrowserRuntimeAssets({
        manifestPath: value.manifestPath,
        builtRoot,
      }),
    ).toThrow("Unsafe built browser runtime member");
  });
  it.each(["missing", "corrupt", "extra"])(
    "rejects %s model cache bytes",
    (kind) => {
      const value = fixture();
      const file = path.join(
        value.modelDirectory,
        value.manifest.files[0].source.path,
      );
      if (kind === "missing") rmSync(file);
      if (kind === "corrupt") writeFileSync(file, "abcdefghij");
      if (kind === "extra")
        writeFileSync(
          path.join(value.modelDirectory, "unlisted.onnx"),
          "extra",
        );
      expect(() => resolveBrowserRuntimeAssets(value)).toThrow();
    },
  );
  it("rejects an installed package version mismatch even if its bytes match", () => {
    const value = fixture();
    const pkg = path.join(
      value.packagesRoot,
      "onnxruntime-web-assets/package.json",
    );
    writeFileSync(
      pkg,
      JSON.stringify({ name: "onnxruntime-web", version: "1.24.3" }),
    );
    expect(() => resolveBrowserRuntimeAssets(value)).toThrow(
      "Wrong browser runtime dependency version",
    );
  });
  it("rejects a dependency payload changed after installation", () => {
    const value = fixture();
    writeFileSync(
      path.join(value.packagesRoot, "onnxruntime-web-assets/dist/ort.min.mjs"),
      "abcdefghij",
    );
    expect(() => resolveBrowserRuntimeAssets(value)).toThrow(
      "integrity mismatch",
    );
  });
  it("permits package-manager directory links while rejecting payload symlinks", () => {
    const value = fixture();
    const packagePath = path.join(value.packagesRoot, "onnxruntime-web-assets");
    const physical = path.join(value.root, "physical-package");
    cpSync(packagePath, physical, { recursive: true });
    rmSync(packagePath, { recursive: true });
    symlinkSync(physical, packagePath, "junction");
    expect(resolveBrowserRuntimeAssets(value)).toHaveLength(23);
    const payload = path.join(physical, "dist/ort.min.mjs");
    rmSync(payload);
    symlinkSync(
      path.join(physical, "dist/ort-wasm-simd-threaded.mjs"),
      payload,
    );
    expect(() => resolveBrowserRuntimeAssets(value)).toThrow(
      "Linked browser runtime asset path",
    );
  });
  it("rejects a runtime inventory that disagrees with acquisition metadata", () => {
    const value = fixture();
    value.manifest.files[0].sha256 = "0".repeat(64);
    writeFileSync(value.manifestPath, JSON.stringify(value.manifest));
    expect(() => resolveBrowserRuntimeAssets(value)).toThrow(
      "inventories differ",
    );
  });
  it("keeps different source inventories isolated while both origins run", async () => {
    const first = fixture("firstbytes");
    const second = fixture("otherbytes");
    const [a, b] = await Promise.all([
      listen(resolveBrowserRuntimeAssets(first)),
      listen(resolveBrowserRuntimeAssets(second)),
    ]);
    const route = "/onnx/models/pocket-tts/voices/cosette.safetensors";
    expect(await (await fetch(a + route)).text()).toBe("firstbytes");
    expect(await (await fetch(b + route)).text()).toBe("otherbytes");
    expect(await (await fetch(a + route)).text()).toBe("firstbytes");
  });
  it("serves exact same-origin module/WASM types, HEAD, ranges, and closed unknown paths", async () => {
    const base = await listen(resolveBrowserRuntimeAssets(fixture()));
    const wasm = "/onnx/ort/1.24.2/ort-wasm-simd-threaded.wasm";
    const response = await fetch(base + wasm, {
      headers: { Range: "bytes=2-4" },
    });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-type")).toBe("application/wasm");
    expect(await response.text()).toBe("234");
    expect(
      (await fetch(base + wasm, { method: "HEAD" })).headers.get(
        "content-length",
      ),
    ).toBe("10");
    expect(
      (await fetch(base + "/onnx/ort/1.24.2/ort.min.mjs?import")).headers.get(
        "content-type",
      ),
    ).toBe("text/javascript; charset=utf-8");
    expect((await fetch(base + "/onnx/missing")).status).toBe(404);
    expect((await fetch(base + "/onnx/..%2fsecret")).status).toBe(404);
    expect((await fetch(base + "/unrelated")).status).toBe(418);
    expect(
      (await fetch(base + "/onnx/models/parakeet-tdt-0.6b-v2/config.json"))
        .status,
    ).toBe(418);
  });
});
