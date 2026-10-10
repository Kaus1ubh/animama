import { describe, expect, it } from "vitest";

import allLayers from "@/lib/content/fixtures/scene-effect-all-layers.json";
import limitCases from "@/lib/content/fixtures/scene-effect-limit-cases.json";

import { buildSceneVFXRuntimeEntry } from "./runtime-state";
import { sceneEntryFromDefinition } from "./sceneDefinition";

const definition = {
  schema: "animama/scene-effect/1",
  kind: "background_layers",
  durationMs: null,
  dismissOnInput: false,
  coverUiOverlays: false,
  solid: { enabled: true, color: "#ffe869" },
  pattern: {
    enabled: false,
    pattern: "none",
    color: "#ffffff",
    size: 24,
    spacing: 18,
    opacity: 0.4,
  },
  marquee: {
    enabled: true,
    itemSize: 72,
    gap: 24,
    rowGap: 18,
    direction: "left",
    itemRotationMode: "upright",
    itemRotationOffsetDeg: 0,
    speedPxPerSec: 100,
    opacity: 1,
    items: [{ id: "star", kind: "image", label: "Star", image: "star.png" }],
  },
};

describe("Scene definition projection", () => {
  it("serves each stored image item by URL and reports the images it used", () => {
    const { entry, referencedImages } = sceneEntryFromDefinition(
      definition,
      { id: "joy", label: "Joy" },
      (name) => (name === "star.png" ? "blob:star" : null),
    );
    expect(entry).toMatchObject({ id: "joy", label: "Joy" });
    expect(
      entry.kind === "background_layers" && entry.marquee.items[0],
    ).toMatchObject({ kind: "png", src: "blob:star" });
    expect([...referencedImages]).toEqual(["star.png"]);
  });

  it("refuses an item whose image has no URL", () => {
    expect(() =>
      sceneEntryFromDefinition(
        definition,
        { id: "joy", label: "Joy" },
        () => null,
      ),
    ).toThrow("scene_vfx_resource_invalid");
  });

  it("projects every optional layer, serving tile and scatter images", () => {
    const { entry, referencedImages } = sceneEntryFromDefinition(
      allLayers,
      { id: "affection", label: "Affection" },
      (name) => `blob:${name}`,
    );
    expect(entry.kind).toBe("background_layers");
    if (entry.kind !== "background_layers") return;
    expect(entry.gradient).toMatchObject({ type: "radial", centerY: 0.3 });
    expect(entry.gradient?.stops).toHaveLength(3);
    expect(entry.tile).toMatchObject({ src: "blob:bokeh.png", size: 180 });
    expect(entry.tile).not.toHaveProperty("image");
    expect(entry.screen).toMatchObject({ kind: "rays", count: 20 });
    expect(entry.scatters?.[0].items[0]).toMatchObject({
      kind: "png",
      src: "blob:petal.png",
    });
    expect(entry.flash).toMatchObject({ enabled: true, durationMs: 260 });
    expect([...referencedImages].sort()).toEqual(["bokeh.png", "petal.png"]);
    // Emoji scatter items resolve to their image, as marquee items do.
    const runtime = buildSceneVFXRuntimeEntry(entry);
    expect(
      runtime.entry.kind === "background_layers" &&
        runtime.entry.scatters?.[1].items[0],
    ).toMatchObject({ kind: "emoji", src: expect.stringContaining("2728") });
  });

  it("refuses a tile whose image has no URL", () => {
    expect(() =>
      sceneEntryFromDefinition(
        allLayers,
        { id: "affection", label: "Affection" },
        (name) => (name === "petal.png" ? "blob:petal" : null),
      ),
    ).toThrow("scene_vfx_resource_invalid");
  });
});

describe("untrusted Scene definitions", () => {
  it.each(limitCases.structureCases)(
    "refuses $field that the layers cannot draw safely",
    ({ path, value }) => {
      const definition = structuredClone(allLayers) as Record<string, unknown>;
      let owner = definition as Record<string | number, unknown>;
      for (const key of path.slice(0, -1))
        owner = owner[key] as Record<string | number, unknown>;
      owner[path.at(-1)!] = value;
      expect(() =>
        sceneEntryFromDefinition(
          definition,
          { id: "probe", label: "Probe" },
          (name) => `blob:${name}`,
        ),
      ).toThrow();
    },
  );
});
