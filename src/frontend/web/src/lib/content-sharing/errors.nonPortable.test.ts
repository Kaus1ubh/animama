import { afterEach, describe, expect, it } from "vitest";
import { getI18n } from "react-i18next";
import { SharingError } from "./errors";

afterEach(async () => {
  await getI18n().changeLanguage("en");
});

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

  it("lists the refused items with the locale's separator", async () => {
    await getI18n().changeLanguage("ja");
    const error = new SharingError("package_non_portable", 409, [
      "Sway",
      "Bow",
    ]);
    expect(error.message).toContain("Sway、Bow");
  });
});
