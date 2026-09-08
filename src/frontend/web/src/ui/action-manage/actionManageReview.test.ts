import { describe, expect, it } from "vitest";
import {
  canConfirmActionManage,
  manageableReviews,
} from "./actionManageReview";

const plan = (action: "add" | "unchanged") => ({
  action,
  plan_digest: "x".repeat(64),
  included_resource_counts: {},
  final_gesture_count: 1,
  warnings: [],
});

describe("action manage review", () => {
  it("keeps valid targets actionable beside a target-local blocker", () => {
    const reviews = [
      { animaId: "a", animaName: "A", plan: plan("add") },
      { animaId: "b", animaName: "B", error: "Target is unavailable" },
    ];
    expect(canConfirmActionManage(reviews)).toBe(true);
    expect(manageableReviews(reviews).map((review) => review.animaId)).toEqual([
      "a",
    ]);
  });

  it("stops when no target has a typed actionable plan", () => {
    expect(
      canConfirmActionManage([
        { animaId: "a", animaName: "A", plan: plan("unchanged") },
        { animaId: "b", animaName: "B", error: "Source is unavailable" },
      ]),
    ).toBe(false);
  });
});
