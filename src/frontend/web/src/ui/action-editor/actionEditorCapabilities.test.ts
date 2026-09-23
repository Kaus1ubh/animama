import { describe, expect, it } from "vitest";

import {
  actionEditorCapabilities,
  loadedActionEditorMode,
} from "./actionEditorCapabilities";

describe("action editor capabilities", () => {
  it("starts gesture creation in pose mode", () => {
    expect(actionEditorCapabilities("gesture").defaultMode).toBe("pose");
  });

  it("opens existing gestures in clip mode so loading does not edit their poses", () => {
    expect(loadedActionEditorMode("gesture", "anima_clip")).toBe("clip");
    expect(loadedActionEditorMode("gesture", "vrma")).toBe("vrma");
    expect(loadedActionEditorMode("reaction", "anima_clip")).toBe("reaction");
  });

  it("exposes pose and clip authoring only for Gestures", () => {
    const gesture = actionEditorCapabilities("gesture");
    expect(gesture.allowedModes).toContain("pose");
    expect(gesture.allowsHumanoid).toBe(true);
    expect(gesture.cameraProfile).toBe("full-body");
  });

  it("uses a portrait expression/effect workspace for Reactions", () => {
    const reaction = actionEditorCapabilities("reaction");
    expect(reaction.allowedModes).toEqual(["reaction"]);
    expect(reaction.allowsHumanoid).toBe(false);
    expect(reaction.cameraProfile).toBe("portrait");
  });
});
