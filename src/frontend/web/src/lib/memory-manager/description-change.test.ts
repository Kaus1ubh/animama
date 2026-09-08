import { describe, expect, it } from "vitest";

import { memoryDescriptionChange } from "./description-change";

describe("memoryDescriptionChange", () => {
  it("hides unchanged descriptions", () => {
    expect(
      memoryDescriptionChange({
        old_description: "User profile",
        new_description: "User profile",
      }),
    ).toBeNull();
    expect(
      memoryDescriptionChange({
        old_description: null,
        new_description: null,
      }),
    ).toBeNull();
  });

  it("projects set, clear, and replacement changes", () => {
    expect(
      memoryDescriptionChange({
        old_description: null,
        new_description: "User profile",
      }),
    ).toEqual({
      kind: "set",
      oldValue: null,
      newValue: "User profile",
    });
    expect(
      memoryDescriptionChange({
        old_description: "User profile",
        new_description: null,
      }),
    ).toEqual({
      kind: "clear",
      oldValue: "User profile",
      newValue: null,
    });
    expect(
      memoryDescriptionChange({
        old_description: "Profile",
        new_description: "Profile and preferences",
      }),
    ).toEqual({
      kind: "replace",
      oldValue: "Profile",
      newValue: "Profile and preferences",
    });
  });
});
