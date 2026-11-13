import { atomicWrite, readSmallJsonFile } from "../runtime/atomic-file.js";

/**
 * Where the owner last left the PiP window on this machine: the display it
 * was on, its top-left corner in screen coordinates and its size. Screen
 * coordinates only mean something for this machine's displays, so placement is
 * saved in the desktop profile rather than in App settings.
 */
export type PipPlacement = {
  displayId: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PipRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** The part of an Electron `Display` that placement reads. */
export type PipDisplay = {
  id: number;
  workArea: PipRect;
};

/** Version of the placement file this app writes. */
export const PIP_PLACEMENT_VERSION = 2;
/**
 * Version 1 saved a size scale of a 420 × 560 window instead of a size, so it
 * could not keep a shape the owner gave PiP by dragging its edges. It is still
 * read at the size it described.
 */
const VERSION_1_PLACEMENT = 1;
const VERSION_1_FULL_SIZE = { width: 420, height: 560 };
const MAX_PLACEMENT_BYTES = 1024;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Electron window bounds and display ids are whole numbers. */
function isInteger(value: unknown): value is number {
  return Number.isInteger(value);
}

function isPositiveInteger(value: unknown): value is number {
  return isInteger(value) && value > 0;
}

/**
 * The saved placement, or `null` when the file is missing or is not a valid
 * current or version-1 placement. Invalid content is only ignored here; the
 * next move or resize replaces it. The size is as saved; the caller fits it to
 * its own size limits.
 */
export function readPipPlacement(file: string): PipPlacement | null {
  const saved = readSmallJsonFile(file, MAX_PLACEMENT_BYTES);
  if (!saved || typeof saved !== "object") return null;
  const { version, displayId, x, y, width, height, sizeScale } =
    saved as Record<string, unknown>;
  if (!isInteger(displayId) || !isInteger(x) || !isInteger(y)) return null;
  if (
    version === PIP_PLACEMENT_VERSION &&
    isPositiveInteger(width) &&
    isPositiveInteger(height)
  ) {
    return { displayId, x, y, width, height };
  }
  if (
    version === VERSION_1_PLACEMENT &&
    isFiniteNumber(sizeScale) &&
    sizeScale > 0
  ) {
    return {
      displayId,
      x,
      y,
      width: Math.round(VERSION_1_FULL_SIZE.width * sizeScale),
      height: Math.round(VERSION_1_FULL_SIZE.height * sizeScale),
    };
  }
  return null;
}

/** Save the placement atomically in the private profile directory. */
export function writePipPlacement(file: string, placement: PipPlacement): void {
  atomicWrite(
    file,
    `${JSON.stringify({ version: PIP_PLACEMENT_VERSION, ...placement })}\n`,
  );
}

/**
 * Shrink `bounds` to fit `area` if it is larger, then move it the least
 * distance that keeps it inside.
 */
function keepInside(bounds: PipRect, area: PipRect): PipRect {
  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, value));
  const width = Math.min(bounds.width, area.width);
  const height = Math.min(bounds.height, area.height);
  return {
    x: clamp(bounds.x, area.x, area.x + area.width - width),
    y: clamp(bounds.y, area.y, area.y + area.height - height),
    width,
    height,
  };
}

/**
 * The saved position at `size`, kept inside its display's work area if that
 * area has since shrunk; `null` when that display is no longer connected.
 */
export function resolveSavedPipBounds(
  placement: PipPlacement,
  displays: readonly PipDisplay[],
  size: { width: number; height: number },
): PipRect | null {
  const display = displays.find((entry) => entry.id === placement.displayId);
  if (!display) return null;
  return keepInside(
    { x: placement.x, y: placement.y, ...size },
    display.workArea,
  );
}

/** Flush with the bottom-right corner of the work area. */
export function resolveCornerPipBounds(
  workArea: PipRect,
  size: { width: number; height: number },
): PipRect {
  return keepInside(
    {
      x: workArea.x + workArea.width - size.width,
      y: workArea.y + workArea.height - size.height,
      ...size,
    },
    workArea,
  );
}
