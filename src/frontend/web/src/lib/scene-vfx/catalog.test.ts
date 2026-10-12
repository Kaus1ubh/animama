import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import rawCatalog from "@/assets/effects/scene-vfx/catalog.json";

import {
  getSceneBackgroundLayerPresetById,
  getSceneBackgroundLayerPresetIds,
  parseSceneVFXEntry,
} from "./catalog";

const includedRoot = fileURLToPath(
  new URL("../../../../../../content/included", import.meta.url),
);

const BACKGROUND_EMOTIONS = [
  "admiration",
  "love",
  "respect",
  "confidence",
  "gratitude",
  "amusement",
  "excitement",
  "joy",
  "curiosity",
  "optimism",
  "fear",
  "nervousness",
  "anger",
  "disapproval",
  "disgust",
  "embarrassment",
  "disappointment",
  "grief",
  "sadness",
] as const;

describe("scene VFX catalog", () => {
  it("exposes the retained emotion background presets", () => {
    const presetIds = getSceneBackgroundLayerPresetIds();

    for (const emotion of BACKGROUND_EMOTIONS) {
      const presetId = `scene-vfx-emotion-${emotion}`;
      const preset = getSceneBackgroundLayerPresetById(presetId);

      expect(presetIds).toContain(presetId);
      expect(preset).not.toBeNull();
      expect(preset?.id).toBe(presetId);
      expect(preset?.kind).toBe("background_layers");
    }
  });

  it("ships presets without line items, so each marquee starts empty", () => {
    // The bundled catalog has no line items: its presets name none, and the
    // creator adds stickers or private images to a preset's marquee.
    expect(rawCatalog).not.toHaveProperty("backgroundLineItems");
    for (const preset of rawCatalog.backgroundLayerPresets) {
      expect(preset.entry.marquee).not.toHaveProperty("itemIds");
      expect(
        getSceneBackgroundLayerPresetById(preset.presetId)?.marquee.items,
      ).toEqual([]);
    }
  });

  it("skips a legacy emoji item in a runtime entry and refuses unknown kinds", () => {
    const preset = getSceneBackgroundLayerPresetById("scene-vfx-emotion-joy")!;
    const png = { id: "star", kind: "png", label: "Star", src: "blob:star" };
    const legacy = { id: "old", kind: "emoji", label: "Old", emoji: "\u2728" };
    const entry = parseSceneVFXEntry({
      ...preset,
      marquee: { ...preset.marquee, items: [legacy, png] },
    });
    expect(entry.kind === "background_layers" && entry.marquee.items).toEqual([
      png,
    ]);
    expect(() =>
      parseSceneVFXEntry({
        ...preset,
        marquee: { ...preset.marquee, items: [{ ...png, kind: "gif" }] },
      }),
    ).toThrow();
  });

  it("does not export retired scene presets", () => {
    const retiredIds = [
      "chaos-chibi",
      ...["annoyance", "caring", "confusion", "desire", "remorse"].map(
        (emotion) => `scene-vfx-emotion-${emotion}`,
      ),
    ];
    for (const presetId of retiredIds) {
      expect(getSceneBackgroundLayerPresetById(presetId)).toBeNull();
      expect(getSceneBackgroundLayerPresetIds()).not.toContain(presetId);
    }
  });

  it("ships no Twemoji mirror", () => {
    expect(existsSync(`${includedRoot}/resources/scene-vfx/twemoji`)).toBe(
      false,
    );
  });
});
