import { compareDisplayText } from "@animama/product-ui/i18n";
import { getI18n } from "react-i18next";
import { afterEach, describe, expect, it } from "vitest";

describe("compareDisplayText", () => {
  afterEach(async () => {
    await getI18n().changeLanguage("en");
  });

  it("sorts names in the UI Locale's collation", async () => {
    const names = ["王", "安", "张", "李"];
    await getI18n().changeLanguage("zh-Hans");
    // Pinyin order: an, li, wang, zhang.
    expect([...names].sort(compareDisplayText)).toEqual([
      "安",
      "李",
      "王",
      "张",
    ]);
  });

  it("ignores case and orders numbers by value", () => {
    expect(["b", "A", "Clip 10", "Clip 2"].sort(compareDisplayText)).toEqual([
      "A",
      "b",
      "Clip 2",
      "Clip 10",
    ]);
  });
});
