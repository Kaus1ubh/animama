import { describe, expect, it } from "vitest";

import allLayers from "@/lib/content/fixtures/scene-effect-all-layers.json";

import {
  directionVector,
  gradientCss,
  linesGeometry,
  raysPath,
  scatterPlacements,
} from "./layerGeometry";
import { SCENE_EFFECT_LIMITS } from "./limits";
import type {
  ResolvedSceneBackgroundScatterLayer,
  SceneBackgroundDirection,
  SceneBackgroundLinesScreen,
  SceneBackgroundRaysScreen,
} from "./types";

const WIDTH = 720;
const HEIGHT = 450;

const scatter = (
  change: Partial<ResolvedSceneBackgroundScatterLayer> = {},
): ResolvedSceneBackgroundScatterLayer => ({
  ...(allLayers.scatters[0] as unknown as ResolvedSceneBackgroundScatterLayer),
  items: [{ id: "petal", kind: "png", label: "Petal", src: "blob:petal" }],
  ...change,
});

describe("Scene layer geometry", () => {
  it("draws gradients from their stops", () => {
    expect(
      gradientCss({
        enabled: true,
        type: "linear",
        angleDeg: 135,
        centerX: 0.5,
        centerY: 0.5,
        stops: [
          { color: "#fff27a", position: 0 },
          { color: "#ffb547", position: 1 },
        ],
      }),
    ).toBe("linear-gradient(135deg, #fff27a 0%, #ffb547 100%)");
    expect(
      gradientCss({ ...allLayers.gradient, type: "radial" } as never),
    ).toMatch(/^radial-gradient\(circle farthest-corner at 50% 30%, /);
  });

  it("gives the same placements for the same seed and view", () => {
    expect(scatterPlacements(scatter(), WIDTH, HEIGHT)).toEqual(
      scatterPlacements(scatter(), WIDTH, HEIGHT),
    );
    expect(scatterPlacements(scatter({ seed: 2 }), WIDTH, HEIGHT)).not.toEqual(
      scatterPlacements(scatter(), WIDTH, HEIGHT),
    );
    expect(raysPath(allLayers.screen as SceneBackgroundRaysScreen)).toBe(
      raysPath(allLayers.screen as SceneBackgroundRaysScreen),
    );
  });

  it.each([
    "left",
    "right",
    "up",
    "down",
    "diagonal-up-left",
    "diagonal-down-right",
  ] satisfies SceneBackgroundDirection[])(
    "keeps a %s drifter's track ends off-screen",
    (direction) => {
      for (const item of scatterPlacements(
        scatter({ direction, speedPxPerSec: 100 }),
        WIDTH,
        HEIGHT,
      )) {
        const centre = { x: item.x + item.size / 2, y: item.y + item.size / 2 };
        const offScreen = (x: number, y: number) =>
          x + item.size / 2 <= 0 ||
          x - item.size / 2 >= WIDTH ||
          y + item.size / 2 <= 0 ||
          y - item.size / 2 >= HEIGHT;
        expect(item.drift).not.toBeNull();
        expect(offScreen(centre.x, centre.y)).toBe(true);
        expect(
          offScreen(centre.x + item.drift!.x, centre.y + item.drift!.y),
        ).toBe(true);
        const vector = directionVector(direction);
        expect(Math.sign(item.drift!.x)).toBe(Math.sign(vector.x));
        expect(Math.sign(item.drift!.y)).toBe(Math.sign(vector.y));
      }
    },
  );

  it("keeps still items out of the column behind the head", () => {
    const placements = scatterPlacements(
      scatter({ direction: "static", speedPxPerSec: 0, keepFaceClear: true }),
      WIDTH,
      HEIGHT,
    );
    for (const item of placements) {
      const x = item.x + item.size / 2;
      const y = item.y + item.size / 2;
      expect(x > 0.35 * WIDTH && x < 0.65 * WIDTH && y < 0.6 * HEIGHT).toBe(
        false,
      );
      expect(item.drift).toBeNull();
    }
  });

  it("never draws more than the limits allow", () => {
    expect(
      scatterPlacements(scatter({ count: 10_000 }), WIDTH, HEIGHT),
    ).toHaveLength(SCENE_EFFECT_LIMITS.scatter.count[1]);
    expect(
      linesGeometry(
        {
          enabled: true,
          color: "#1d2a40",
          opacity: 1,
          seed: 5,
          kind: "lines",
          count: 10_000,
          minLength: 0.1,
          maxLength: 1,
          minWidthPx: 1,
          maxWidthPx: 2,
          swaySeconds: 0,
        } as SceneBackgroundLinesScreen,
        WIDTH,
        HEIGHT,
      ),
    ).toHaveLength(SCENE_EFFECT_LIMITS.lines.count[1]);
    expect(
      (
        raysPath({
          ...(allLayers.screen as SceneBackgroundRaysScreen),
          count: 10_000,
        }).match(/M/g) ?? []
      ).length,
    ).toBe(SCENE_EFFECT_LIMITS.rays.count[1]);
  });
});
