import type { TFunction } from "i18next";

/** Word a Gesture's finite-playback ineligibility reason for the Idle picker. */
export function idleIneligibilityMessage(
  t: TFunction<"animas">,
  reason: string | null | undefined,
): string {
  switch (reason) {
    case "idle_speed_invalid":
      return t("idle.ineligible.speed");
    case "idle_repetitions_invalid":
      return t("idle.ineligible.repetitions");
    case "idle_duration_invalid":
      return t("idle.ineligible.duration");
    case "idle_lifetime_unsupported":
      return t("idle.ineligible.lifetime");
    case "idle_loop_invalid":
      return t("idle.ineligible.loop");
    case "idle_motion_invalid":
      return t("idle.ineligible.motionInvalid");
    case "idle_motion_unavailable":
      return t("idle.ineligible.motionUnavailable");
    case "idle_motion_ambiguous":
      return t("idle.ineligible.motionAmbiguous");
    default:
      return t("idle.ineligible.other");
  }
}
