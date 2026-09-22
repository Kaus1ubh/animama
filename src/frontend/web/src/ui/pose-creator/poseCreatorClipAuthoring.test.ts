import { describe, expect, it } from "vitest";

import {
  createDefaultPoseCreatorClipDraft,
  createPoseCreatorClipDraftFromAnimaPoseClip,
  buildPoseCreatorClipForExport,
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

describe("standalone clip hydration", () => {
  it("retains omitted base across referenced and baked export despite a caller fallback", () => {
    const input = {
      schema: "animaPoseClip/1.0",
      id: "copied",
      name: "Copied",
      duration: 1,
      poses: { first: { expressions: { happy: 0.5 } } },
      poseKeyframes: [{ time: 0, pose: "first" }],
    };
    const draft = createPoseCreatorClipDraftFromAnimaPoseClip(input, {
      fallbackBasePose: "relaxedRest",
    });
    expect(draft.basePose).toBe("");
    expect(validatePoseCreatorClipDraft(draft)).toEqual([]);
    for (const mode of ["referenced", "baked"] as const) {
      const exported = buildPoseCreatorClipForExport(draft, {
        mode,
        resolvePose: () => {
          throw new Error("No external pose should be needed");
        },
      });
      expect(exported?.basePose).toBeUndefined();
      expect(exported?.poses).toEqual(input.poses);
    }
  });
});
