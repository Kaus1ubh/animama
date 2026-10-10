import { getI18n } from "react-i18next";

import { TRACKED_EMOTIONS, type TrackedEmotion } from "@/lib/emotion";
import { emotionLabel } from "@/lib/emotion/presentation";

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
  const t = getI18n().getFixedT(null, "library");
  if (!allowEmpty && pool.length === 0)
    throw new Error(t("content.idleStyle.poolEmpty", { pool: label }));
  if (pool.some((ref) => !ref.trim()))
    throw new Error(t("content.idleStyle.poolBlankReference", { pool: label }));
  if (new Set(pool).size !== pool.length)
    throw new Error(t("content.idleStyle.poolDuplicate", { pool: label }));
}

/** Build the Style descriptor without changing Gesture playback or equipment. */
export function idleStyleSpec(document: IdleStyleDocument) {
  const t = getI18n().getFixedT(null, "library");
  validatePool(document.defaultPool, t("content.idleStyle.defaultPool"), true);
  const refs = new Set(document.defaultPool);
  const cells: IdleStyleCells = {};
  for (const emotion of TRACKED_EMOTIONS) {
    for (const intensity of IDLE_INTENSITIES) {
      const cell = document.cells[emotion]?.[intensity];
      if (!cell) continue;
      if (cell.mode === "pool") {
        validatePool(
          cell.gestures,
          t("content.idleStyle.cellPool", {
            emotion: emotionLabel(emotion),
            intensity,
          }),
          false,
        );
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
  const t = getI18n().getFixedT(null, "library");
  switch (reason) {
    case "idle_speed_invalid":
      return t("content.idleStyle.ineligible.speed");
    case "idle_repetitions_invalid":
      return t("content.idleStyle.ineligible.repetitions");
    case "idle_duration_invalid":
      return t("content.idleStyle.ineligible.duration");
    case "idle_lifetime_unsupported":
      return t("content.idleStyle.ineligible.lifetime");
    case "idle_loop_invalid":
      return t("content.idleStyle.ineligible.loop");
    case "idle_motion_invalid":
      return t("content.idleStyle.ineligible.motionInvalid");
    case "idle_motion_unavailable":
      return t("content.idleStyle.ineligible.motionUnavailable");
    case "idle_motion_ambiguous":
      return t("content.idleStyle.ineligible.motionAmbiguous");
    default:
      return t("content.idleStyle.ineligible.other");
  }
}
