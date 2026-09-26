import { describe, expect, it } from "vitest";

import type { ChatCrisisSupport } from "@animama/product-ui/chat";
import {
  AI_NOTICE_MIN_VISIBLE_MS,
  aiNoticeHideAt,
} from "@/lib/safety/aiNotice";
import {
  INITIAL_COMPANION_SAFETY_STATE,
  companionSafetyReducer,
  quickChatSafetySnapshot,
  type CompanionSafetyAction,
} from "@/lib/safety/safetyState";

const card = (runId: string, code: string): ChatCrisisSupport => ({
  type: "safety.crisis_support",
  run_id: runId,
  source: "moderation",
  resources: { code, label: code, services: [], verified_on: "2026-09-25" },
});

function run(...actions: CompanionSafetyAction[]) {
  return actions.reduce(companionSafetyReducer, INITIAL_COMPANION_SAFETY_STATE);
}

describe("companion safety state", () => {
  it("keeps the crisis card through later turns until dismissed", () => {
    const shown = run(
      { type: "crisis", card: card("run-1", "US") },
      { type: "settle", now: 5 },
    );
    expect(shown.crisis?.run_id).toBe("run-1");
    expect(
      run(
        { type: "crisis", card: card("run-1", "US") },
        { type: "dismiss-crisis" },
      ).crisis,
    ).toBeNull();
  });

  it("replaces the card on a later positive turn", () => {
    const state = run(
      { type: "crisis", card: card("run-1", "US") },
      { type: "crisis", card: card("run-2", "GB") },
    );
    expect(state.crisis?.resources.code).toBe("GB");
  });

  it("keeps the notice visible while its turn runs and schedules hiding once settled", () => {
    const shown = run({
      type: "notice",
      kind: "start",
      animaName: "Annie",
      runId: "run-1",
      now: 1_000,
    });
    expect(shown.noticeVisible).toBe(true);
    expect(aiNoticeHideAt(shown.notice!)).toBeNull();
    const settled = companionSafetyReducer(shown, {
      type: "settle",
      now: 2_000,
    });
    expect(aiNoticeHideAt(settled.notice!)).toBe(
      1_000 + AI_NOTICE_MIN_VISIBLE_MS,
    );
  });

  it("settles when the chat panel unmounts mid-turn (Avatar-only switch)", () => {
    const state = run(
      {
        type: "notice",
        kind: "reminder",
        animaName: "Annie",
        runId: "run-1",
        now: 0,
      },
      { type: "settle", now: 30_000 },
    );
    expect(aiNoticeHideAt(state.notice!)).toBe(30_000);
  });

  it("hides then removes the notice without touching the card", () => {
    const state = run(
      {
        type: "notice",
        kind: "start",
        animaName: null,
        runId: "run-1",
        now: 0,
      },
      { type: "crisis", card: card("run-1", "US") },
      { type: "hide-notice" },
    );
    expect(state.noticeVisible).toBe(false);
    const removed = companionSafetyReducer(state, { type: "remove-notice" });
    expect(removed.notice).toBeNull();
    expect(removed.crisis).not.toBeNull();
  });

  it("mirrors notice copy fields, visibility and the card to Quick Chat", () => {
    const state = run(
      {
        type: "notice",
        kind: "start",
        animaName: "Annie",
        runId: "run-1",
        now: 0,
      },
      { type: "crisis", card: card("run-1", "US") },
    );
    expect(quickChatSafetySnapshot(state)).toEqual({
      notice: { kind: "start", animaName: "Annie" },
      noticeVisible: true,
      crisis: card("run-1", "US"),
    });
  });
});
