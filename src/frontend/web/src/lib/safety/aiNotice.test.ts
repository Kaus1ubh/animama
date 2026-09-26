import { describe, expect, it } from "vitest";

import {
  AI_NOTICE_MIN_VISIBLE_MS,
  aiNoticeHideAt,
  aiNoticeText,
  settleAiNotice,
  showAiNotice,
} from "@/lib/safety/aiNotice";

const T0 = 1_000_000;

describe("AI notice timing", () => {
  it("stays visible while the turn is still running", () => {
    const notice = showAiNotice(
      { kind: "start", animaName: "Annie", runId: "run-1" },
      T0,
    );
    expect(aiNoticeHideAt(notice)).toBeNull();
  });

  it("stays at least the minimum time after a short turn", () => {
    const notice = settleAiNotice(
      showAiNotice({ kind: "start", animaName: "Annie", runId: "run-1" }, T0),
      T0 + 1_500,
    );
    expect(aiNoticeHideAt(notice)).toBe(T0 + AI_NOTICE_MIN_VISIBLE_MS);
  });

  it("stays until a long turn completes", () => {
    const notice = settleAiNotice(
      showAiNotice(
        { kind: "reminder", animaName: "Annie", runId: "run-1" },
        T0,
      ),
      T0 + 20_000,
    );
    expect(aiNoticeHideAt(notice)).toBe(T0 + 20_000);
  });

  it("keeps the first settle time when the turn reports settling twice", () => {
    const shown = showAiNotice(
      { kind: "start", animaName: null, runId: "run-1" },
      T0,
    );
    const settled = settleAiNotice(
      settleAiNotice(shown, T0 + 9_000),
      T0 + 30_000,
    );
    expect(aiNoticeHideAt(settled)).toBe(T0 + 9_000);
  });

  it("has a minimum visible time of eight seconds", () => {
    expect(AI_NOTICE_MIN_VISIBLE_MS).toBe(8_000);
  });
});

describe("AI notice copy", () => {
  it("names the Anima and says it is an AI, not a person", () => {
    expect(aiNoticeText({ kind: "start", animaName: "Annie" })).toBe(
      "You're talking with Annie, an AI — not a person.",
    );
    expect(aiNoticeText({ kind: "reminder", animaName: "Annie" })).toBe(
      "A reminder: Annie is an AI, not a person.",
    );
    expect(aiNoticeText({ kind: "start", animaName: "  " })).toBe(
      "You're talking with an Anima, an AI — not a person.",
    );
  });
});
