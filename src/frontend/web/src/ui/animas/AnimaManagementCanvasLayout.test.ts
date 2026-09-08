import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const appShellPageSource = new URL("../app/AppShellPage.tsx", import.meta.url);

describe("Anima management Canvas layout", () => {
  it.each(["AnimaDetailsPage.tsx"])(
    "keeps %s full-bleed beneath the application sidebar",
    async (relative) => {
      const source = await readFile(new URL(relative, import.meta.url), "utf8");

      expect(source).toContain('sidebarBehavior="adaptive-canvas"');
      expect(source).toContain(
        "left-[calc(var(--app-shell-sidebar-inset)+1.25rem)]",
      );
      expect(source).toContain(
        "md:left-[calc(var(--app-shell-sidebar-inset)+2rem)]",
      );
      expect(source).not.toContain("contentUnderSidebar");
      expect(source).not.toContain("extendUnderSidebar");
    },
  );

  it("does not retain the obsolete padded-sidebar page mode", async () => {
    const source = await readFile(appShellPageSource, "utf8");

    expect(source).not.toContain("contentUnderSidebar");
    expect(source).not.toContain("extendUnderSidebar");
  });
});
