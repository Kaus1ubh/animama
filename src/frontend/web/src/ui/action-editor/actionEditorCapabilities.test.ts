import { describe, expect, it } from "vitest";

import {
  actionEditorCapabilities,
  loadedActionEditorMode,
  newActionEditorMode,
} from "./actionEditorCapabilities";

describe("action editor capabilities", () => {
  it("starts gesture creation in pose mode", () => {
    expect(actionEditorCapabilities("gesture").defaultMode).toBe("pose");
    expect(newActionEditorMode("gesture")).toBe("pose");
    expect(newActionEditorMode("gesture", "")).toBe("pose");
  });

  it("opens a component handoff directly in the Gesture timeline", () => {
    expect(newActionEditorMode("gesture", "imported-avatar-effect")).toBe(
      "clip",
    );
  });

  it("keeps Reaction handoffs in the expression and effect workspace", () => {
    expect(newActionEditorMode("reaction", "imported-avatar-effect")).toBe(
      "reaction",
    );
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
