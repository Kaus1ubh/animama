import type { JsonObject } from "@/lib/avatar/particle-vfx/editor/types";
import { describe, expect, it } from "vitest";
import { particleThumbnailColor } from "./particleThumbnailColor";

const color = (r: number, g: number, b: number) => ({
  type: "ConstantColor",
  color: { r, g, b, a: 0 },
});
function document(): JsonObject {
  return {
    images: [{ uuid: "image", url: "textures/heart.png" }],
    textures: [{ uuid: "texture", image: "image" }],
    materials: [{ uuid: "material", map: "texture", color: 0xffffff }],
    object: {
      children: [
        { ps: { material: "other", startColor: color(0, 0, 0) } },
        {
          children: [
            {
              ps: {
                material: "material",
                startColor: color(1, 0.5, 1),
                behaviors: [{ type: "ColorOverLife", color: color(1, 1, 0.5) }],
              },
            },
          ],
        },
      ],
    },
  };
}
describe("particle thumbnail color", () => {
  it("uses the matching emitter and multiplies its colors without fade-in alpha", () => {
    expect(
      particleThumbnailColor(document(), "effect/textures/heart.png"),
    ).toEqual({ r: 1, g: 0.5, b: 0.5 });
  });
  it("takes the first gradient color used by included effects", () => {
    const value = document();
    (value.object as JsonObject).children = [
      {
        ps: {
          material: "material",
          startColor: color(1, 1, 1),
          behaviors: [
            {
              type: "ColorOverLife",
              color: {
                type: "Gradient",
                color: {
                  type: "CLinearFunction",
                  subType: "Color",
                  keys: [{ pos: 0, value: { r: 1, g: 0.42, b: 0.64 } }],
                },
              },
            },
          ],
        },
      },
    ];
    expect(particleThumbnailColor(value, "textures/heart.png")).toEqual({
      r: 1,
      g: 0.42,
      b: 0.64,
    });
  });
  it("keeps the original image when no emitter or texture matches", () => {
    expect(particleThumbnailColor(document(), "missing.png")).toBeNull();
    expect(particleThumbnailColor({}, "textures/heart.png")).toBeNull();
  });
});
