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
 * Lanes for drifting layers that share `spans` (one layer, or layers moving
 * the same way): each layer gets its own lanes, never shared, since layers
 * can move at different speeds. A layer's part of each span is in
 * proportion to `count × laneSize`; in it, it takes as many lanes of at
 * least `laneSize` as fit, then as few as hold the same number of items each
 * (so its lanes differ by at most one item). Inside each span the layers'
 * lanes are interleaved evenly and widened in proportion to fill it.
 * Returns each layer's lanes in order across the motion.
 */
function sharedLaneCells(
  spans: Span[],
  layers: { count: number; laneSize: number }[],
): Span[][] {
  const totalWeight = sum(layers.map((layer) => layer.count * layer.laneSize));
  const shares = layers.map(({ count, laneSize }) => {
    const fits = spans.map((span) =>
      Math.floor(
        (span.length * count * laneSize) /
          Math.max(totalWeight, 1e-9) /
          Math.max(laneSize, 1e-3),
      ),
    );
    // A layer whose items fit nowhere still gets one (too narrow) lane.
    if (sum(fits) === 0) {
      const longest = spans.reduce(
        (best, span, index) =>
          span.length > spans[best].length ? index : best,
        0,
      );
      fits[longest] = 1;
    }
    const capacity = sum(fits);
    const lanes = Math.ceil(count / Math.ceil(count / capacity));
    const exact = fits.map((fit) => (lanes * fit) / capacity);
    const counts = exact.map(Math.floor);
    exact
      .map((value, index) => ({ index, rest: value - counts[index] }))
      .sort((a, b) => b.rest - a.rest || a.index - b.index)
      .slice(0, lanes - sum(counts))
      .forEach(({ index }) => (counts[index] += 1));
    return counts;
  });
  const cells = layers.map((): Span[] => []);
  spans.forEach((span, spanIndex) => {
    const lanes = layers
      .flatMap(({ laneSize }, layer) => {
        const count = shares[layer][spanIndex];
        return Array.from({ length: count }, (_, lane) => ({
          layer,
          laneSize,
          ideal: (lane + 0.5) / count,
        }));
      })
      .sort((a, b) => a.ideal - b.ideal || a.layer - b.layer);
    const widen =
      span.length / Math.max(sum(lanes.map((lane) => lane.laneSize)), 1e-9);
    let start = span.start;
    for (const { layer, laneSize } of lanes) {
      cells[layer].push({ start, length: laneSize * widen });
      start += laneSize * widen;
    }
  });
  return cells;
}

/** `spans` merged where they overlap or touch, in order. */
function mergeSpans(spans: Span[]): Span[] {
  const merged: Span[] = [];
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.start + last.length)
      last.length = Math.max(
        last.length,
        span.start + span.length - last.start,
      );
    else merged.push({ ...span });
  }
  return merged;
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
 * overlaps, more are drawn and the least-overlapping wins, or, with
 * `stopOnOverlap`, placement gives up and returns null.
 */
function stillCentres(
  sizes: number[],
  area: { width: number; top: number; bottom: number },
  faceColumn: { left: number; right: number; bottom: number } | null,
  obstacles: Disc[],
  random: () => number,
  stopOnOverlap: boolean,
): { x: number; y: number }[] | null {
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
    if (bestScore < 0 && stopOnOverlap) return null;
    centres[index] = best;
    placed.push({ ...best, size });
  }
  return centres;
}

/** How many items a scatter layer draws (none without items). */
const itemCount = (layer: ResolvedSceneBackgroundScatterLayer) =>
  layer.items.length === 0
    ? 0
    : Math.round(clamp(layer.count, 0, SCENE_EFFECT_LIMITS.scatter.count[1]));

/** Whether a scatter layer's items drift. */
function drifts(layer: ResolvedSceneBackgroundScatterLayer): boolean {
  const v = directionVector(layer.direction);
  return layer.speedPxPerSec > 0 && (v.x !== 0 || v.y !== 0);
}

/**
 * The span across the motion that a drifting layer's lanes divide: the
 * region for left and right motion, the view width for up and down (minus
 * the face column with `keepFaceClear`), and the centre offsets that reach
 * the view for diagonals.
 */
function driftSpans(
  layer: ResolvedSceneBackgroundScatterLayer,
  width: number,
  height: number,
): Span[] {
  const v = directionVector(layer.direction);
  if (v.y === 0) {
    const top = Math.min(layer.regionTop, layer.regionBottom) * height;
    const bottom = Math.max(layer.regionTop, layer.regionBottom) * height;
    return [{ start: top, length: bottom - top }];
  }
  if (v.x === 0)
    return layer.keepFaceClear
      ? cutSpans(
          [{ start: 0, length: width }],
          FACE_COLUMN.left * width,
          FACE_COLUMN.right * width,
        )
      : [{ start: 0, length: width }];
  const halfSpan =
    (Math.abs(v.y) * width + Math.abs(v.x) * height) / 2 + layer.maxSize;
  return [{ start: -halfSpan, length: 2 * halfSpan }];
}

/**
 * Lanes for each drifting layer (null for the others). Layers moving the
 * same way whose spans meet are grouped and share the merged span, minus
 * the face column when any of them keeps it clear, so each holds its own
 * lanes and they never collide.
 */
function driftLanes(
  layers: readonly ResolvedSceneBackgroundScatterLayer[],
  width: number,
  height: number,
): (Span[] | null)[] {
  type Group = { direction: string; spans: Span[]; members: number[] };
  let groups: Group[] = [];
  layers.forEach((layer, index) => {
    if (!layer.enabled || !drifts(layer) || itemCount(layer) === 0) return;
    const spans = driftSpans(layer, width, height);
    const meets = (group: Group) =>
      group.direction === layer.direction &&
      group.spans.some((a) =>
        spans.some(
          (b) => a.start < b.start + b.length && b.start < a.start + a.length,
        ),
      );
    const joined = groups.filter(meets);
    groups = groups.filter((group) => !meets(group));
    groups.push({
      direction: layer.direction,
      spans: mergeSpans([...spans, ...joined.flatMap((group) => group.spans)]),
      members: [...joined.flatMap((group) => group.members), index].sort(
        (a, b) => a - b,
      ),
    });
  });
  const lanes: (Span[] | null)[] = layers.map(() => null);
  for (const { spans, members } of groups) {
    const vertical = directionVector(layers[members[0]].direction).x === 0;
    const shared =
      vertical && members.some((index) => layers[index].keepFaceClear)
        ? cutSpans(spans, FACE_COLUMN.left * width, FACE_COLUMN.right * width)
        : spans;
    sharedLaneCells(
      shared,
      members.map((index) => ({
        count: itemCount(layers[index]),
        laneSize: layers[index].maxSize,
      })),
    ).forEach((cells, member) => (lanes[members[member]] = cells));
  }
  return lanes;
}

/**
 * Place one layer's items. A drifting layer runs in `lanes`; a still layer
 * draws its items at `stillScale` of their size and keeps them clear of
 * `obstacles`, or returns null with `stopOnOverlap` when they do not fit.
 */
function placeLayer(
  layer: ResolvedSceneBackgroundScatterLayer,
  width: number,
  height: number,
  {
    lanes = null,
    obstacles = [],
    stillScale = 1,
    stopOnOverlap = false,
  }: {
    lanes?: Span[] | null;
    obstacles?: Disc[];
    stillScale?: number;
    stopOnOverlap?: boolean;
  },
): ScatterPlacement[] | null {
  const count = itemCount(layer);
  if (count === 0) return [];
  const random = createMulberry32(layer.seed);
  const v = directionVector(layer.direction);
  const moving = drifts(layer);
  const margin = layer.maxSize;
  const top = Math.min(layer.regionTop, layer.regionBottom) * height;
  const bottom = Math.max(layer.regionTop, layer.regionBottom) * height;
  // Half the track along the motion, and the direction across it.
  const across = { x: -v.y, y: v.x };
  const halfTrack =
    (Math.abs(v.x) * width + Math.abs(v.y) * height) / 2 + margin;
  const travel =
    v.y === 0
      ? width + 2 * margin
      : v.x === 0
        ? height + 2 * margin
        : 2 * halfTrack;
  const durationSec = travel / Math.max(layer.speedPxPerSec, 1e-3);

  // Each item's look first, so placement can use the sizes.
  const looks = Array.from({ length: count }, (_, index) => {
    const size =
      lerp(layer.minSize, layer.maxSize, random()) * (moving ? 1 : stillScale);
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
    const resting = stillCentres(
      sizes,
      { width, top, bottom },
      layer.keepFaceClear
        ? {
            left: FACE_COLUMN.left * width,
            right: FACE_COLUMN.right * width,
            bottom: FACE_COLUMN.bottom * height,
          }
        : null,
      obstacles,
      random,
      stopOnOverlap,
    );
    if (!resting) return null;
    centres = resting;
  } else {
    const slots = driftSlots(
      lanes ??
        sharedLaneCells(driftSpans(layer, width, height), [
          { count, laneSize: layer.maxSize },
        ])[0],
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

/** The smallest share of their size that still items shrink to. */
const STILL_SCALE_FLOOR = 0.4;
/** Bisection trials between the floor and full size when still items shrink. */
const STILL_FIT_STEPS = 3;

/**
 * Place every scatter layer of a Scene in a `width` × `height` view. Sizes,
 * rotations, opacities, motion and positions all come from each layer's
 * seed, so the same Scene and view always give the same picture. Items
 * count as circles of their size. A disabled layer places nothing.
 *
 * Still items never overlap each other, in a layer or across layers:
 * - each rests wholly inside its region (and the view), spread by seeded
 *   best-candidate placement so gaps to neighbours and to the region's
 *   edges come out even, and clear of the still items of the layers before
 *   it;
 * - when they cannot all fit at full size (a small view), every still item
 *   of the Scene shrinks by one common factor, found by bisection, down to
 *   a floor of 0.4; only a region too crowded even at the floor keeps the
 *   least overlap it can.
 *
 * Drifting items cross the whole view on tracks that start and end
 * off-screen, so nothing appears or vanishes mid-view. They run in equal
 * lanes across the motion, as many as the largest item fits, with each
 * lane's items evenly spaced along the track and neighbouring lanes
 * staggered, so the layer stays evenly filled at every moment. Layers
 * moving the same way whose spans meet interleave separate lanes, so they
 * never collide while the span has room for a lane of each. Items of a
 * drifting layer can overlap only when they cannot fit (too many or too
 * large for the span and track). A drifting
 * item may pass over another layer's still items, and layers moving in
 * different directions may cross.
 *
 * `keepFaceClear` keeps still items' centres out of the column behind the
 * head, and up and down drifters' lanes outside that column's width.
 */
export function sceneScatterPlacements(
  layers: readonly ResolvedSceneBackgroundScatterLayer[],
  width: number,
  height: number,
): ScatterPlacement[][] {
  if (width <= 0 || height <= 0) return layers.map(() => []);
  const lanes = driftLanes(layers, width, height);
  const isStill = (layer: ResolvedSceneBackgroundScatterLayer) =>
    layer.enabled && !drifts(layer);
  /**
   * The still layers at `stillScale`, each clear of the ones before it. A
   * trial (`stopOnOverlap`) gives up at the first overlap and returns null.
   */
  const placeStill = (stillScale: number, stopOnOverlap: boolean) => {
    const placed: Disc[] = [];
    const byLayer: ScatterPlacement[][] = [];
    for (const layer of layers) {
      const items = isStill(layer)
        ? placeLayer(layer, width, height, {
            obstacles: placed,
            stillScale,
            stopOnOverlap,
          })
        : [];
      if (!items) return null;
      placed.push(
        ...items.map((item) => ({
          x: item.x + item.size / 2,
          y: item.y + item.size / 2,
          size: item.size,
        })),
      );
      byLayer.push(items);
    }
    return byLayer;
  };
  // Full size when it fits; else the largest common scale that fits,
  // found by bisection, or the floor's least-overlap placement.
  let still = placeStill(1, true);
  if (!still) {
    let low = STILL_SCALE_FLOOR;
    let high = 1;
    for (let step = 0; step < STILL_FIT_STEPS; step += 1) {
      const middle = (low + high) / 2;
      const attempt = placeStill(middle, true);
      if (attempt) {
        still = attempt;
        low = middle;
      } else high = middle;
    }
    still ??= placeStill(STILL_SCALE_FLOOR, false)!;
  }
  const stillByLayer = still;
  return layers.map((layer, index) =>
    !layer.enabled
      ? []
      : isStill(layer)
        ? stillByLayer[index]
        : placeLayer(layer, width, height, { lanes: lanes[index] })!,
  );
}

/** One scatter layer placed alone (see `sceneScatterPlacements`). */
export function scatterPlacements(
  layer: ResolvedSceneBackgroundScatterLayer,
  width: number,
  height: number,
): ScatterPlacement[] {
  return sceneScatterPlacements([layer], width, height)[0];
}
