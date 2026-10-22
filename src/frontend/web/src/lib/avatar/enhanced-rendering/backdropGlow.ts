import { MathUtils } from "three";

/*
 * The enhanced chat canvas's CSS filter: a soft colour grade plus a glow around
 * the Avatar. A browser filter stands in for colour grading and bloom, which the
 * transparent canvas makes costly in WebGL. The glow follows the backdrop's
 * average colour: a fixed white glow outlines the Avatar like a sticker on dark
 * backdrops, so it fades and takes the backdrop's tint as the backdrop darkens.
 */

/** An sRGB colour, 0–255 per channel. */
export type Rgb = readonly [number, number, number];

/** Slightly brighter, softer and less saturated, in CSS filter order. */
const GRADE = { brightness: 1.04, contrast: 0.92, saturate: 0.88 } as const;

export const CHAT_CANVAS_GRADE = `brightness(${GRADE.brightness}) contrast(${GRADE.contrast}) saturate(${GRADE.saturate})`;

const clampUnit = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Apply {@link CHAT_CANVAS_GRADE} in place to unpremultiplied 8-bit sRGB RGBA
 * pixels, as the browser's CSS filter would: each function in order, clamped,
 * on sRGB values, alpha unchanged. Images that are not drawn through the chat
 * canvas (portrait captures) use this instead of a canvas `filter`, which not
 * every browser supports.
 */
export function applyChatCanvasGrade(pixels: Uint8Array): void {
  // brightness and contrast act per channel, so they fold into one table.
  const toneCurve = new Float32Array(256);
  for (let value = 0; value < 256; value += 1) {
    const bright = clampUnit((value / 255) * GRADE.brightness);
    toneCurve[value] = clampUnit(
      bright * GRADE.contrast + 0.5 - 0.5 * GRADE.contrast,
    );
  }
  // The Filter Effects saturate matrix.
  const s = GRADE.saturate;
  const matrix = [
    [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s],
    [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s],
    [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s],
  ];
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const r = toneCurve[pixels[offset]];
    const g = toneCurve[pixels[offset + 1]];
    const b = toneCurve[pixels[offset + 2]];
    for (let channel = 0; channel < 3; channel += 1) {
      const [mr, mg, mb] = matrix[channel];
      pixels[offset + channel] = Math.round(
        clampUnit(mr * r + mg * g + mb * b) * 255,
      );
    }
  }
}

const GLOW_BLUR_PX = 6;
/** Backdrops at or below this relative luminance get the faintest glow. */
const DARK_LUMINANCE = 0.05;
/** Backdrops at or above this relative luminance get the full white glow. */
const LIGHT_LUMINANCE = 0.45;
const DARK_GLOW_ALPHA = 0.2;
const LIGHT_GLOW_ALPHA = 0.55;
/** How far a dark backdrop's glow colour is lifted toward white. */
const DARK_GLOW_LIFT = 0.3;

const WHITE: Rgb = [255, 255, 255];

function linearChannel(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
function relativeLuminance([r, g, b]: Rgb): number {
  return (
    0.2126 * linearChannel(r) +
    0.7152 * linearChannel(g) +
    0.0722 * linearChannel(b)
  );
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
}

/**
 * The `drop-shadow` glow for a backdrop's average colour: white at 0.55 on
 * light backdrops, a faint lifted tint of the backdrop on dark ones, and none
 * when the backdrop is unknown (transparent, loading or unreadable).
 */
export function backdropGlow(backdrop: Rgb | null): string | null {
  if (!backdrop) return null;
  const light = MathUtils.smoothstep(
    relativeLuminance(backdrop),
    DARK_LUMINANCE,
    LIGHT_LUMINANCE,
  );
  const [r, g, b] = mixRgb(
    mixRgb(backdrop, WHITE, DARK_GLOW_LIFT),
    WHITE,
    light,
  ).map(Math.round);
  const alpha = Math.round(mix(DARK_GLOW_ALPHA, LIGHT_GLOW_ALPHA, light) * 100);
  return `drop-shadow(0 0 ${GLOW_BLUR_PX}px rgba(${r}, ${g}, ${b}, ${alpha / 100}))`;
}

/** The enhanced chat canvas filter for a backdrop's average colour. */
export function chatCanvasFilter(backdrop: Rgb | null): string {
  const glow = backdropGlow(backdrop);
  return glow ? `${CHAT_CANVAS_GRADE} ${glow}` : CHAT_CANVAS_GRADE;
}

/** The opacity-weighted average of RGBA pixels, or null if all are clear. */
export function averageOpaqueColor(pixels: Uint8ClampedArray): Rgb | null {
  let r = 0;
  let g = 0;
  let b = 0;
  let weight = 0;
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    const alpha = pixels[index + 3];
    r += pixels[index] * alpha;
    g += pixels[index + 1] * alpha;
    b += pixels[index + 2] * alpha;
    weight += alpha;
  }
  if (weight === 0) return null;
  return [
    Math.round(r / weight),
    Math.round(g / weight),
    Math.round(b / weight),
  ];
}
