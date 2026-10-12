import { describe, expect, it } from "vitest";

import allLayers from "@/lib/content/fixtures/scene-effect-all-layers.json";
import limitCases from "@/lib/content/fixtures/scene-effect-limit-cases.json";
import fixture from "@/lib/content/fixtures/scene-effect-limits.json";

import {
  SCENE_EFFECT_LIMITS,
  sceneDefinitionLimitIssues,
  withinSceneRange,
} from "./limits";

describe("SCENE_EFFECT_LIMITS", () => {
  it("matches the parity fixture the backend checks too", () => {
    expect(JSON.parse(JSON.stringify(SCENE_EFFECT_LIMITS))).toEqual(fixture);
  });

  it("checks finite, inclusive and whole values", () => {
    expect(withinSceneRange(4, [4, 48], true)).toBe(true);
    expect(withinSceneRange(48.5, [4, 48])).toBe(false);
    expect(withinSceneRange(4.5, [4, 48], true)).toBe(false);
    expect(withinSceneRange(Number.NaN, [0, 1])).toBe(false);
    expect(withinSceneRange("1", [0, 1])).toBe(false);
  });
});

describe("sceneDefinitionLimitIssues", () => {
  it("accepts a definition that uses every layer within its limits", () => {
    expect(sceneDefinitionLimitIssues(structuredClone(allLayers))).toEqual([]);
  });

  it.each(limitCases.cases)(
    "refuses $field out of its limits",
    ({ path, value, field }) => {
      const definition = structuredClone(allLayers) as Record<string, unknown>;
      let owner = definition as Record<string | number, unknown>;
      for (const key of path.slice(0, -1))
        owner = owner[key] as Record<string | number, unknown>;
      owner[path.at(-1)!] = value;
      expect(
        sceneDefinitionLimitIssues(definition).map((issue) => issue.field),
      ).toContain(field);
    },
  );

  it("refuses each legacy Twemoji item by field, as Save does", () => {
    const definition = structuredClone(allLayers) as {
      marquee: { items: unknown[] };
      scatters: Array<{ items: unknown[] }>;
    };
    const emoji = { id: "old", kind: "emoji", label: "Sparkles", emoji: "*" };
    definition.marquee.items = [emoji];
    definition.scatters[1].items = [emoji];
    const issues = sceneDefinitionLimitIssues(definition);
    expect(issues.map((issue) => issue.field)).toEqual([
      "marquee.items.0",
      "scatters.1.items.0",
    ]);
    expect(issues[0].message).toBe(
      "Sparkles is an emoji, which Animama no longer provides. Replace it with a sticker or image, or remove it.",
    );
  });
});
