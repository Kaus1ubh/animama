import { describe, expect, it } from "vitest";

import { presentIdleStyle } from "./idleStylePresentation";

describe("presentIdleStyle", () => {
  it("shows explicit mappings and Default fallback by name", () => {
    const rows = presentIdleStyle({
      state: "custom",
      animations: [
        { animation_id: "neutral", name: "Breathing" },
        { animation_id: "angry", name: "Angry Stance" },
      ],
      effective_default_pool: ["neutral"],
      effective_emotion_pools: { anger: ["angry"] },
    });
    expect(rows.find((row) => row.key === "default")?.animationNames).toEqual([
      "Breathing",
    ]);
    expect(rows.find((row) => row.key === "anger")).toMatchObject({
      animationIds: ["angry"],
      animationNames: ["Angry Stance"],
      fallsBackToDefault: false,
    });
    expect(rows.find((row) => row.key === "sadness")).toMatchObject({
      animationNames: ["Breathing"],
      fallsBackToDefault: true,
    });
    expect(rows.slice(1).map((row) => row.key)).toEqual(
      rows
        .slice(1)
        .map((row) => row.key)
        .toSorted((left, right) => left.localeCompare(right)),
    );
  });
});
