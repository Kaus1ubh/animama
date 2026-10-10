import { renderToStaticMarkup } from "@/test/runtime-markup";
import { describe, expect, it } from "vitest";

import { SharingNonPortableItems } from "./SharingPackageDetails";

describe("SharingNonPortableItems", () => {
  it("summarizes built-in effects' licensed sounds in one row", () => {
    const markup = renderToStaticMarkup(
      <SharingNonPortableItems
        items={[
          { name: "Sway", kind: "gesture" },
          { name: "Pop", kind: "sound_effect" },
          { name: "Ding", kind: "sound_effect" },
        ]}
      />,
    );
    expect(markup).toContain("Not included in the file (3)");
    expect(markup).toContain("Sway");
    expect(markup).toContain("2 built-in effect sounds");
    expect(markup).not.toContain("Ding");
  });

  it("names a single omitted sound", () => {
    const markup = renderToStaticMarkup(
      <SharingNonPortableItems
        items={[{ name: "Pop", kind: "sound_effect" }]}
      />,
    );
    expect(markup).toContain("Pop");
  });
});
