import type { TFunction } from "i18next";
import { getI18n } from "react-i18next";

/**
 * App-rendered AI notice timing and copy (spec R2).
 *
 * The backend decides when a notice is due. Once shown, it stays visible until
 * its turn completes or fails, and for at least {@link AI_NOTICE_MIN_VISIBLE_MS}.
 */

export const AI_NOTICE_MIN_VISIBLE_MS = 8_000;

export type AiNoticeKind = "start" | "reminder";

export type AiNoticeState = {
  kind: AiNoticeKind;
  animaName: string | null;
  runId: string;
  shownAt: number;
  settledAt: number | null;
};

export function showAiNotice(
  notice: {
    kind: AiNoticeKind;
    animaName: string | null | undefined;
    runId: string;
  },
  now: number,
): AiNoticeState {
  return {
    kind: notice.kind,
    animaName: notice.animaName ?? null,
    runId: notice.runId,
    shownAt: now,
    settledAt: null,
  };
}

/** Record that the notice's turn completed or failed; the first report wins. */
export function settleAiNotice(
  notice: AiNoticeState,
  now: number,
): AiNoticeState {
  return notice.settledAt === null ? { ...notice, settledAt: now } : notice;
}

/** When the notice should start hiding, or `null` while its turn is running. */
export function aiNoticeHideAt(notice: AiNoticeState): number | null {
  if (notice.settledAt === null) return null;
  return Math.max(notice.shownAt + AI_NOTICE_MIN_VISIBLE_MS, notice.settledAt);
}

/**
 * The notice's wording in the UI Locale. Display only: the backend decides when
 * a notice is due, and this text is never sent to it or to the model (spec R6).
 * Components pass their `t` so the text follows a locale switch.
 */
export function aiNoticeText(
  notice: {
    kind: AiNoticeKind;
    animaName: string | null | undefined;
  },
  t: TFunction<"safety"> = getI18n().getFixedT(null, "safety"),
): string {
  const name = notice.animaName?.trim();
  if (notice.kind === "reminder")
    return name
      ? t("aiNotice.reminder", { name })
      : t("aiNotice.reminderUnnamed");
  return name ? t("aiNotice.start", { name }) : t("aiNotice.startUnnamed");
}
