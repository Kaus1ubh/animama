import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import {
  SCENE_STICKERS,
  fetchSceneStickerFile,
  parseSceneStickerManifest,
  sceneStickerFamilies,
} from "./stickers";

const stickerRoot = fileURLToPath(
  new URL(
    "../../../../../../content/included/resources/scene-vfx/stickers",
    import.meta.url,
  ),
);
const manifest = JSON.parse(
  readFileSync(`${stickerRoot}/stickers.json`, "utf8"),
);
const urls = (files: string[]) =>
  new Map(files.map((file) => [file, `/assets/${file}`]));

describe("Animama sticker set", () => {
  it("lists every PNG of the Included sticker folder, each with a URL", () => {
    const pngs = readdirSync(stickerRoot)
      .filter((name) => name.endsWith(".png"))
      .sort();
    expect(SCENE_STICKERS.map((sticker) => sticker.file).sort()).toEqual(pngs);
    for (const sticker of SCENE_STICKERS) {
      expect(sticker.url).toEqual(expect.any(String));
      expect(sticker.label.trim()).not.toBe("");
      expect(sticker.family.trim()).not.toBe("");
    }
  });

  it("groups stickers by family in manifest order", () => {
    const families = sceneStickerFamilies([
      { id: "a", label: "A", family: "Gloom", file: "a.png", url: "a" },
      { id: "b", label: "B", family: "Affection", file: "b.png", url: "b" },
      { id: "c", label: "C", family: "Gloom", file: "c.png", url: "c" },
    ]);
    expect(
      families.map(({ family, stickers }) => [
        family,
        stickers.map((sticker) => sticker.id),
      ]),
    ).toEqual([
      ["Gloom", ["a", "c"]],
      ["Affection", ["b"]],
    ]);
  });

  it.each([
    ["an unknown schema", { ...manifest, schema: "animama/stickers/0" }],
    [
      "a duplicate id",
      { ...manifest, items: [manifest.items[0], manifest.items[0]] },
    ],
    [
      "a file that is not a PNG in the folder",
      {
        ...manifest,
        items: [{ ...manifest.items[0], file: "../secret.png" }],
      },
    ],
    [
      "an item without a family",
      { ...manifest, items: [{ ...manifest.items[0], family: "" }] },
    ],
  ])("refuses a manifest with %s", (_, value) => {
    expect(() =>
      parseSceneStickerManifest(
        value,
        urls(manifest.items.map((item: { file: string }) => item.file)),
      ),
    ).toThrow(/sticker/i);
  });

  it("fetches a sticker as the effect's own PNG image", async () => {
    const [sticker] = SCENE_STICKERS;
    const fetchImpl = vi.fn(
      async () =>
        new Response(new Blob([new Uint8Array([137, 80, 78, 71])]), {
          status: 200,
          headers: { "Content-Type": "image/png" },
        }),
    );
    const file = await fetchSceneStickerFile(sticker, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith(sticker.url);
    expect(file.name).toBe(`${sticker.id}.png`);
    expect(file.type).toBe("image/png");
    expect(file.size).toBe(4);
  });

  it("names the sticker when it cannot be fetched", async () => {
    const [sticker] = SCENE_STICKERS;
    await expect(
      fetchSceneStickerFile(
        sticker,
        async () => new Response(null, { status: 404 }),
      ),
    ).rejects.toThrow(sticker.label);
  });
});
