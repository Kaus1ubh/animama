import { createMulberry32 } from "./focus-lines";
import { SCENE_EFFECT_LIMITS } from "./limits";
import type {
  ResolvedSceneBackgroundLineItem,
  ResolvedSceneBackgroundScatterLayer,
  SceneBackgroundDirection,
  SceneBackgroundGradientLayer,
  SceneBackgroundLinesScreen,
  SceneBackgroundRaysScreen,
  SceneBackgroundScatterPulse,
} from "./types";

/**
 * Geometry of the optional Scene background layers (C1–C6), kept apart from
 * the React layers so it is deterministic and testable: the same definition
 * and view size give the same picture in chat, the creator, the preview dock,
 * picture-in-picture and the review tools.
 */

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));
const lerp = (from: number, to: number, t: number) => from + (to - from) * t;

/** The CSS background of a gradient layer. */
export function gradientCss(layer: SceneBackgroundGradientLayer): string {
  const stops = layer.stops
    .map(({ color, position }) => `${color} ${clamp(position, 0, 1) * 100}%`)
    .join(", ");
  return layer.type === "radial"
    ? `radial-gradient(circle farthest-corner at ${layer.centerX * 100}% ${layer.centerY * 100}%, ${stops})`
    : `linear-gradient(${layer.angleDeg}deg, ${stops})`;
}

/** Unit vector of a marquee direction in screen space (y grows down). */
export function directionVector(direction: SceneBackgroundDirection): {
  x: number;
  y: number;
} {
  const diagonal = Math.SQRT1_2;
  switch (direction) {
    case "left":
      return { x: -1, y: 0 };
    case "right":
      return { x: 1, y: 0 };
    case "up":
      return { x: 0, y: -1 };
    case "down":
      return { x: 0, y: 1 };
    case "diagonal-up-left":
      return { x: -diagonal, y: -diagonal };
    case "diagonal-up-right":
      return { x: diagonal, y: -diagonal };
    case "diagonal-down-left":
      return { x: -diagonal, y: diagonal };
    case "diagonal-down-right":
      return { x: diagonal, y: diagonal };
    default:
      return { x: 0, y: 0 };
  }
}

/**
 * The rays as an SVG path in a −1…1 square around their centre: separate
 * wedges, or one spiky starburst whose spike lengths vary with the seed.
 */
export function raysPath(layer: SceneBackgroundRaysScreen): string {
  const count = Math.round(
    clamp(layer.count, ...SCENE_EFFECT_LIMITS.rays.count),
  );
  const point = (angle: number, radius: number) =>
    `${(Math.cos(angle) * radius).toFixed(4)} ${(Math.sin(angle) * radius).toFixed(4)}`;
  if (layer.spiky) {
    const random = createMulberry32(layer.seed);
    const points = Array.from({ length: count * 2 }, (_, index) => {
      const angle = (index / (count * 2)) * Math.PI * 2;
      const radius = index % 2 ? 0.12 + random() * 0.06 : 0.7 + random() * 0.3;
      return point(angle, radius);
    });
    return `M${points.join("L")}Z`;
  }
  return Array.from({ length: count }, (_, index) => {
    const start = (index / count) * Math.PI * 2;
    const end = start + (Math.PI / count) * 0.9;
    return `M0 0L${point(start, 1)}L${point(end, 1)}Z`;
  }).join("");
}

/** Lines hanging from the top edge of a `width` × `height` view. */
export function linesGeometry(
  layer: SceneBackgroundLinesScreen,
  width: number,
  height: number,
): { x: number; length: number; width: number }[] {
  const count = Math.round(
    clamp(layer.count, ...SCENE_EFFECT_LIMITS.lines.count),
  );
  const random = createMulberry32(layer.seed);
  return Array.from({ length: count }, (_, index) => ({
    x: (index + random() * 0.8) * (width / count),
    length: lerp(layer.minLength, layer.maxLength, random()) * height,
    width: lerp(layer.minWidthPx, layer.maxWidthPx, random()),
  }));
}

/** How one scattered item is drawn and animated. */
export type ScatterPlacement = {
  key: string;
  item: ResolvedSceneBackgroundLineItem;
  /** Top-left corner in the view, before any drift. */
  x: number;
  y: number;
  size: number;
  rotationDeg: number;
  opacity: number;
  /** Travel per cycle; null when the item does not drift. */
  drift: { x: number; y: number; durationSec: number; delaySec: number } | null;
  /** Null when the item does not spin; `reverse` turns counter-clockwise. */
  spin: { durationSec: number; reverse: boolean; delaySec: number } | null;
  pulse: {
    name: Exclude<SceneBackgroundScatterPulse, "none">;
    durationSec: number;
    delaySec: number;
  } | null;
};

const PULSE_PERIOD_SEC = { twinkle: 1.8, pop: 0.9, flicker: 0.7 } as const;
/** The column kept clear behind the head, as fractions of the view. */
const FACE_COLUMN = { left: 0.35, right: 0.65, bottom: 0.6 } as const;
/** Golden-ratio conjugate: staggers neighbouring lanes' phases. */
const GOLDEN = (Math.sqrt(5) - 1) / 2;
/** Best-candidate draws per still item, and the cap when all of them overlap. */
const STILL_CANDIDATES = 96;
const STILL_CANDIDATES_CROWDED = 256;
/**
 * Seeded jitter as a share of the free space: a drifter's sideways offset
 * inside its lane, and its shift along the track between its lane
 * neighbours. Both stay below half, so the jitter never causes an overlap.
 */
const LANE_JITTER = 0.3;
const PHASE_JITTER = 0.2;

/** A stretch of a line: its start and length in px. */
type Span = { start: number; length: number };
/** An item drawn as a circle of its size, centred at `x`, `y`. */
type Disc = { x: number; y: number; size: number };

const sum = (values: number[]) =>
  values.reduce((total, value) => total + value, 0);

/** `spans` minus the open interval from `cutStart` to `cutEnd`. */
function cutSpans(spans: Span[], cutStart: number, cutEnd: number): Span[] {
  return spans.flatMap(({ start, length }) => {
    const end = start + length;
    if (cutEnd <= start || cutStart >= end) return [{ start, length }];
    return [
      { start, length: cutStart - start },
      { start: cutEnd, length: end - cutEnd },
    ].filter((span) => span.length > 0);
  });
}

/** The point `t` (0–1) of the way through `spans` laid end to end. */
function pointInSpans(spans: Span[], t: number): number {
  let remaining = t * sum(spans.map((span) => span.length));
  for (const span of spans) {
    if (remaining <= span.length) return span.start + remaining;
    remaining -= span.length;
  }
  const last = spans[spans.length - 1];
  return last.start + last.length;
}

/**
 * Equal lanes for `count` drifters across `spans`: as many lanes of at
 * least `laneSize` as fit, then as few as hold the same number of items
 * each (so lanes differ by at most one item), shared between the spans in
 * proportion to how many fit in each.
 */
function laneCells(spans: Span[], count: number, laneSize: number): Span[] {
  const fits = spans.map((span) =>
    Math.max(1, Math.floor(span.length / Math.max(laneSize, 1e-3))),
  );
  const capacity = sum(fits);
  const lanes = Math.ceil(count / Math.ceil(count / capacity));
  const exact = fits.map((fit) => (lanes * fit) / capacity);
  const shares = exact.map(Math.floor);
  exact
    .map((value, index) => ({ index, rest: value - shares[index] }))
    .sort((a, b) => b.rest - a.rest || a.index - b.index)
    .slice(0, lanes - sum(shares))
    .forEach(({ index }) => (shares[index] += 1));
  return spans.flatMap((span, index) =>
    Array.from({ length: shares[index] }, (_, lane) => ({
      start: span.start + (lane * span.length) / shares[index],
      length: span.length / shares[index],
    })),
  );
}

/**
 * Each drifter's place across the motion (jittered inside its lane) and its
 * phase (0–1 along its track). Every lane holds its items evenly spaced along the
 * track, neighbouring lanes are staggered by the golden ratio so the layer
 * reads as an even, unpatterned field, lanes with an extra item are spread
 * across the span, and items take the slots in phase order.
 */
function driftSlots(
  cells: Span[],
  sizes: number[],
  maxSize: number,
  travel: number,
  random: () => number,
): { across: number; phase: number }[] {
  const count = sizes.length;
  const perLane = Math.ceil(count / cells.length);
  // `extra` lanes hold `perLane` items, the others one fewer.
  const extra = count - (perLane - 1) * cells.length;
  const slots = cells.flatMap((cell, lane) => {
    const items =
      perLane -
      1 +
      (Math.floor(((lane + 1) * extra) / cells.length) >
      Math.floor((lane * extra) / cells.length)
        ? 1
        : 0);
    const stagger = (lane * GOLDEN) % 1;
    const alongSlack = Math.max(0, travel / items - maxSize) / travel;
    return Array.from({ length: items }, (_, slot) => ({
      cell,
      phase:
        ((((slot + stagger) / items +
          (random() * 2 - 1) * PHASE_JITTER * alongSlack) %
          1) +
          1) %
        1,
    }));
  });
  slots.sort((a, b) => a.phase - b.phase);
  return slots.map(({ cell, phase }, index) => {
    const slack = Math.max(0, cell.length - sizes[index]);
    return {
      across:
        cell.start + cell.length / 2 + (random() * 2 - 1) * LANE_JITTER * slack,
      phase,
    };
  });
}

/**
 * Best-candidate (Mitchell) placement of still items, largest first: of a
 * few seeded candidates inside the allowed area, each item takes the one
 * whose edges are farthest from the items already placed (this layer's and
 * `obstacles`) and from the area's edges (the region's and the face
 * column's) at half weight, so gaps to
 * neighbours and to the border come out even. When every candidate
 * overlaps, more are drawn and the least-overlapping wins.
 */
function stillCentres(
  sizes: number[],
  area: { width: number; top: number; bottom: number },
  faceColumn: { left: number; right: number; bottom: number } | null,
  obstacles: Disc[],
  random: () => number,
): { x: number; y: number }[] {
  const placed = [...obstacles];
  const centres: { x: number; y: number }[] = [];
  const order = sizes
    .map((size, index) => ({ size, index }))
    .sort((a, b) => b.size - a.size || a.index - b.index);
  for (const { size, index } of order) {
    // Where the centre may go so the whole item stays inside the area; an
    // axis too short for the item pins the centre to the middle.
    const range = (start: number, end: number): Span =>
      end - start >= size
        ? { start: start + size / 2, length: end - start - size }
        : { start: (start + end) / 2, length: 0 };
    const xRange = range(0, area.width);
    const yRange = range(area.top, area.bottom);
    const edgeGap = (value: number, { start, length }: Span) =>
      length > 0 ? Math.min(value - start, start + length - value) : Infinity;
    const candidate = () => {
      const y = yRange.start + random() * yRange.length;
      const xSpans =
        faceColumn && y < faceColumn.bottom
          ? cutSpans([xRange], faceColumn.left, faceColumn.right)
          : [xRange];
      const u = random();
      // An item too wide for either side rests on the column's edge.
      const x =
        xSpans.length > 0
          ? pointInSpans(xSpans, u)
          : u < 0.5
            ? faceColumn!.left
            : faceColumn!.right;
      return { x, y };
    };
    // The face column is an edge of the area too (its gap is the centre's).
    const columnGap = (x: number, y: number) =>
      faceColumn
        ? Math.hypot(
            Math.max(faceColumn.left - x, 0, x - faceColumn.right),
            Math.max(y - faceColumn.bottom, 0),
          )
        : Infinity;
    const score = ({ x, y }: { x: number; y: number }) =>
      placed.reduce(
        (nearest, other) =>
          Math.min(
            nearest,
            Math.hypot(x - other.x, y - other.y) - (size + other.size) / 2,
          ),
        2 * Math.min(edgeGap(x, xRange), edgeGap(y, yRange), columnGap(x, y)),
      );
    let best = { x: 0, y: 0 };
    let bestScore = -Infinity;
    for (let draw = 0; draw < STILL_CANDIDATES_CROWDED; draw += 1) {
      if (draw >= STILL_CANDIDATES && bestScore >= 0) break;
      const next = candidate();
      const nextScore = score(next);
      if (nextScore > bestScore) {
        best = next;
        bestScore = nextScore;
      }
    }
    centres[index] = best;
    placed.push({ ...best, size });
  }
  return centres;
}

/**
 * Place a scatter layer's items in a `width` × `height` view. Sizes,
 * rotations, opacities, motion and positions all come from the seed, so the
 * same layer and view always give the same picture. Items count as circles
 * of their size.
 *
 * - A still item rests wholly inside the region (and the view), spread by
 *   best-candidate placement so items do not overlap whenever they fit, and
 *   gaps between them and to the region's edges are even. A crowded region
 *   keeps the least overlap. Still items also stay clear of `obstacles`:
 *   the still items of the Scene's other scatter layers.
 * - A drifting item crosses the whole view on a track that starts and ends
 *   off-screen, in one of equal lanes across the motion (the region for
 *   left and right motion), with as many lanes as the largest item fits.
 *   Each lane's items are evenly spaced along the track and neighbouring
 *   lanes are staggered, so the layer stays evenly filled at every moment,
 *   items never touch, and nothing appears or vanishes mid-view.
 *
 * `keepFaceClear` keeps still items' centres out of the column behind the
 * head, and up and down drifters' lanes outside that column's width.
 */
export function scatterPlacements(
  layer: ResolvedSceneBackgroundScatterLayer,
  width: number,
  height: number,
  obstacles: readonly ScatterPlacement[] = [],
): ScatterPlacement[] {
  if (layer.items.length === 0 || width <= 0 || height <= 0) return [];
  const count = Math.round(
    clamp(layer.count, 0, SCENE_EFFECT_LIMITS.scatter.count[1]),
  );
  if (count === 0) return [];
  const random = createMulberry32(layer.seed);
  const v = directionVector(layer.direction);
  const moving = layer.speedPxPerSec > 0 && (v.x !== 0 || v.y !== 0);
  const margin = layer.maxSize;
  const top = Math.min(layer.regionTop, layer.regionBottom) * height;
  const bottom = Math.max(layer.regionTop, layer.regionBottom) * height;
  // Half the track along the motion, and half the span across it.
  const across = { x: -v.y, y: v.x };
  const halfTrack =
    (Math.abs(v.x) * width + Math.abs(v.y) * height) / 2 + margin;
  const halfSpan =
    (Math.abs(across.x) * width + Math.abs(across.y) * height) / 2 + margin;
  const travel =
    v.y === 0
      ? width + 2 * margin
      : v.x === 0
        ? height + 2 * margin
        : 2 * halfTrack;
  const durationSec = travel / Math.max(layer.speedPxPerSec, 1e-3);

  // Each item's look first, so placement can use the sizes.
  const looks = Array.from({ length: count }, (_, index) => {
    const size = lerp(layer.minSize, layer.maxSize, random());
    const rotationDeg = lerp(
      layer.minRotationDeg,
      layer.maxRotationDeg,
      random(),
    );
    const opacity = clamp(
      lerp(layer.minOpacity, layer.maxOpacity, random()),
      0,
      1,
    );
    const spinRate = lerp(
      layer.minSpinDegPerSec,
      layer.maxSpinDegPerSec,
      random(),
    );
    const spin =
      spinRate > 0
        ? {
            durationSec: 360 / spinRate,
            reverse: layer.alternateSpin && index % 2 === 1,
            delaySec: -random() * (360 / spinRate),
          }
        : null;
    let pulse: ScatterPlacement["pulse"] = null;
    if (layer.pulse !== "none") {
      const period = PULSE_PERIOD_SEC[layer.pulse] * lerp(0.85, 1.25, random());
      pulse = {
        name: layer.pulse,
        durationSec: period,
        delaySec: -random() * period,
      };
    }
    return { size, rotationDeg, opacity, spin, pulse };
  });
  const sizes = looks.map((look) => look.size);

  // The item's centre: where a still item rests, or where a drifter's track
  // starts (upstream, off-screen).
  let centres: { x: number; y: number }[];
  let phases: number[] = [];
  if (!moving) {
    centres = stillCentres(
      sizes,
      { width, top, bottom },
      layer.keepFaceClear
        ? {
            left: FACE_COLUMN.left * width,
            right: FACE_COLUMN.right * width,
            bottom: FACE_COLUMN.bottom * height,
          }
        : null,
      obstacles
        .filter((other) => other.drift === null)
        .map((other) => ({
          x: other.x + other.size / 2,
          y: other.y + other.size / 2,
          size: other.size,
        })),
      random,
    );
  } else {
    // The span across the motion that the lanes divide.
    const spans: Span[] =
      v.y === 0
        ? [{ start: top, length: bottom - top }]
        : v.x === 0
          ? layer.keepFaceClear
            ? cutSpans(
                [{ start: 0, length: width }],
                FACE_COLUMN.left * width,
                FACE_COLUMN.right * width,
              )
            : [{ start: 0, length: width }]
          : [{ start: -halfSpan, length: 2 * halfSpan }];
    const slots = driftSlots(
      laneCells(spans, count, layer.maxSize),
      sizes,
      layer.maxSize,
      travel,
      random,
    );
    phases = slots.map((slot) => slot.phase);
    centres = slots.map(({ across: offset }) =>
      v.y === 0
        ? { x: v.x > 0 ? -margin : width + margin, y: offset }
        : v.x === 0
          ? { x: offset, y: v.y > 0 ? -margin : height + margin }
          : {
              x: width / 2 + across.x * offset - v.x * halfTrack,
              y: height / 2 + across.y * offset - v.y * halfTrack,
            },
    );
  }

  return looks.map((look, index) => ({
    key: `${index}`,
    item: layer.items[index % layer.items.length],
    x: centres[index].x - look.size / 2,
    y: centres[index].y - look.size / 2,
    size: look.size,
    rotationDeg: look.rotationDeg,
    opacity: look.opacity,
    drift: moving
      ? {
          x: v.x * travel,
          y: v.y * travel,
          durationSec,
          delaySec: -phases[index] * durationSec,
        }
      : null,
    spin: look.spin,
    pulse: look.pulse,
  }));
}

/**
 * Place every scatter layer of a Scene together, in order: each layer's
 * still items stay clear of the still items of the enabled layers before it.
 * A disabled layer places nothing and is not avoided.
 */
export function sceneScatterPlacements(
  layers: readonly ResolvedSceneBackgroundScatterLayer[],
  width: number,
  height: number,
): ScatterPlacement[][] {
  const still: ScatterPlacement[] = [];
  return layers.map((layer) => {
    if (!layer.enabled) return [];
    const placements = scatterPlacements(layer, width, height, still);
    still.push(...placements.filter((placement) => !placement.drift));
    return placements;
  });
}
