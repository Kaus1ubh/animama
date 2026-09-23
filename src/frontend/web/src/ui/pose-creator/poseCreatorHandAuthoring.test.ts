import { describe, expect, it } from "vitest";
import { Quaternion, Vector3 } from "three";
import { adjustHandQuaternion } from "./poseCreatorHandAuthoring";
describe("hand adjustments", () => {
  it("curls normalized fingers in corresponding opposite directions", () => {
    const left = adjustHandQuaternion(
      new Quaternion(),
      "left",
      "index",
      "curl",
      30,
    );
    const right = adjustHandQuaternion(
      new Quaternion(),
      "right",
      "index",
      "curl",
      30,
    );
    expect(left.angleTo(new Quaternion())).toBeCloseTo(Math.PI / 6);
    expect(left.z).toBeLessThan(0);
    expect(right.z).toBeGreaterThan(0);
  });
  it("uses a stable captured pose without overwriting other rotations", () => {
    const start = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.4);
    const actual = adjustHandQuaternion(start, "left", "index", "curl", 30);
    const expected = start
      .clone()
      .multiply(
        new Quaternion().setFromAxisAngle(new Vector3(0, 0, -1), Math.PI / 6),
      );
    expect(actual.angleTo(expected)).toBeCloseTo(0);
    expect(
      adjustHandQuaternion(start, "left", "index", "curl", 30).toArray(),
    ).toEqual(actual.toArray());
    expect(start.x).toBeCloseTo(Math.sin(0.2));
  });
});
