import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import rawCatalog from "@/assets/effects/scene-vfx/catalog.json";

import { TRACKED_EMOTIONS } from "@/lib/emotion";

import {
  getSceneBackgroundLayerPresetIds,
  getSceneFocusLinePresetById,
  getSceneFocusLinePresetIds,
  parseSceneVFXEntry,
} from "./catalog";
import { createTestSceneBackground } from "./sceneVFXTestFixtures";

const includedRoot = fileURLToPath(
  new URL("../../../../../../content/included", import.meta.url),
);

describe("scene VFX catalog", () => {
  it("bundles only the focus presets, unchanged from their Included copies", () => {
    expect(getSceneBackgroundLayerPresetIds()).toEqual([]);
    expect(rawCatalog.backgroundLayerPresets).toEqual([]);
    expect(getSceneFocusLinePresetIds()).toEqual(["dark", "light-streak"]);
    for (const presetId of getSceneFocusLinePresetIds()) {
      const included = JSON.parse(
        readFileSync(
          `${includedRoot}/vfx/scene/${presetId}/${presetId}.json`,
          "utf8",
        ),
      ) as { definition: Record<string, unknown> };
      // The bundled entry adds its id, label and enabled flag; the stored
      // definition adds its schema.
      const definition = { ...included.definition };
      delete definition.schema;
      expect(getSceneFocusLinePresetById(presetId)).toMatchObject(definition);
    }
  });

  it("has an Included background for every emotion, the five new ones included", () => {
    for (const emotion of TRACKED_EMOTIONS) {
      const presetId = `scene-vfx-emotion-${emotion}`;
      const descriptor = JSON.parse(
        readFileSync(
          `${includedRoot}/vfx/scene/${presetId}/${presetId}.json`,
          "utf8",
        ),
      ) as { content_id: string; definition: { kind: string } };
      expect(descriptor.content_id).toBe(
        `builtin:scene-effect:background:${presetId}`,
      );
      expect(descriptor.definition.kind).toBe("background_layers");
    }
    // Included also contains the authored Awkward Silence background and the
    // Scenes of the second Intense Reactions: one per emotion except
    // Disappointment, which plays Awkward Silence, and a backdrop under the
    // Confusion, Fear and Nervousness focus lines.
    expect(readdirSync(`${includedRoot}/vfx/scene`).sort()).toEqual(
      [
        "awkward-silence",
        ...getSceneFocusLinePresetIds(),
        ...TRACKED_EMOTIONS.map((emotion) => `scene-vfx-emotion-${emotion}`),
        ...TRACKED_EMOTIONS.filter(
          (emotion) => emotion !== "disappointment",
        ).map((emotion) => `scene-vfx-emotion-${emotion}-b`),
        ...["confusion", "fear", "nervousness"].map(
          (emotion) => `scene-vfx-emotion-${emotion}-b-backdrop`,
        ),
      ].sort(),
    );
  });

  it("skips a legacy emoji item in a runtime entry and refuses unknown kinds", () => {
    const preset = createTestSceneBackground();
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
});
