import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  SCENE_BACKGROUND_LINE_ITEMS,
  SCENE_BACKGROUND_SVG_LINE_ITEMS,
  resolveSceneBackgroundLineItem,
} from "./assets";
import {
  getSceneBackgroundEmojiLineItems,
  getSceneBackgroundLayerPresetById,
  getSceneBackgroundLayerPresetIds,
  getSceneBackgroundLineItemById,
  getSceneBackgroundPngLineItems,
  getSceneBackgroundSvgLineItems,
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

const FETCHED_TWEMOJI_CODEPOINTS = [
  "1f929",
  "1f917",
  "1f3c5",
  "1f451",
  "1f64f",
  "1f602",
  "1f389",
  "1f3af",
  "1f914",
  "1f305",
  "26a0",
  "1f4a6",
  "1f4ab",
  "1f4a2",
  "1f44e",
  "1f922",
  "1f633",
  "1f97a",
  "1f61e",
  "1f622",
  "1f327",
  "2753",
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
      expect(preset?.marquee.items.length).toBeGreaterThan(0);
    }
  });

  it("keeps emoji line items resolvable without bundled custom artwork", () => {
    const emojiItems = getSceneBackgroundEmojiLineItems();
    const sparkles = getSceneBackgroundLineItemById("emoji-sparkles");

    expect(getSceneBackgroundPngLineItems()).toEqual([]);
    expect(getSceneBackgroundSvgLineItems()).toEqual([]);
    expect(emojiItems.some((item) => item.id === "emoji-sparkles")).toBe(true);
    expect(resolveSceneBackgroundLineItem(sparkles!)).toEqual({
      id: "emoji-sparkles",
      kind: "emoji",
      emoji: "\u2728",
      label: "Sparkles \u2728",
      provider: "twemoji",
      src: "/effects/resources/scene-vfx/twemoji/2728.svg",
    });
  });

  it("still resolves user-supplied PNG and SVG line items directly", () => {
    for (const kind of ["png", "svg"] as const) {
      const item = {
        id: `preview-${kind}`,
        kind,
        src: `/effects/scene-vfx/${kind}/preview.${kind}`,
        label: `Preview ${kind}`,
      };
      expect(resolveSceneBackgroundLineItem(item)).toEqual(item);
    }
  });

  it("does not export retired custom artwork or scene presets", () => {
    expect(SCENE_BACKGROUND_SVG_LINE_ITEMS).toEqual([]);
    expect(
      SCENE_BACKGROUND_LINE_ITEMS.every((item) => item.kind === "emoji"),
    ).toBe(true);
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

  it("has mirrored Twemoji assets for fetched emotion emoji", () => {
    for (const codepoint of FETCHED_TWEMOJI_CODEPOINTS) {
      expect(
        existsSync(
          `${includedRoot}/resources/scene-vfx/twemoji/${codepoint}.svg`,
        ),
      ).toBe(true);
    }
  });
});
