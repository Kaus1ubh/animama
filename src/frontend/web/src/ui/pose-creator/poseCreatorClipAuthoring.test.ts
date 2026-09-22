import { describe, expect, it } from "vitest";

import {
  createDefaultPoseCreatorClipDraft,
  createUniquePoseCreatorClipName,
  validatePoseCreatorClipDraft,
} from "./poseCreatorClipAuthoring";

describe("createUniquePoseCreatorClipName", () => {
  it("allows the first authored pose after zero when Start base is off", () => {
    const draft = createDefaultPoseCreatorClipDraft("relaxedRest");
    draft.poses = { smile: { expressions: { happy: 0.5 } } };
    draft.keyframes = [{ id: "late", pose: "smile", time: 1 }];
    expect(validatePoseCreatorClipDraft(draft)).toEqual([]);
  });

  it("leaves a new clip name empty so New Clip remains a placeholder", () => {
    const draft = createDefaultPoseCreatorClipDraft("relaxedRest");
    expect(draft.name).toBe("");
    expect(
      draft.validationIssues.some((issue) => issue.target === "name"),
    ).toBe(false);
  });

  it("uses New Clip when the name is available", () => {
    expect(createUniquePoseCreatorClipName(["Wave", "Jump"])).toBe("New Clip");
  });

  it("fills the first case-insensitive numbered gap", () => {
    expect(
      createUniquePoseCreatorClipName([
        "new clip",
        "New Clip (1)",
        "New Clip (3)",
      ]),
    ).toBe("New Clip (2)");
  });
});
