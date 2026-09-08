import { describe, expect, it } from "vitest";

import {
  createDefaultPoseCreatorClipDraft,
  createUniquePoseCreatorClipName,
} from "./poseCreatorClipAuthoring";

describe("createUniquePoseCreatorClipName", () => {
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
