import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { Route } from "@/routes/setup";
import { normalizeLocalDisplayName } from "@/lib/user-profile/display-name";

const fixture = vi.hoisted(() => ({
  run: vi.fn(),
  completeOnboarding: vi.fn(),
}));
vi.mock("@web/app/local-runtime/LocalRuntimeProvider", () => ({
  useLocalRuntime: () => ({
    state: { status: "ready", firstRunComplete: false },
    completeOnboarding: fixture.completeOnboarding,
  }),
}));
vi.mock("@/hooks/useDesktopFeaturePacks", () => ({
  useDesktopFeaturePacks: () => ({
    available: true,
    run: fixture.run,
    packs: [
      {
        id: "parakeet-stt",
        state: "not_installed",
        available: true,
        downloadBytes: 1024,
        installedBytes: 4096,
        minimumFreeBytes: 8192,
      },
    ],
  }),
}));
vi.mock("@/ui/settings/DesktopCredentialsPanel", () => ({
  DesktopCredentialsPanel: () => null,
}));

describe("local first-run setup", () => {
  it("normalizes the required name consistently for setup and personalization", () => {
    expect(normalizeLocalDisplayName("  Ada   Lovelace  ")).toBe(
      "Ada Lovelace",
    );
    expect(normalizeLocalDisplayName("x".repeat(80))).toBe("x".repeat(80));
  });

  it.each(["", "   ", "\t\n", "\u00a0", "x".repeat(81)])(
    "rejects an unsavable name: %j",
    (value) => {
      expect(normalizeLocalDisplayName(value)).toBeNull();
    },
  );

  it("requires a name with no Skip action and leaves offline speech unchecked", () => {
    const html = renderToStaticMarkup(createElement(Route.options.component!));
    expect(html).toMatch(/<input[^>]*id="local-display-name"[^>]*required=""/u);
    expect(html).toMatch(
      /<button[^>]*type="submit"[^>]*disabled=""[^>]*>Continue<\/button>/u,
    );
    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain("checked=");
    expect(html).not.toContain(">Skip<");
    expect(html).toContain("Install offline speech recognition");
    expect(fixture.run).not.toHaveBeenCalled();
    expect(fixture.completeOnboarding).not.toHaveBeenCalled();
  });
});
