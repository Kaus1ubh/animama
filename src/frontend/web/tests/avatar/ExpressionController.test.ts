import { describe, expect, it } from "vitest";
import { ExpressionController } from "@/lib/avatar/ExpressionController";

class MockExpressionManager {
  values = new Map<string, number>();
  expressionMap: Record<string, unknown>;
  private _supported: Set<string>;

  constructor(supported: string[]) {
    this._supported = new Set(supported);
    this.expressionMap = Object.fromEntries(
      supported.map((name) => [name, {}]),
    );
  }

  getExpressionTrackName(name: string): string | null {
    return this._supported.has(name) ? `${name}.track` : null;
  }

  setValue(name: string, value: number): void {
    this.values.set(name, value);
  }

  getValue(name: string): number {
    return this.values.get(name) ?? 0;
  }

  /** A supported name binds something, as a model's own expression does. */
  getExpression(
    name: string,
  ): { expressionName: string; binds: unknown[] } | null {
    return this._supported.has(name)
      ? { expressionName: name, binds: [{}] }
      : null;
  }

  registerExpression(): void {}

  update(): void {}
}

function createController() {
  const expressionManager = new MockExpressionManager([
    "angry",
    "blink",
    "Fcl_MTH_Fun",
    "Fcl_MTH_Joy",
  ]);
  const vrm = {
    expressionManager,
    scene: {
      traverse: () => {},
    },
  };
  return {
    controller: new ExpressionController(vrm as never),
    expressionManager,
  };
}

describe("ExpressionController expression overlays", () => {
  it("holds owner-scoped overlays until they are cleared", () => {
    const { controller, expressionManager } = createController();

    controller.setExpressionOverlay("reaction-1", {
      Fcl_MTH_Fun: 0.55,
    });

    controller.update(0.016);
    expect(expressionManager.getValue("Fcl_MTH_Fun")).toBeCloseTo(0.55, 3);

    controller.update(3);
    expect(expressionManager.getValue("Fcl_MTH_Fun")).toBeCloseTo(0.55, 3);

    controller.clearExpressionOverlay("reaction-1");
    controller.update(0.016);
    expect(expressionManager.getValue("Fcl_MTH_Fun")).toBe(0);
  });

  it("clears stale expression keys when an owner replaces its overlay", () => {
    const { controller, expressionManager } = createController();

    controller.setExpressionOverlay("reaction-1", {
      angry: 0.6,
    });
    controller.update(0.016);
    expect(expressionManager.getValue("angry")).toBeCloseTo(0.6, 3);

    controller.setExpressionOverlay("reaction-1", {
      Fcl_MTH_Fun: 0.5,
    });
    controller.update(0.016);

    expect(expressionManager.getValue("angry")).toBe(0);
    expect(expressionManager.getValue("Fcl_MTH_Fun")).toBeCloseTo(0.5, 3);
  });

  it("adds overlays from multiple owners and clamps the final expression", () => {
    const { controller, expressionManager } = createController();

    controller.setExpressionOverlay("reaction-1", {
      angry: 0.7,
    });
    controller.setExpressionOverlay("reaction-2", {
      angry: 0.6,
    });
    controller.update(0.016);

    expect(expressionManager.getValue("angry")).toBe(1);

    controller.clearExpressionOverlay("reaction-2");
    controller.update(0.016);
    expect(expressionManager.getValue("angry")).toBeCloseTo(0.7, 3);
  });
});

describe("ExpressionController temporary values", () => {
  it("restores live values and manual overrides after success", () => {
    const { controller, expressionManager } = createController();
    expressionManager.setValue("angry", 0.35);
    controller.setValue("Fcl_MTH_Joy", 0.4);

    const result = controller.runWithTemporaryValues({ Fcl_MTH_Joy: 1 }, () => {
      expect(expressionManager.getValue("Fcl_MTH_Joy")).toBe(1);
      expect(expressionManager.getValue("angry")).toBe(0);
      return "captured";
    });

    expect(result).toBe("captured");
    expect(expressionManager.getValue("angry")).toBe(0.35);
    expect(expressionManager.getValue("Fcl_MTH_Joy")).toBe(0.4);
    expect(controller.getManualValue("Fcl_MTH_Joy")).toBe(0.4);
  });

  it("restores expression state when rendering throws", () => {
    const { controller, expressionManager } = createController();
    expressionManager.setValue("angry", 0.6);

    expect(() =>
      controller.runWithTemporaryValues({ Fcl_MTH_Joy: 1 }, () => {
        throw new Error("render failed");
      }),
    ).toThrow("render failed");

    expect(expressionManager.getValue("angry")).toBe(0.6);
    expect(expressionManager.getValue("Fcl_MTH_Joy")).toBe(0);
  });
});

describe("ExpressionController lip-sync segments", () => {
  function createLipSyncController() {
    const expressionManager = new MockExpressionManager([
      "aa",
      "ee",
      "ih",
      "oh",
      "ou",
    ]);
    const vrm = { expressionManager, scene: { traverse: () => {} } };
    const controller = new ExpressionController(vrm as never);
    const clock = { currentTime: 0 };
    controller.setAudioContext(clock as unknown as AudioContext);
    return { controller, expressionManager, clock };
  }

  it("replaces a live segment's frames from a time on", () => {
    const { controller, expressionManager, clock } = createLipSyncController();
    controller.initLipSyncSegment({
      segment_id: "seg",
      run_id: "run",
      duration_seconds: 1,
      format: "vowel5",
    });
    for (const time of [0, 1]) {
      controller.registerLipSyncFrame({
        segment_id: "seg",
        time_sec: time,
        values: [1, 0, 0, 0, 0],
        format: "vowel5",
      });
    }
    controller.onSegmentAudioStarted("seg", 0);

    // The plan improves: from 0.4 s on the mouth says "O", and it runs to 2 s.
    controller.replaceLipSyncFrames(
      "seg",
      0.4,
      [0.4, 2].map((time) => ({
        time_sec: time,
        values: [0, 0, 0, 1, 0],
        format: "vowel5" as const,
      })),
      2,
    );

    clock.currentTime = 0.2;
    controller.update(0.016);
    expect(expressionManager.getValue("aa")).toBeGreaterThan(0.4);
    clock.currentTime = 1.5;
    controller.update(0.016);
    expect(expressionManager.getValue("oh")).toBeGreaterThan(0.9);
    expect(expressionManager.getValue("aa")).toBe(0);
  });
});

describe("ExpressionController unresolved expression names", () => {
  it("lists names clips and overlays ask for that the model lacks, once each", () => {
    const { controller } = createController();
    let notified = 0;
    controller.setUnresolvedExpressionListener(() => {
      notified += 1;
    });

    controller.setClipExpressionPrecedence({
      weight: 1,
      expressions: { angry: 1, surprised: 0.5, Fcl_EYE_Missing: 1 },
    });
    controller.setExpressionOverlay("reaction-1", {
      surprised: 1,
      wink_custom: 0.4,
    });
    controller.setExpressionOverlay("reaction-2", { blink: 1 });

    expect(controller.unresolvedExpressionNames).toEqual([
      "surprised",
      "Fcl_EYE_Missing",
      "wink_custom",
    ]);
    // One notice per call that found a new name.
    expect(notified).toBe(2);
  });

  it("counts a VRoid part as played when its mood preset stands in", () => {
    // A preset-only model: happy, but no VRoid parts.
    const expressionManager = new MockExpressionManager(["happy", "blink"]);
    const controller = new ExpressionController({
      expressionManager,
      scene: { traverse: () => {} },
    } as never);

    controller.setExpressionOverlay("reaction-1", {
      Fcl_BRW_Joy: 1,
      Fcl_EYE_Joy: 0.8,
    });
    controller.setClipExpressionPrecedence({
      weight: 1,
      expressions: { Fcl_EYE_Joy: 1, Fcl_BRW_Angry: 1 },
    });

    // Joy parts play as happy; the angry part has no angry preset to play.
    expect(controller.unresolvedExpressionNames).toEqual(["Fcl_BRW_Angry"]);
  });

  it("forgets the names when disposed", () => {
    const { controller } = createController();
    controller.setExpressionOverlay("reaction-1", { surprised: 1 });
    controller.dispose();
    expect(controller.unresolvedExpressionNames).toEqual([]);
  });
});
