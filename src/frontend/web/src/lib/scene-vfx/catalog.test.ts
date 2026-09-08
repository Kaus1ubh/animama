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

const EMOTIONS = [
  "admiration",
  "caring",
  "love",
  "respect",
  "confidence",
  "gratitude",
  "amusement",
  "excitement",
  "joy",
  "desire",
  "curiosity",
  "optimism",
  "fear",
  "nervousness",
  "confusion",
  "anger",
  "annoyance",
  "disapproval",
  "disgust",
  "embarrassment",
  "remorse",
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
  it("exposes all canonical emotion background presets", () => {
    const presetIds = getSceneBackgroundLayerPresetIds();

    for (const emotion of EMOTIONS) {
      const presetId = `scene-vfx-emotion-${emotion}`;
      const preset = getSceneBackgroundLayerPresetById(presetId);

      expect(presetIds).toContain(presetId);
      expect(preset).not.toBeNull();
      expect(preset?.id).toBe(presetId);
      expect(preset?.kind).toBe("background_layers");
      expect(preset?.marquee.items.length).toBeGreaterThan(0);
    }
  });

  it("keeps existing PNG and emoji line items resolvable", () => {
    const pngItems = getSceneBackgroundPngLineItems();
    const emojiItems = getSceneBackgroundEmojiLineItems();
    const chibi = getSceneBackgroundLineItemById("chibi-1");
    const sparkles = getSceneBackgroundLineItemById("emoji-sparkles");

    expect(pngItems.some((item) => item.id === "chibi-1")).toBe(true);
    expect(emojiItems.some((item) => item.id === "emoji-sparkles")).toBe(true);
    expect(chibi).toEqual({
      id: "chibi-1",
      kind: "png",
      src: "/effects/scene-vfx/chaos-chibi/chibi-1.png",
      label: "Chibi 1",
    });
    expect(resolveSceneBackgroundLineItem(sparkles!)).toEqual({
      id: "emoji-sparkles",
      kind: "emoji",
      emoji: "\u2728",
      label: "Sparkles \u2728",
      provider: "twemoji",
      src: "/effects/resources/scene-vfx/twemoji/2728.svg",
    });
  });

  it("validates custom SVG line items as safe public scene-vfx paths", () => {
    const svgItems = getSceneBackgroundSvgLineItems();

    expect(svgItems.length).toBeGreaterThan(0);
    for (const item of svgItems) {
      expect(item.kind).toBe("svg");
      expect(item.src).toMatch(/^\/effects\/scene-vfx\/svg\/[^?#]+\.svg$/);
      expect(item.src).not.toContain("..");
    }
  });

  it("resolves SVG line items directly to their public src", () => {
    const item = getSceneBackgroundLineItemById("svg-target-heart");

    expect(item).not.toBeNull();
    expect(resolveSceneBackgroundLineItem(item!)).toEqual({
      id: "svg-target-heart",
      kind: "svg",
      src: "/effects/scene-vfx/svg/target-heart.svg",
      label: "Target Heart",
    });
  });

  it("includes SVG line items in debug-facing exports", () => {
    expect(SCENE_BACKGROUND_SVG_LINE_ITEMS).toContainEqual({
      id: "svg-gentle-hands",
      kind: "svg",
      src: "/effects/scene-vfx/svg/gentle-hands.svg",
      label: "Gentle Hands",
    });
    expect(
      SCENE_BACKGROUND_LINE_ITEMS.some(
        (item) => item.id === "svg-target-heart",
      ),
    ).toBe(true);
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
