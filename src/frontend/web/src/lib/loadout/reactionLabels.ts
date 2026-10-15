import type { TFunction } from "i18next";
import { getI18n } from "react-i18next";

import { storedEmotionLabel } from "@/lib/emotion/presentation";

/** The `animas` translator for the active UI Locale, for callers without a hook. */
function activeAnimasT(): TFunction<"animas"> {
  return getI18n().getFixedT(null, "animas");
}

/**
 * Display name of an intensity: Mild, Moderate, Strong or Intense (1–4), or
 * its number for any other level. Idle cells use the first three.
 */
export function reactionIntensityLabel(
  intensity: number | string,
  t: TFunction<"animas"> = activeAnimasT(),
): string {
  if (String(intensity) === "1") return t("reactions.intensity.mild");
  if (String(intensity) === "2") return t("reactions.intensity.moderate");
  if (String(intensity) === "3") return t("reactions.intensity.strong");
  if (String(intensity) === "4") return t("reactions.intensity.intense");
  return t("reactions.intensity.level", { level: intensity });
}

/** A Reaction cell's name from its emotion and intensity, such as "Joy · Mild". */
export function reactionCellLabel(
  emotion: string,
  intensity: number | string,
  t: TFunction<"animas"> = activeAnimasT(),
): string {
  return t("reactions.cell", {
    emotion: storedEmotionLabel(emotion),
    intensity: reactionIntensityLabel(intensity, t),
  });
}
