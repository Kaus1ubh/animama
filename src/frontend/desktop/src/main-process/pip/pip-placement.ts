import { atomicWrite, readSmallJsonFile } from "../runtime/atomic-file.js";

/**
 * Where the owner last left the PiP window on this machine: the display it
 * was on, its top-left corner in screen coordinates and its size scale. Screen
 * coordinates only mean something for this machine's displays, so placement is
 * saved in the desktop profile rather than in App settings.
 */
export type PipPlacement = {
  displayId: number;
  x: number;
  y: number;
  sizeScale: number;
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

/** Version of the placement file; any other content is ignored. */
export const PIP_PLACEMENT_VERSION = 1;
const MAX_PLACEMENT_BYTES = 1024;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Electron window bounds and display ids are whole numbers. */
function isInteger(value: unknown): value is number {
  return Number.isInteger(value);
}

/**
 * The saved placement, or `null` when the file is missing or is not a
 * current-version placement. Invalid content is only ignored here; the next
 * move replaces it.
 */
export function readPipPlacement(file: string): PipPlacement | null {
  const saved = readSmallJsonFile(file, MAX_PLACEMENT_BYTES);
  if (!saved || typeof saved !== "object") return null;
  const { version, displayId, x, y, sizeScale } = saved as Record<
    string,
    unknown
  >;
  if (
    version !== PIP_PLACEMENT_VERSION ||
    !isInteger(displayId) ||
    !isInteger(x) ||
    !isInteger(y) ||
    !isFiniteNumber(sizeScale)
  ) {
    return null;
  }
  return { displayId, x, y, sizeScale };
}

/** Save the placement atomically in the private profile directory. */
export function writePipPlacement(file: string, placement: PipPlacement): void {
  atomicWrite(
    file,
    `${JSON.stringify({ version: PIP_PLACEMENT_VERSION, ...placement })}\n`,
  );
}

/** Move `bounds` the least distance that keeps it inside `area`. */
function keepInside(bounds: PipRect, area: PipRect): PipRect {
  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, value));
  return {
    ...bounds,
    x: clamp(bounds.x, area.x, area.x + area.width - bounds.width),
    y: clamp(bounds.y, area.y, area.y + area.height - bounds.height),
  };
}

/**
 * The saved position at `size`, moved back inside its display's work area if
 * that area has since shrunk; `null` when that display is no longer connected.
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
