/** Timeline coordinates exclude the label rail and trailing gutter from time. */
export const TRACK_LABEL_RAIL_PX = 72;
export const TRACK_RIGHT_INSET_PX = 16;
export const RULER_HEIGHT_PX = 32;
export const LANE_HEIGHT_PX = 28;
export const RULER_TICKS = [0, 0.25, 0.5, 0.75, 1] as const;

export function getTimelinePercent(time: number, duration: number): number {
  if (!Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, (time / duration) * 100));
}

export function getTimelineLeftStyle(percent: number, offsetPx = 0): string {
  const offset =
    offsetPx === 0
      ? ""
      : offsetPx > 0
        ? ` + ${offsetPx}px`
        : ` - ${Math.abs(offsetPx)}px`;
  return `calc(${TRACK_LABEL_RAIL_PX}px + (100% - ${TRACK_LABEL_RAIL_PX + TRACK_RIGHT_INSET_PX}px) * ${percent / 100}${offset})`;
}

export function formatTimelineTime(time: number): string {
  if (!Number.isFinite(time)) return "0.00s";
  return `${time.toFixed(2)}s`;
}
