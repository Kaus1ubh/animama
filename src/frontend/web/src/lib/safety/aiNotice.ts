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

export function aiNoticeText(notice: {
  kind: AiNoticeKind;
  animaName: string | null | undefined;
}): string {
  const name = notice.animaName?.trim() || "an Anima";
  return notice.kind === "reminder"
    ? `A reminder: ${name} is an AI, not a person.`
    : `You're talking with ${name}, an AI — not a person.`;
}
