import { describe, expect, it } from "vitest";
import { SharingError } from "./errors";

describe("non-portable sharing errors", () => {
  it("names the refused items in plain text", () => {
    const error = new SharingError("package_non_portable", 409, [
      "Sway",
      "Bow",
    ]);
    expect(error.items).toEqual(["Sway", "Bow"]);
    expect(error.message).toMatch(/can't be exported or imported/);
    expect(error.message).toMatch(/Sway, Bow\.$/);
  });
});
