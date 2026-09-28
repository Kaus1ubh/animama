import { TRACKED_EMOTIONS, type TrackedEmotion } from "@/lib/emotion";

export const IDLE_INTENSITIES = ["1", "2", "3"] as const;
export type IdleIntensity = (typeof IDLE_INTENSITIES)[number];
export type IdleStyleCell =
  | { mode: "none" }
  | { mode: "pool"; gestures: string[] };
export type IdleStyleCells = Partial<
  Record<TrackedEmotion, Partial<Record<IdleIntensity, IdleStyleCell>>>
>;

/** Pools contain exact catalog logical refs; absent cells inherit Default. */
export type IdleStyleDocument = {
  defaultPool: string[];
  cells: IdleStyleCells;
};

function validatePool(pool: string[], label: string, allowEmpty: boolean) {
  if (!allowEmpty && pool.length === 0)
    throw new Error(`${label} needs at least one Gesture.`);
  if (pool.some((ref) => !ref.trim()))
    throw new Error(`${label} contains an empty Gesture reference.`);
  if (new Set(pool).size !== pool.length)
    throw new Error(`${label} Gesture references must be unique.`);
}

/** Build the Style descriptor without changing Gesture playback or equipment. */
export function idleStyleSpec(document: IdleStyleDocument) {
  validatePool(document.defaultPool, "Default", true);
  const refs = new Set(document.defaultPool);
  const cells: IdleStyleCells = {};
  for (const emotion of TRACKED_EMOTIONS) {
    for (const intensity of IDLE_INTENSITIES) {
      const cell = document.cells[emotion]?.[intensity];
      if (!cell) continue;
      if (cell.mode === "pool") {
        validatePool(cell.gestures, `${emotion} ${intensity}`, false);
        cell.gestures.forEach((ref) => refs.add(ref));
      }
      cells[emotion] ??= {};
      cells[emotion][intensity] =
        cell.mode === "none"
          ? { mode: "none" }
          : { mode: "pool", gestures: [...cell.gestures] };
    }
  }
  return {
    schema_version: 2 as const,
    default_pool: [...document.defaultPool],
    cells,
    dependencies: [...refs].map((ref) => ({ kind: "gesture" as const, ref })),
    compatibility: { vrm_versions: ["0.x", "1.0"] },
  };
}

/** Read persisted drafts defensively so a stale recovery record cannot alter pools. */
export function readIdleStyleDocument(
  value: unknown,
): IdleStyleDocument | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (
    !Array.isArray(raw.defaultPool) ||
    raw.defaultPool.some((ref) => typeof ref !== "string")
  )
    return null;
  if (!raw.cells || typeof raw.cells !== "object") return null;
  const cells: IdleStyleCells = {};
  for (const emotion of TRACKED_EMOTIONS) {
    const levels = (raw.cells as Record<string, unknown>)[emotion];
    if (!levels || typeof levels !== "object") continue;
    for (const intensity of IDLE_INTENSITIES) {
      const cell = (levels as Record<string, unknown>)[intensity];
      if (!cell || typeof cell !== "object") continue;
      const row = cell as Record<string, unknown>;
      if (row.mode === "none") {
        cells[emotion] ??= {};
        cells[emotion][intensity] = { mode: "none" };
      } else if (
        row.mode === "pool" &&
        Array.isArray(row.gestures) &&
        row.gestures.every((ref) => typeof ref === "string")
      ) {
        cells[emotion] ??= {};
        cells[emotion][intensity] = { mode: "pool", gestures: row.gestures };
      } else return null;
    }
  }
  return { defaultPool: raw.defaultPool as string[], cells };
}

/** Turn structured admission reasons into actionable copy for the Gesture picker. */
export function idleGestureIneligibilityMessage(
  reason: string | null | undefined,
): string {
  const messages: Record<string, string> = {
    idle_speed_invalid:
      "This Gesture needs a positive playback speed before it can idle.",
    idle_repetitions_invalid:
      "This looping Gesture needs a finite repetition count. Edit its playback before adding it.",
    idle_duration_invalid:
      "This Gesture has no positive finite motion duration.",
    idle_lifetime_unsupported:
      "This Gesture lasts for a phase, state or run. Choose a Gesture with a finite timeline.",
    idle_loop_invalid:
      "This Gesture's loop mode is not supported for idle playback.",
    idle_motion_invalid:
      "This Gesture's motion could not be validated. Check its animation or clip in Creator Studio.",
    idle_motion_unavailable:
      "This Gesture's animation is unavailable. Restore the required content first.",
    idle_motion_ambiguous:
      "This Gesture needs exactly one animation or clip file for idle playback.",
  };
  return (
    (reason && messages[reason]) ||
    "This Gesture cannot be used for finite idle playback. Check its content and dependencies in Creator Studio."
  );
}
