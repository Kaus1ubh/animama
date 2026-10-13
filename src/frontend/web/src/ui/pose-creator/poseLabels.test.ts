import { VRMHumanBoneList } from "@pixiv/three-vrm";
import { getI18n } from "react-i18next";
import { afterEach, describe, expect, it } from "vitest";

import { HAND_SEGMENTS } from "@/lib/avatar/poses/anatomy/handPresets";
import {
  beatLabel,
  boneLabel,
  handSegmentLabel,
  sidedHandSegmentLabel,
} from "./poseLabels";

const poseT = () => getI18n().getFixedT(null, "pose");

describe("Pose display labels", () => {
  afterEach(async () => {
    await getI18n().changeLanguage("en");
  });

  it("keeps the English bone and segment names derived from their IDs", () => {
    const t = poseT();
    for (const bone of VRMHumanBoneList)
      expect(boneLabel(t, bone)).toBe(
        bone
          .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
          .replace(/\b\w/g, (letter) => letter.toUpperCase()),
      );
    for (const segment of HAND_SEGMENTS)
      expect(handSegmentLabel(t, segment.id)).toBe(
        `${segment.digit[0].toUpperCase()}${segment.digit.slice(1)} ${segment.segment}`,
      );
    expect(sidedHandSegmentLabel(t, "left", "indexDistal")).toBe(
      "Left index distal",
    );
  });

  it("words persisted beat labels in the UI Locale and keeps owner labels", async () => {
    await getI18n().changeLanguage("ja");
    const t = poseT();
    expect(beatLabel(t, "Base")).toBe(t("beats.base"));
    expect(beatLabel(t, "Base")).not.toBe("Base");
    expect(beatLabel(t, "Raise")).toBe("Raise");
    expect(boneLabel(t, "leftUpperArm")).not.toBe("Left Upper Arm");
  });
});
