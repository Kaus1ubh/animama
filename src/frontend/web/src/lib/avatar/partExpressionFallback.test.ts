import { describe, expect, it } from "vitest";

import { ExpressionController } from "./ExpressionController";
import { loadTestAvatar } from "./motion-authoring/testing/includedAvatars";
import {
  fallbackPresetForPart,
  resolvePartExpressionFallbacks,
} from "./partExpressionFallback";

describe("VRoid part expression fallback", () => {
  it("maps whole-face, brow and eye parts to their mood's preset", () => {
    expect(fallbackPresetForPart("Fcl_EYE_Joy")).toBe("happy");
    expect(fallbackPresetForPart("Fcl_BRW_Fun")).toBe("relaxed");
    expect(fallbackPresetForPart("Fcl_ALL_Sorrow")).toBe("sad");
    expect(fallbackPresetForPart("Fcl_EYE_Surprised")).toBe("surprised");
    expect(fallbackPresetForPart("Fcl_BRW_Angry")).toBe("angry");
    // Mouth parts are shared between moods; other names have no fallback.
    expect(fallbackPresetForPart("Fcl_MTH_Fun")).toBeNull();
    expect(fallbackPresetForPart("Fcl_EYE_Spread")).toBeNull();
    expect(fallbackPresetForPart("happy")).toBeNull();
  });

  it("keeps supported names and uses the largest missing part per preset", () => {
    const presets = new Set(["happy", "sad", "blink"]);
    expect(
      resolvePartExpressionFallbacks(
        {
          Fcl_BRW_Joy: 0.5,
          Fcl_EYE_Joy: 0.75,
          Fcl_MTH_Fun: 0.75,
          Fcl_EYE_Sorrow: 0.3,
          sad: 0.6,
          blink: 0.2,
          Fcl_EYE_Angry: 1,
        },
        (name) => presets.has(name),
      ),
    ).toEqual({ happy: 0.75, sad: 0.6, blink: 0.2 });
  });

  it("leaves parts alone on an Avatar that has them", () => {
    const expressions = { Fcl_EYE_Joy: 0.75, Fcl_MTH_Fun: 0.5 };
    expect(resolvePartExpressionFallbacks(expressions, () => true)).toEqual(
      expressions,
    );
  });

  it("plays a part-keyed Reaction overlay as presets without the parts", async () => {
    const vrm = await loadTestAvatar("AvatarSample_A_1_New");
    const controller = new ExpressionController(vrm);
    const manager = vrm.expressionManager!;
    for (const expression of [...manager.expressions]) {
      if (expression.expressionName.startsWith("Fcl_"))
        manager.unregisterExpression(expression);
    }
    controller.setExpressionOverlay("reaction", {
      Fcl_BRW_Sorrow: 0.8,
      Fcl_EYE_Sorrow: 0.8,
      Fcl_MTH_Sorrow: 0.16,
    });
    controller.update(1 / 60);
    expect(manager.getValue("sad")).toBeCloseTo(0.8, 5);
    controller.dispose();
  });

  it("plays a part-keyed Gesture clip as presets without the parts", async () => {
    const vrm = await loadTestAvatar("AvatarSample_A_1_New");
    const controller = new ExpressionController(vrm);
    const manager = vrm.expressionManager!;
    manager.unregisterExpression(manager.getExpression("Fcl_EYE_Surprised")!);
    manager.unregisterExpression(manager.getExpression("Fcl_BRW_Surprised")!);
    controller.setClipExpressionPrecedence({
      weight: 1,
      expressions: { Fcl_BRW_Surprised: 0.6, Fcl_EYE_Surprised: 0.6 },
    });
    controller.update(1 / 60);
    expect(manager.getValue("surprised")).toBeCloseTo(0.6, 5);
    controller.dispose();
  });
});

describe("Reaction parts over a resting face of the same mood", () => {
  it("only fill the room the whole-face expression leaves", async () => {
    const vrm = await loadTestAvatar("AvatarSample_A_1_New");
    const controller = new ExpressionController(vrm);
    const manager = vrm.expressionManager!;
    const reaction = { Fcl_BRW_Angry: 1, Fcl_EYE_Angry: 0.5, Fcl_EYE_Joy: 1 };

    // Resting rejection 2 is `angry` 0.7: angry parts add at most 0.3.
    controller.applyEmotionPreset("rejection", 2);
    controller.update(1);
    controller.setExpressionOverlay("reaction", reaction);
    controller.update(1 / 60);
    expect(manager.getValue("angry")).toBeCloseTo(0.7, 5);
    expect(manager.getValue("Fcl_BRW_Angry")).toBeCloseTo(0.3, 5);
    expect(manager.getValue("Fcl_EYE_Angry")).toBeCloseTo(0.3, 5);
    // Parts of another mood are not limited.
    expect(manager.getValue("Fcl_EYE_Joy")).toBeCloseTo(1, 5);

    // A full resting expression leaves no room at all.
    controller.applyEmotionPreset("rejection", 3);
    controller.update(1);
    expect(manager.getValue("angry")).toBeCloseTo(1, 5);
    expect(manager.getValue("Fcl_BRW_Angry")).toBe(0);
    controller.dispose();
  });
});
