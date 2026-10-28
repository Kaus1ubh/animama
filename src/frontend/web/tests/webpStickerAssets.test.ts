import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";
import { build } from "vite";
import { afterEach, describe, expect, it } from "vitest";

import { webpStickerAssetsPlugin } from "../vite-plugins/webp-sticker-assets";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

/** Smooth translucent art that WebP stores smaller than PNG. */
async function smoothPng(): Promise<Buffer> {
  const size = 64;
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1)
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const value = Math.round(127 + 127 * Math.sin(x / 5) * Math.cos(y / 7));
      pixels.set(
        [value, 255 - value, (x * 4) % 256, 128 + ((x + y) % 128)],
        offset,
      );
    }
  return sharp(pixels, { raw: { width: size, height: size, channels: 4 } })
    .png()
    .toBuffer();
}

/** A blank transparent palette PNG, smaller than any WebP of it. */
function blankPng(): Promise<Buffer> {
  return sharp({
    create: {
      width: 256,
      height: 256,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .png({ palette: true, compressionLevel: 9 })
    .toBuffer();
}

async function stickerRoot(files: Record<string, Buffer>): Promise<string> {
  const root = mkdtempSync(path.join(tmpdir(), "animama-stickers-"));
  roots.push(root);
  for (const [name, bytes] of Object.entries(files))
    writeFileSync(path.join(root, name), bytes);
  return root;
}

type Emitted = { type: string; name?: string; source?: Uint8Array | string };

async function load(root: string, id: string) {
  const plugin = webpStickerAssetsPlugin({ stickerRoot: root });
  const emitted: Emitted[] = [];
  const context = {
    environment: { config: { root } },
    emitFile(file: Emitted) {
      emitted.push(file);
      return `ref${emitted.length}`;
    },
  };
  const hook = plugin.load as (this: unknown, id: string) => Promise<unknown>;
  return { code: await hook.call(context, id), emitted };
}

describe("WebP sticker assets", () => {
  it("only builds the app with converted stickers", () => {
    expect(webpStickerAssetsPlugin({ stickerRoot: "/x" }).apply).toBe("build");
  });

  it("emits a sticker URL import as a WebP asset", async () => {
    const root = await stickerRoot({ "leaf.png": await smoothPng() });

    const { code, emitted } = await load(root, `${root}/leaf.png?url`);

    expect(code).toEqual({
      code: 'export default "__VITE_ASSET__ref1__";',
      moduleType: "js",
    });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.name).toBe("leaf.webp");
    const metadata = await sharp(
      Buffer.from(emitted[0]!.source as Uint8Array),
    ).metadata();
    expect(metadata.format).toBe("webp");
    expect(metadata.hasAlpha).toBe(true);
  });

  it("keeps the PNG when WebP is not smaller", async () => {
    const blank = await blankPng();
    const root = await stickerRoot({ "dot.png": blank });

    const { emitted } = await load(root, `${root}/dot.png?url`);

    expect(emitted[0]?.name).toBe("dot.png");
    expect(Buffer.from(emitted[0]!.source as Uint8Array)).toEqual(blank);
  });

  it("leaves other imports to Vite", async () => {
    const root = await stickerRoot({ "leaf.png": await smoothPng() });
    const other = await stickerRoot({ "leaf.png": await smoothPng() });

    for (const id of [
      `${root}/leaf.png`,
      `${root}/leaf.png?raw`,
      `${other}/leaf.png?url`,
      `${root}/stickers.json?url`,
    ])
      expect((await load(root, id)).code).toBeNull();
  });

  it("ships WebP stickers in a real build when the configured root is a symlink", async () => {
    const real = realpathSync(
      await stickerRoot({ "leaf.png": await smoothPng() }),
    );
    const linked = `${real}-link`;
    // A junction needs no privileges on Windows; POSIX ignores the type.
    symlinkSync(real, linked, "junction");
    roots.push(linked);
    writeFileSync(
      path.join(real, "main.ts"),
      `const urls = import.meta.glob("./*.png", { eager: true, query: "?url", import: "default" }); console.log(urls);`,
    );
    writeFileSync(
      path.join(real, "index.html"),
      '<script type="module" src="/main.ts"></script>',
    );

    const result = await build({
      configFile: false,
      root: real,
      base: "/base/",
      logLevel: "silent",
      plugins: [webpStickerAssetsPlugin({ stickerRoot: linked })],
      build: { write: false, minify: false },
    });

    if (Array.isArray(result) || !("output" in result))
      throw new Error("expected one build output");
    const files = result.output.map((output) => output.fileName);
    const sticker = files.find((name) => /^assets\/leaf-.+\.webp$/.test(name));
    expect(sticker).toBeDefined();
    expect(files.some((name) => name.endsWith(".png"))).toBe(false);
    const code = result.output
      .filter((output) => output.type === "chunk")
      .map((chunk) => chunk.code)
      .join("\n");
    expect(code).toContain(`/base/${sticker}`);
    expect(code).not.toContain("__VITE_ASSET__");
  });

  it("names stickers outside the Vite root relative to it in the build manifest", async () => {
    const checkout = realpathSync(
      await stickerRoot({ "leaf.png": await smoothPng() }),
    );
    const web = path.join(checkout, "web");
    mkdirSync(web);
    writeFileSync(
      path.join(web, "main.ts"),
      `const urls = import.meta.glob("../*.png", { eager: true, query: "?url", import: "default" }); console.log(urls);`,
    );
    writeFileSync(
      path.join(web, "index.html"),
      '<script type="module" src="/main.ts"></script>',
    );

    const result = await build({
      configFile: false,
      root: web,
      logLevel: "silent",
      plugins: [webpStickerAssetsPlugin({ stickerRoot: checkout })],
      build: { write: false, minify: false, manifest: true },
    });

    if (Array.isArray(result) || !("output" in result))
      throw new Error("expected one build output");
    const asset = result.output.find(
      (output) => output.fileName === ".vite/manifest.json",
    );
    if (asset?.type !== "asset") throw new Error("expected a build manifest");
    const manifest = String(asset.source);
    // Shipped manifests must not carry the build machine's checkout path.
    expect(manifest).not.toContain(checkout);
    const sticker = JSON.parse(manifest)["../leaf.png"];
    expect(sticker).toMatchObject({ src: "../leaf.png" });
    expect(sticker.file).toMatch(/^assets\/leaf-.+\.webp$/);
  });
});
