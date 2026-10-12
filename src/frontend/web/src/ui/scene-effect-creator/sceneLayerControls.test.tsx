// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SceneEffectEditorMarqueeItem } from "@/lib/scene-vfx/editor";
import { SCENE_STICKERS, sceneStickerFamilies } from "@/lib/scene-vfx/stickers";

import {
  SceneItemsEditor,
  type SceneImageControls,
} from "./sceneLayerControls";

// A small stand-in set keeps these tests independent of the shipped stickers,
// which `stickers.test.ts` checks against the Included folder.
vi.mock("@/lib/scene-vfx/stickers", () => {
  const sticker = (id: string, label: string, family: string) => ({
    id,
    label,
    family,
    file: `${id}.png`,
    url: `/assets/${id}.png`,
  });
  const stickers = [
    sticker("heart", "Heart", "Affection"),
    sticker("petal", "Petal", "Affection"),
    sticker("drop", "Drop", "Gloom"),
  ];
  return {
    SCENE_STICKERS: stickers,
    sceneStickerFamilies: () => [
      { family: "Affection", stickers: stickers.slice(0, 2) },
      { family: "Gloom", stickers: stickers.slice(2) },
    ],
  };
});

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function render(
  items: SceneEffectEditorMarqueeItem[],
  overrides: Partial<SceneImageControls> = {},
  maxItems = 8,
) {
  const images: SceneImageControls = {
    imageBusy: false,
    imageError: null,
    imageUrls: new Map(),
    filesInvalid: false,
    onChooseImage: vi.fn(),
    onChooseSticker: vi.fn(),
    ...overrides,
  };
  const onItemsChange = vi.fn();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <SceneItemsEditor
        items={items}
        maxItems={maxItems}
        images={images}
        onItemsChange={onItemsChange}
      />,
    ),
  );
  return { images, onItemsChange, element: container };
}

const legacy: SceneEffectEditorMarqueeItem = {
  id: "old",
  kind: "emoji",
  label: "Sparkles",
  emoji: "✨",
};

describe("Scene item editor", () => {
  it("offers the Animama sticker set by family, with thumbnails, and no Twemoji", () => {
    const { element } = render([]);
    const text = element.textContent ?? "";
    for (const { family } of sceneStickerFamilies())
      expect(text).toContain(family);
    for (const sticker of SCENE_STICKERS) {
      const button = element.querySelector(
        `button[aria-label="Add ${sticker.label} sticker"]`,
      );
      expect(button?.querySelector("img")?.getAttribute("src")).toBe(
        sticker.url,
      );
    }
    expect(text).not.toMatch(/twemoji|add emoji/i);
    expect(text).toContain("Add private image");
  });

  it("adds a chosen sticker through the image path", () => {
    const { element, images } = render([]);
    const [sticker] = SCENE_STICKERS;
    act(() =>
      (
        element.querySelector(
          `button[aria-label="Add ${sticker.label} sticker"]`,
        ) as HTMLButtonElement
      ).click(),
    );
    expect(images.onChooseSticker).toHaveBeenCalledWith(sticker);
  });

  it("disables the stickers when the layer is full", () => {
    const { element } = render([legacy], {}, 1);
    const buttons = [
      ...element.querySelectorAll<HTMLButtonElement>(
        'button[aria-label$=" sticker"]',
      ),
    ];
    expect(buttons.length).toBe(SCENE_STICKERS.length);
    expect(buttons.every((button) => button.disabled)).toBe(true);
  });

  it("marks a legacy emoji item missing and asks to replace or remove it", () => {
    const { element, onItemsChange } = render([legacy]);
    const text = element.textContent ?? "";
    expect(text).toContain("Missing");
    expect(text).toContain(
      "Animama no longer provides emoji items. Replace each with a sticker or image, or remove it, before saving.",
    );
    act(() =>
      (
        element.querySelector(
          'button[aria-label="Remove Sparkles"]',
        ) as HTMLButtonElement
      ).click(),
    );
    expect(onItemsChange).toHaveBeenCalledWith([]);
  });
});
