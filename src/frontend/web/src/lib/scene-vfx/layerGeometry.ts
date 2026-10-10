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

/**
 * Place a scatter layer's items in a `width` × `height` view. Positions,
 * sizes, rotations, opacities and motion phases all come from the seed.
 * A still item rests at a random place inside the region. A drifting item
 * crosses the whole view on a track that starts and ends off-screen, at a
 * random place across the motion (inside the region for left and right
 * motion), with its phase spread over the track, so the layer stays evenly
 * filled and nothing appears or vanishes mid-view. `keepFaceClear` keeps
 * still items out of the column behind the head and up and down drifters out
 * of that column's width.
 */
export function scatterPlacements(
  layer: ResolvedSceneBackgroundScatterLayer,
  width: number,
  height: number,
): ScatterPlacement[] {
  if (layer.items.length === 0 || width <= 0 || height <= 0) return [];
  const count = Math.round(
    clamp(layer.count, 0, SCENE_EFFECT_LIMITS.scatter.count[1]),
  );
  const random = createMulberry32(layer.seed);
  const v = directionVector(layer.direction);
  const moving = layer.speedPxPerSec > 0 && (v.x !== 0 || v.y !== 0);
  const margin = layer.maxSize;
  // Half the track along the motion, and half the span across it.
  const across = { x: -v.y, y: v.x };
  const halfTrack =
    (Math.abs(v.x) * width + Math.abs(v.y) * height) / 2 + margin;
  const halfSpan =
    (Math.abs(across.x) * width + Math.abs(across.y) * height) / 2 + margin;
  const inFaceColumn = (x: number, y: number) =>
    x > FACE_COLUMN.left * width &&
    x < FACE_COLUMN.right * width &&
    (v.x === 0 && moving ? true : y < FACE_COLUMN.bottom * height);
  const regionY = () =>
    lerp(layer.regionTop, layer.regionBottom, random()) * height;

  return Array.from({ length: count }, (_, index) => {
    const size = lerp(layer.minSize, layer.maxSize, random());
    // The item's centre: where a still item rests, or where a drifter's
    // track starts (upstream, off-screen).
    let centre = { x: 0, y: 0 };
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (!moving) centre = { x: random() * width, y: regionY() };
      else if (v.y === 0)
        centre = { x: v.x > 0 ? -margin : width + margin, y: regionY() };
      else if (v.x === 0)
        centre = {
          x: random() * width,
          y: v.y > 0 ? -margin : height + margin,
        };
      else {
        const offset = lerp(-halfSpan, halfSpan, random());
        centre = {
          x: width / 2 + across.x * offset - v.x * halfTrack,
          y: height / 2 + across.y * offset - v.y * halfTrack,
        };
      }
      const resting = moving && v.x === 0 ? { x: centre.x, y: 0 } : centre;
      if (!layer.keepFaceClear || !inFaceColumn(resting.x, resting.y)) break;
    }
    const travel =
      v.y === 0
        ? width + 2 * margin
        : v.x === 0
          ? height + 2 * margin
          : 2 * halfTrack;
    const durationSec = travel / Math.max(layer.speedPxPerSec, 1e-3);
    const spinRate = lerp(
      layer.minSpinDegPerSec,
      layer.maxSpinDegPerSec,
      random(),
    );
    const spinSign = layer.alternateSpin && index % 2 ? -1 : 1;
    const pulsePeriod =
      layer.pulse === "none"
        ? 0
        : PULSE_PERIOD_SEC[layer.pulse] * lerp(0.85, 1.25, random());
    return {
      key: `${index}`,
      item: layer.items[index % layer.items.length],
      x: centre.x - size / 2,
      y: centre.y - size / 2,
      size,
      rotationDeg: lerp(layer.minRotationDeg, layer.maxRotationDeg, random()),
      opacity: clamp(lerp(layer.minOpacity, layer.maxOpacity, random()), 0, 1),
      drift: moving
        ? {
            x: v.x * travel,
            y: v.y * travel,
            durationSec,
            delaySec: -random() * durationSec,
          }
        : null,
      spin:
        spinRate > 0
          ? {
              durationSec: 360 / spinRate,
              reverse: spinSign < 0,
              delaySec: -random() * (360 / spinRate),
            }
          : null,
      pulse:
        layer.pulse === "none"
          ? null
          : {
              name: layer.pulse,
              durationSec: pulsePeriod,
              delaySec: -random() * pulsePeriod,
            },
    };
  });
}
