import { afterEach, describe, expect, it, vi } from "vitest";

import type { SceneSticker } from "@/lib/scene-vfx/stickers";

import {
  addSceneEffectImageFile,
  addSceneEffectSticker,
  createSceneEffectHistorySnapshot,
  createSceneEffectObjectUrlLease,
  type SceneEffectHistorySnapshot,
  sceneEffectCreatorKeyboardAction,
  SCENE_EFFECT_PREVIEW_MOTION_CLASS,
} from "./sceneEffectCreatorBehavior";

describe("Scene Effect creator behavior", () => {
  it("maps save and preview shortcuts without stealing input space", () => {
    expect(
      sceneEffectCreatorKeyboardAction({
        key: "s",
        code: "KeyS",
        metaKey: true,
        ctrlKey: false,
        editing: true,
      }),
    ).toBe("save");
    expect(
      sceneEffectCreatorKeyboardAction({
        key: " ",
        code: "Space",
        metaKey: false,
        ctrlKey: false,
        editing: true,
      }),
    ).toBeNull();
    expect(
      sceneEffectCreatorKeyboardAction({
        key: " ",
        code: "Space",
        metaKey: false,
        ctrlKey: false,
        editing: false,
      }),
    ).toBe("toggle-preview");
  });

  it("releases every private-image preview URL exactly once", () => {
    const createObjectURL = vi
      .fn()
      .mockReturnValueOnce("blob:first")
      .mockReturnValueOnce("blob:second");
    const revokeObjectURL = vi.fn();
    const lease = createSceneEffectObjectUrlLease(
      [
        {
          logicalName: "first.webp",
          file: {} as File,
          sha256: "a".repeat(64),
        },
        {
          logicalName: "second.webp",
          file: {} as File,
          sha256: "b".repeat(64),
        },
      ],
      { createObjectURL, revokeObjectURL },
    );

    lease.dispose();
    lease.dispose();

    expect([...lease.urls]).toEqual([
      ["first.webp", "blob:first"],
      ["second.webp", "blob:second"],
    ]);
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(revokeObjectURL).toHaveBeenNthCalledWith(1, "blob:first");
    expect(revokeObjectURL).toHaveBeenNthCalledWith(2, "blob:second");
  });

  it("declares reduced-motion-safe preview animation", () => {
    expect(SCENE_EFFECT_PREVIEW_MOTION_CLASS).toContain(
      "motion-reduce:animate-none",
    );
  });
});

/** PNG bytes (signature and IHDR) whose dimensions make each set distinct. */
function pngBytes(width: number, height = width): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

const pngFile = (name: string, width: number) =>
  new File([pngBytes(width)], name, { type: "image/png" });

/** The real digest the content-hash worker computes, without a Worker. */
async function hash(file: File): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const heart: SceneSticker = {
  id: "heart",
  label: "Heart",
  family: "Affection",
  file: "heart.png",
  url: "/assets/heart-1234.png",
};

const fetchSticker = vi.fn(
  async () => new Response(pngBytes(48), { status: 200 }),
);

describe("adding images to a Scene Effect", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchSticker.mockClear();
  });

  const at = (snapshot: SceneEffectHistorySnapshot) => () => snapshot;

  it("adds a chosen sticker as its own labelled image whose bytes it carries", async () => {
    vi.stubGlobal("fetch", fetchSticker);
    const next = await addSceneEffectSticker(
      at(createSceneEffectHistorySnapshot()),
      heart,
      { kind: "marquee" },
      { hash },
    );

    expect(fetchSticker).toHaveBeenCalledWith(heart.url);
    const items = next.document.background.marquee.items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "image",
      label: "Heart",
      image: { logicalName: "heart.png", contentType: "image/png" },
    });
    // Save, recovery and Portable packages read the bytes from here.
    expect(next.imageResources).toEqual([
      {
        logicalName: "heart.png",
        file: expect.any(File),
        sha256: await hash(pngFile("heart.png", 48)),
      },
    ]);
    expect(items[0].kind === "image" && items[0].image.sha256).toBe(
      next.imageResources[0].sha256,
    );
  });

  it("reuses the carried bytes when the same sticker is chosen again", async () => {
    vi.stubGlobal("fetch", fetchSticker);
    const once = await addSceneEffectSticker(
      at(createSceneEffectHistorySnapshot()),
      heart,
      { kind: "marquee" },
      { hash },
    );
    const twice = await addSceneEffectSticker(
      at(once),
      heart,
      { kind: "marquee" },
      { hash },
    );

    const items = twice.document.background.marquee.items;
    expect(items.map((item) => item.kind === "image" && item.label)).toEqual([
      "Heart",
      "Heart",
    ]);
    expect(
      items.map((item) => item.kind === "image" && item.image.logicalName),
    ).toEqual(["heart.png", "heart.png"]);
    expect(twice.imageResources).toEqual(once.imageResources);
  });

  it("reuses the carried bytes for an identical private image", async () => {
    const once = await addSceneEffectImageFile(
      at(createSceneEffectHistorySnapshot()),
      pngFile("Photo.png", 32),
      { kind: "marquee" },
      { hash },
    );
    const twice = await addSceneEffectImageFile(
      at(once),
      pngFile("Copy of photo.png", 32),
      { kind: "marquee" },
      { hash },
    );

    expect(
      twice.document.background.marquee.items.map(
        (item) => item.kind === "image" && [item.label, item.image.logicalName],
      ),
    ).toEqual([
      ["Photo", "Photo.png"],
      ["Copy of photo", "Photo.png"],
    ]);
    expect(twice.imageResources).toEqual(once.imageResources);
  });

  it("drops a replaced tile's bytes when the tile reuses carried bytes", async () => {
    vi.stubGlobal("fetch", fetchSticker);
    const withTile = await addSceneEffectImageFile(
      at(createSceneEffectHistorySnapshot()),
      pngFile("old-tile.png", 16),
      { kind: "tile" },
      { hash },
    );
    const withSticker = await addSceneEffectSticker(
      at(withTile),
      heart,
      { kind: "marquee" },
      { hash },
    );
    expect(
      withSticker.imageResources.map((resource) => resource.logicalName),
    ).toEqual(["old-tile.png", "heart.png"]);

    const retiled = await addSceneEffectImageFile(
      at(withSticker),
      pngFile("heart again.png", 48),
      { kind: "tile" },
      { hash },
    );

    expect(retiled.document.background.tile.image?.logicalName).toBe(
      "heart.png",
    );
    expect(
      retiled.imageResources.map((resource) => resource.logicalName),
    ).toEqual(["heart.png"]);
  });

  it("refuses a sticker that cannot be loaded or a file that is not an image", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    const start = at(createSceneEffectHistorySnapshot());

    await expect(
      addSceneEffectSticker(start, heart, { kind: "marquee" }, { hash }),
    ).rejects.toThrow("The Heart sticker could not be loaded.");
    await expect(
      addSceneEffectImageFile(
        start,
        new File(["hello"], "notes.txt", { type: "text/plain" }),
        { kind: "marquee" },
        { hash },
      ),
    ).rejects.toThrow("Choose a PNG, JPEG, WebP, or static SVG image.");
  });
});
