import { describe, expect, it } from "vitest";

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
});
