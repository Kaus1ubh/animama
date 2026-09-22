import { describe, expect, it } from "vitest";
import { actionValidationMessages } from "./actionValidationMessages";

const emptyClip = [
  { message: "Add at least one keyframe before exporting a clip." },
];

describe("action validation feedback", () => {
  it("keeps a new empty clip quiet before a save attempt", () => {
    expect(actionValidationMessages(false, [], emptyClip, null)).toEqual([]);
  });
  it("combines document and timeline feedback after save is attempted", () => {
    expect(
      actionValidationMessages(
        true,
        [{ message: "Name is required." }],
        emptyClip,
        null,
      ),
    ).toEqual(["Name is required.", emptyClip[0]!.message]);
  });
  it("clears resolved messages and avoids duplicate feedback", () => {
    expect(actionValidationMessages(true, emptyClip, emptyClip, null)).toEqual([
      emptyClip[0]!.message,
    ]);
    expect(actionValidationMessages(true, [], [], null)).toEqual([]);
  });
  it("retains preview diagnostics at the same feedback boundary", () => {
    const diagnostics = {
      missingPoseRefs: ["base"],
      missingAvatarVFXIds: [],
      missingSceneVFXPresetIds: [],
      missingParticleVFXIds: [],
      missingSFXCueIds: [],
      eventAdapterWarnings: [],
    };
    expect(actionValidationMessages(false, [], [], diagnostics)).toEqual([]);
    expect(actionValidationMessages(true, [], [], diagnostics)).toEqual([
      "Missing poses: base",
    ]);
  });
  it("includes genuine save failures in the same indicator", () => {
    expect(
      actionValidationMessages(true, [], [], null, "Upload failed."),
    ).toEqual(["Upload failed."]);
    expect(
      actionValidationMessages(
        true,
        [{ message: "Upload failed." }],
        [],
        null,
        "Upload failed.",
      ),
    ).toEqual(["Upload failed."]);
  });
});
