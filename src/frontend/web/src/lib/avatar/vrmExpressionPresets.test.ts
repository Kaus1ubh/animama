import { describe, expect, it } from "vitest";
import {
  VRMExpression,
  VRMExpressionManager,
  type VRM,
} from "@pixiv/three-vrm";

import { canonicalizeCustomPresetExpressions } from "./vrmExpressionPresets";

function vrmWithExpressions(names: string[]): VRM {
  const expressionManager = new VRMExpressionManager();
  for (const name of names) {
    expressionManager.registerExpression(new VRMExpression(name));
  }
  return { expressionManager } as unknown as VRM;
}

function expressionNames(vrm: VRM): string[] {
  return vrm.expressionManager!.expressions.map((e) => e.expressionName);
}

describe("canonicalizeCustomPresetExpressions", () => {
  it("renames a VRM0 custom Surprised expression to the surprised preset", () => {
    const vrm = vrmWithExpressions(["happy", "Surprised", "Fcl_ALL_Surprised"]);
    const surprised = vrm.expressionManager!.getExpression("Surprised");

    expect(canonicalizeCustomPresetExpressions(vrm)).toEqual({
      Surprised: "surprised",
    });

    const manager = vrm.expressionManager!;
    expect(manager.getExpression("surprised")).toBe(surprised);
    expect(manager.getExpression("Surprised")).toBeNull();
    expect(manager.presetExpressionMap.surprised).toBe(surprised);
    expect(expressionNames(vrm).sort()).toEqual(
      ["Fcl_ALL_Surprised", "happy", "surprised"].sort(),
    );
    manager.setValue("surprised", 0.75);
    expect(manager.getValue("surprised")).toBe(0.75);
  });

  it("keeps a bound preset and its same-named custom expression distinct", () => {
    const vrm = vrmWithExpressions(["surprised", "Surprised"]);

    expect(canonicalizeCustomPresetExpressions(vrm)).toEqual({});
    expect(expressionNames(vrm)).toEqual(["surprised", "Surprised"]);
  });

  it("ignores models without an expression manager", () => {
    expect(canonicalizeCustomPresetExpressions({} as VRM)).toEqual({});
  });
});
