import { describe, expect, it } from "vitest";
import {
  createUniqueContentBranchName,
  createUniqueContentName,
} from "./uniqueContentName";

describe("automatic content names", () => {
  it.each(["New Pose", "New Reaction"])(
    "allocates %s and the first available suffix",
    (base) => {
      expect(createUniqueContentName(base, [])).toBe(base);
      expect(
        createUniqueContentName(base, [
          base.toLowerCase(),
          `${base} 1`,
          `${base} 3`,
        ]),
      ).toBe(`${base} 2`);
    },
  );
  it("branches without parentheses and continues existing numbering", () => {
    expect(createUniqueContentBranchName("Wave", ["Wave", "wave 1"])).toBe(
      "Wave 2",
    );
    expect(createUniqueContentBranchName("Wave 2", ["Wave 3"])).toBe("Wave 4");
    expect(createUniqueContentBranchName("Wave (2)", [])).toBe("Wave 3");
  });
});
