import { describe, expect, it } from "vitest";

import allLayers from "@/lib/content/fixtures/scene-effect-all-layers.json";

import {
  anchoredViewportCover,
  directionVector,
  gradientCss,
  linesGeometry,
  raysPath,
  scatterPlacements,
  sceneScatterPlacements,
  type ScatterPlacement,
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

const STILL = { direction: "static", speedPxPerSec: 0 } as const;
const SEEDS = [1, 7, 42, 1000, 2024, 31337];
const SAMPLE_TIMES = [0, 0.7, 1.9, 3.3, 6.1, 12.5];

const centre = (item: ScatterPlacement, timeSec = 0) => {
  const at = { x: item.x + item.size / 2, y: item.y + item.size / 2 };
  if (!item.drift) return at;
  const { durationSec, delaySec } = item.drift;
  const progress = ((((timeSec - delaySec) / durationSec) % 1) + 1) % 1;
  return {
    x: at.x + item.drift.x * progress,
    y: at.y + item.drift.y * progress,
  };
};

/** Edge-to-edge distance between two items drawn as circles of their size. */
const gap = (a: ScatterPlacement, b: ScatterPlacement, timeSec = 0) => {
  const p = centre(a, timeSec);
  const q = centre(b, timeSec);
  return Math.hypot(p.x - q.x, p.y - q.y) - (a.size + b.size) / 2;
};

const smallestGap = (items: ScatterPlacement[], timeSec = 0) => {
  let smallest = Infinity;
  items.forEach((a, index) =>
    items.slice(index + 1).forEach((b) => {
      smallest = Math.min(smallest, gap(a, b, timeSec));
    }),
  );
  return smallest;
};

/** How many item centres fall in each cell of a `columns` × `rows` grid. */
const gridCounts = (
  centres: { x: number; y: number }[],
  area: { left: number; top: number; width: number; height: number },
  columns: number,
  rows: number,
) => {
  const counts = Array.from({ length: columns * rows }, () => 0);
  for (const { x, y } of centres) {
    const column = Math.floor(((x - area.left) / area.width) * columns);
    const row = Math.floor(((y - area.top) / area.height) * rows);
    if (column < 0 || column >= columns || row < 0 || row >= rows) continue;
    counts[row * columns + column] += 1;
  }
  return counts;
};

describe("Scatter placement", () => {
  it.each([
    ["upper stickers", { count: 18, minSize: 14, maxSize: 34 }, true],
    ["large upper stickers", { count: 6, minSize: 44, maxSize: 78 }, true],
    [
      "full-view stickers",
      { count: 24, minSize: 16, maxSize: 30, regionTop: 0, regionBottom: 1 },
      false,
    ],
  ] as const)(
    "spreads %s evenly inside the region without overlap",
    (_, change, keepFaceClear) => {
      for (const seed of SEEDS) {
        const layer = scatter({
          ...STILL,
          regionTop: 0.04,
          regionBottom: 0.5,
          ...change,
          keepFaceClear,
          seed,
        });
        const items = scatterPlacements(layer, WIDTH, HEIGHT);
        expect(items).toHaveLength(change.count);
        expect(smallestGap(items)).toBeGreaterThanOrEqual(0);
        const top = layer.regionTop * HEIGHT;
        const bottom = layer.regionBottom * HEIGHT;
        for (const item of items) {
          expect(item.x).toBeGreaterThanOrEqual(0);
          expect(item.x + item.size).toBeLessThanOrEqual(WIDTH);
          expect(item.y).toBeGreaterThanOrEqual(top);
          expect(item.y + item.size).toBeLessThanOrEqual(bottom);
        }
        if (change.count < 12) continue;
        // Coarse cells of the allowed area: each holds some, none too many.
        const centres = items.map((item) => centre(item));
        const height = bottom - top;
        const cells = keepFaceClear
          ? [
              ...gridCounts(
                centres,
                { left: 0, top, width: 0.35 * WIDTH, height },
                2,
                2,
              ),
              ...gridCounts(
                centres,
                { left: 0.65 * WIDTH, top, width: 0.35 * WIDTH, height },
                2,
                2,
              ),
            ]
          : gridCounts(centres, { left: 0, top, width: WIDTH, height }, 4, 3);
        const mean = change.count / cells.length;
        expect(Math.min(...cells)).toBeGreaterThanOrEqual(1);
        expect(Math.max(...cells)).toBeLessThanOrEqual(Math.ceil(mean * 2));
      }
    },
  );

  it("keeps a crowded region evenly spread as a best effort", () => {
    const items = scatterPlacements(
      scatter({
        ...STILL,
        count: 48,
        minSize: 90,
        maxSize: 110,
        regionTop: 0,
        regionBottom: 0.5,
        keepFaceClear: false,
        seed: 9,
      }),
      WIDTH,
      HEIGHT,
    );
    expect(items).toHaveLength(48);
    const cells = gridCounts(
      items.map((item) => centre(item)),
      { left: 0, top: 0, width: WIDTH, height: HEIGHT / 2 },
      4,
      2,
    );
    expect(Math.min(...cells)).toBeGreaterThanOrEqual(3);
    expect(Math.max(...cells)).toBeLessThanOrEqual(10);
  });

  it("keeps still items of a Scene's scatter layers clear of each other", () => {
    for (const seed of SEEDS) {
      const layers = [
        scatter({
          ...STILL,
          count: 6,
          minSize: 48,
          maxSize: 80,
          regionTop: 0.04,
          regionBottom: 0.5,
          keepFaceClear: true,
          seed,
        }),
        scatter({ count: 14, speedPxPerSec: 24, seed: seed + 1 }),
        scatter({
          ...STILL,
          count: 12,
          minSize: 12,
          maxSize: 22,
          regionTop: 0.04,
          regionBottom: 0.5,
          keepFaceClear: true,
          seed: seed + 2,
        }),
      ];
      const placed = sceneScatterPlacements(layers, WIDTH, HEIGHT);
      expect(placed.map((items) => items.length)).toEqual([6, 14, 12]);
      expect(placed[0]).toEqual(scatterPlacements(layers[0], WIDTH, HEIGHT));
      expect(smallestGap([...placed[0], ...placed[2]])).toBeGreaterThanOrEqual(
        0,
      );
    }
  });

  it("skips disabled layers and does not avoid their items", () => {
    const first = scatter({ ...STILL, count: 10, seed: 3, enabled: false });
    const second = scatter({ ...STILL, count: 10, seed: 4 });
    const placed = sceneScatterPlacements([first, second], WIDTH, HEIGHT);
    expect(placed[0]).toEqual([]);
    expect(placed[1]).toEqual(scatterPlacements(second, WIDTH, HEIGHT));
  });

  it("places the same Scene the same way for the same seeds", () => {
    const layers = [
      scatter({ ...STILL, count: 12, seed: 5 }),
      scatter({ ...STILL, count: 12, seed: 6 }),
      scatter({ count: 20, speedPxPerSec: 40, seed: 8 }),
    ];
    expect(sceneScatterPlacements(layers, WIDTH, HEIGHT)).toEqual(
      sceneScatterPlacements(layers, WIDTH, HEIGHT),
    );
  });

  /**
   * The across-motion span a drifting layer's lanes share: the region for
   * left and right motion, the view width for up and down, and the whole
   * off-screen span for diagonals (centre offsets across the motion).
   */
  const laneSpan = (layer: ResolvedSceneBackgroundScatterLayer) => {
    const v = directionVector(layer.direction);
    if (v.y === 0)
      return {
        across: (item: ScatterPlacement) => centre(item).y,
        start: layer.regionTop * HEIGHT,
        length: (layer.regionBottom - layer.regionTop) * HEIGHT,
      };
    if (v.x === 0)
      return {
        across: (item: ScatterPlacement) => centre(item).x,
        start: 0,
        length: WIDTH,
      };
    const halfSpan =
      (Math.abs(v.y) * WIDTH + Math.abs(v.x) * HEIGHT) / 2 + layer.maxSize;
    return {
      across: (item: ScatterPlacement) => {
        const { x, y } = centre(item);
        return (x - WIDTH / 2) * -v.y + (y - HEIGHT / 2) * v.x;
      },
      start: -halfSpan,
      length: 2 * halfSpan,
    };
  };

  it.each([
    ["down", { count: 24, minSize: 16, maxSize: 30, direction: "down" }],
    [
      "left",
      {
        count: 10,
        minSize: 36,
        maxSize: 60,
        direction: "left",
        regionTop: 0.55,
        regionBottom: 1,
      },
    ],
    [
      "diagonal",
      { count: 18, minSize: 40, maxSize: 76, direction: "diagonal-up-left" },
    ],
    [
      "dense diagonal",
      { count: 48, minSize: 12, maxSize: 24, direction: "diagonal-down-left" },
    ],
    ["up", { count: 14, minSize: 22, maxSize: 54, direction: "up" }],
  ] as const)(
    "gives %s drifters evenly spaced lanes and phases",
    (_, change) => {
      for (const seed of SEEDS) {
        const layer = scatter({
          regionTop: 0,
          regionBottom: 1,
          ...change,
          speedPxPerSec: 50,
          keepFaceClear: false,
          seed,
        });
        const items = scatterPlacements(layer, WIDTH, HEIGHT);
        // Lanes are equal cells of the span, counted from the largest size.
        const span = laneSpan(layer);
        const capacity = Math.max(1, Math.floor(span.length / layer.maxSize));
        const perLane = Math.ceil(items.length / capacity);
        const laneCount = Math.ceil(items.length / perLane);
        const laneWidth = span.length / laneCount;
        const lanes = Array.from(
          { length: laneCount },
          (): ScatterPlacement[] => [],
        );
        for (const item of items) {
          const across = span.across(item) - span.start;
          const lane = Math.floor(across / laneWidth);
          expect(across - item.size / 2).toBeGreaterThanOrEqual(
            lane * laneWidth - 1e-6,
          );
          expect(across + item.size / 2).toBeLessThanOrEqual(
            (lane + 1) * laneWidth + 1e-6,
          );
          lanes[lane].push(item);
        }
        for (const lane of lanes)
          expect([perLane - 1, perLane]).toContain(lane.length);
        // Items sharing a lane stay apart along the track at any moment.
        for (const timeSec of SAMPLE_TIMES)
          expect(smallestGap(items, timeSec)).toBeGreaterThanOrEqual(0);
      }
    },
  );

  it.each([
    ["down", { direction: "down", count: 40, minSize: 16, maxSize: 30 }],
    [
      "diagonal",
      { direction: "diagonal-down-left", count: 48, minSize: 20, maxSize: 30 },
    ],
    ["left", { direction: "left", count: 30, minSize: 20, maxSize: 40 }],
  ] as const)(
    "keeps %s drifters evenly filling the view at every moment",
    (_, change) => {
      for (const seed of SEEDS) {
        const items = scatterPlacements(
          scatter({
            ...change,
            regionTop: 0,
            regionBottom: 1,
            speedPxPerSec: 60,
            keepFaceClear: false,
            seed,
          }),
          WIDTH,
          HEIGHT,
        );
        for (const timeSec of SAMPLE_TIMES) {
          const cells = gridCounts(
            items.map((item) => centre(item, timeSec)),
            { left: 0, top: 0, width: WIDTH, height: HEIGHT },
            3,
            2,
          );
          const mean = cells.reduce((sum, value) => sum + value, 0) / 6;
          expect(Math.min(...cells)).toBeGreaterThanOrEqual(
            Math.floor(mean / 2),
          );
          expect(Math.max(...cells)).toBeLessThanOrEqual(Math.ceil(mean * 2));
        }
      }
    },
  );

  it("keeps up and down drifters out of the face column's width", () => {
    for (const seed of SEEDS) {
      const items = scatterPlacements(
        scatter({
          direction: "down",
          speedPxPerSec: 200,
          count: 24,
          minSize: 16,
          maxSize: 30,
          keepFaceClear: true,
          seed,
        }),
        WIDTH,
        HEIGHT,
      );
      for (const item of items) {
        const x = centre(item).x;
        expect(
          x + item.size / 2 <= 0.35 * WIDTH ||
            x - item.size / 2 >= 0.65 * WIDTH,
        ).toBe(true);
      }
      for (const timeSec of SAMPLE_TIMES)
        expect(smallestGap(items, timeSec)).toBeGreaterThanOrEqual(0);
    }
  });
});

/** A layer with one item, copying an Included background's settings. */
const included = (
  settings: Omit<ResolvedSceneBackgroundScatterLayer, "enabled" | "items">,
): ResolvedSceneBackgroundScatterLayer => ({
  enabled: true,
  items: [{ id: "sticker", kind: "png", label: "Sticker", src: "blob:s" }],
  ...settings,
});
const stillSticker = {
  regionTop: 0.04,
  regionBottom: 0.5,
  keepFaceClear: true,
  direction: "static",
  speedPxPerSec: 0,
} as const;
const noSpin = {
  minSpinDegPerSec: 0,
  maxSpinDegPerSec: 0,
  alternateSpin: false,
};
const unrotated = { minRotationDeg: 0, maxRotationDeg: 0 };

/** The scatter layers of five Included backgrounds (P8 settings). */
const BACKGROUNDS: Record<string, ResolvedSceneBackgroundScatterLayer[]> = {
  fear: [
    included({
      ...stillSticker,
      ...noSpin,
      count: 4,
      seed: 177,
      minSize: 120,
      maxSize: 170,
      minRotationDeg: -18,
      maxRotationDeg: 18,
      minOpacity: 0.9,
      maxOpacity: 1,
      pulse: "flicker",
    }),
  ],
  remorse: [
    included({
      ...stillSticker,
      count: 4,
      seed: 89,
      minSize: 110,
      maxSize: 170,
      minRotationDeg: 0,
      maxRotationDeg: 360,
      minOpacity: 0.35,
      maxOpacity: 0.6,
      minSpinDegPerSec: 8,
      maxSpinDegPerSec: 18,
      alternateSpin: false,
      pulse: "none",
    }),
    included({
      ...noSpin,
      ...unrotated,
      count: 8,
      seed: 58,
      minSize: 10,
      maxSize: 24,
      minOpacity: 0.4,
      maxOpacity: 0.7,
      regionTop: 0,
      regionBottom: 1,
      keepFaceClear: true,
      direction: "up",
      speedPxPerSec: 14,
      pulse: "none",
    }),
  ],
  disgust: [
    included({
      ...stillSticker,
      count: 5,
      seed: 21,
      minSize: 90,
      maxSize: 150,
      minRotationDeg: 0,
      maxRotationDeg: 360,
      minOpacity: 0.55,
      maxOpacity: 0.85,
      minSpinDegPerSec: 25,
      maxSpinDegPerSec: 50,
      alternateSpin: true,
      pulse: "none",
    }),
    included({
      ...noSpin,
      ...unrotated,
      count: 12,
      seed: 48,
      minSize: 12,
      maxSize: 30,
      minOpacity: 0.6,
      maxOpacity: 0.9,
      regionTop: 0,
      regionBottom: 1,
      keepFaceClear: true,
      direction: "up",
      speedPxPerSec: 30,
      pulse: "none",
    }),
  ],
  confusion: [
    included({
      ...stillSticker,
      count: 5,
      seed: 12,
      minSize: 90,
      maxSize: 140,
      minRotationDeg: 0,
      maxRotationDeg: 360,
      minOpacity: 0.7,
      maxOpacity: 0.9,
      minSpinDegPerSec: 40,
      maxSpinDegPerSec: 80,
      alternateSpin: true,
      pulse: "none",
    }),
  ],
  excitement: [
    included({
      ...stillSticker,
      ...noSpin,
      count: 10,
      seed: 47,
      minSize: 56,
      maxSize: 96,
      minRotationDeg: -30,
      maxRotationDeg: 30,
      minOpacity: 0.9,
      maxOpacity: 1,
      pulse: "pop",
    }),
    included({
      count: 32,
      seed: 72,
      minSize: 12,
      maxSize: 24,
      minRotationDeg: 0,
      maxRotationDeg: 180,
      minOpacity: 0.9,
      maxOpacity: 1,
      regionTop: 0,
      regionBottom: 1,
      keepFaceClear: false,
      direction: "diagonal-up-left",
      speedPxPerSec: 110,
      minSpinDegPerSec: 120,
      maxSpinDegPerSec: 300,
      alternateSpin: true,
      pulse: "none",
    }),
  ],
};

/** Joy's two layers, both drifting up and to the left at different speeds. */
const JOY = [
  included({
    count: 18,
    seed: 61,
    minSize: 40,
    maxSize: 76,
    minRotationDeg: -25,
    maxRotationDeg: 25,
    minOpacity: 1,
    maxOpacity: 1,
    regionTop: 0,
    regionBottom: 1,
    keepFaceClear: true,
    direction: "diagonal-up-left",
    speedPxPerSec: 55,
    minSpinDegPerSec: 0,
    maxSpinDegPerSec: 25,
    alternateSpin: true,
    pulse: "pop",
  }),
  included({
    count: 26,
    seed: 62,
    minSize: 12,
    maxSize: 22,
    minRotationDeg: 0,
    maxRotationDeg: 180,
    minOpacity: 0.9,
    maxOpacity: 1,
    regionTop: 0,
    regionBottom: 1,
    keepFaceClear: false,
    direction: "diagonal-up-left",
    speedPxPerSec: 70,
    minSpinDegPerSec: 90,
    maxSpinDegPerSec: 220,
    alternateSpin: true,
    pulse: "none",
  }),
];

const VIEWS = [
  [420, 560],
  [420, 420],
  [720, 640],
  [1280, 900],
] as const;

describe("Scene scatter fit", () => {
  it.each(Object.keys(BACKGROUNDS))(
    "shrinks %s's still stickers until none overlap in small views",
    (name) => {
      for (const [width, height] of VIEWS) {
        const placed = sceneScatterPlacements(BACKGROUNDS[name], width, height);
        const still = placed.filter(
          (_, index) => BACKGROUNDS[name][index].speedPxPerSec === 0,
        );
        expect(smallestGap(still.flat())).toBeGreaterThanOrEqual(0);
        still.forEach((items, index) => {
          const layer = BACKGROUNDS[name][index];
          for (const item of items)
            expect(item.size).toBeGreaterThanOrEqual(
              0.4 * layer.minSize - 1e-9,
            );
        });
      }
    },
  );

  it("keeps full sizes where the stickers fit", () => {
    for (const layers of Object.values(BACKGROUNDS)) {
      const sizes = (width: number, height: number) =>
        sceneScatterPlacements(layers, width, height).map((items) =>
          items.map((item) => item.size),
        );
      expect(sizes(1280, 900)).toEqual(sizes(2560, 1800));
    }
    const small = sceneScatterPlacements(BACKGROUNDS.fear, 420, 420)[0];
    const large = sceneScatterPlacements(BACKGROUNDS.fear, 1280, 900)[0];
    small.forEach((item, index) =>
      expect(item.size).toBeLessThan(large[index].size),
    );
  });

  it.each(VIEWS)(
    "keeps joy's same-direction layers in separate lanes at %i×%i",
    (width, height) => {
      const [stars, confetti] = sceneScatterPlacements(JOY, width, height);
      expect(stars).toHaveLength(18);
      expect(confetti).toHaveLength(26);
      for (let frame = 0; frame < 200; frame += 1)
        expect(
          smallestGap([...stars, ...confetti], frame * 0.37),
        ).toBeGreaterThanOrEqual(0);
      // Interleaved: each layer reaches across the shared span.
      const offset = (item: ScatterPlacement) => {
        const { x, y } = centre(item);
        return (x - width / 2) * Math.SQRT1_2 - (y - height / 2) * Math.SQRT1_2;
      };
      const halfView = ((width + height) * Math.SQRT1_2) / 2;
      for (const items of [stars, confetti]) {
        const offsets = items.map(offset);
        expect(Math.min(...offsets)).toBeLessThan(-0.6 * halfView);
        expect(Math.max(...offsets)).toBeGreaterThan(0.6 * halfView);
      }
    },
  );

  it("keeps same-direction layers in their own regions when these do not meet", () => {
    const upper = scatter({
      direction: "left",
      speedPxPerSec: 40,
      count: 12,
      minSize: 20,
      maxSize: 30,
      regionTop: 0,
      regionBottom: 0.3,
      seed: 3,
    });
    const lower = { ...upper, regionTop: 0.6, regionBottom: 1, seed: 4 };
    const [first, second] = sceneScatterPlacements(
      [upper, lower],
      WIDTH,
      HEIGHT,
    );
    expect(first).toEqual(scatterPlacements(upper, WIDTH, HEIGHT));
    expect(second).toEqual(scatterPlacements(lower, WIDTH, HEIGHT));
    for (const item of first)
      expect(item.y + item.size).toBeLessThanOrEqual(0.3 * HEIGHT + 1e-6);
    for (const item of second)
      expect(item.y).toBeGreaterThanOrEqual(0.6 * HEIGHT - 1e-6);
  });
});

describe("anchoredViewportCover", () => {
  it("is the viewport itself when the anchor is centred", () => {
    expect(
      anchoredViewportCover(
        { left: 200, top: 100, width: 1040, height: 700 },
        { width: 1440, height: 900 },
      ),
    ).toEqual({ left: 0, top: 0, width: 1440, height: 900 });
  });

  it("centres on an off-centre anchor while covering the viewport", () => {
    const cover = anchoredViewportCover(
      { left: 242, top: 0, width: 590, height: 900 },
      { width: 1440, height: 900 },
    );
    // Canvas centre is x = 537, so the far (right) edge sets the half-width.
    expect(cover).toEqual({ left: -366, top: 0, width: 1806, height: 900 });
    expect(cover.left + cover.width / 2).toBe(537);
    expect(cover.left).toBeLessThanOrEqual(0);
    expect(cover.left + cover.width).toBeGreaterThanOrEqual(1440);
  });
});
