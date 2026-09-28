import { createElement, type ReactNode } from "react";
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
    state: {
      status: "ready",
      firstRunComplete: false,
      principalId: "test-owner",
    },
    completeOnboarding: fixture.completeOnboarding,
  }),
}));
vi.mock("@/ui/settings/VoiceDownloads", () => ({
  VoiceDownloads: () =>
    createElement("button", { type: "button" }, "Download speech recognition"),
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
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: ({
    to,
    children,
    className,
  }: {
    to: string;
    children: ReactNode;
    className?: string;
  }) => createElement("a", { href: to, className }, children),
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

  it("requires a name and explicit age confirmation while offering direct optional downloads", () => {
    const html = renderToStaticMarkup(createElement(Route.options.component!));
    expect(html).toMatch(/<input[^>]*id="local-display-name"[^>]*required=""/u);
    expect(html).toMatch(
      /<button[^>]*type="submit"[^>]*disabled=""[^>]*>Continue<\/button>/u,
    );
    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain("checked=");
    expect(html).toContain("I am 18 or older");
    expect(html).not.toContain(">Skip<");
    expect(html).toContain("Download speech recognition");
    expect(html).toContain("You can continue during downloads");
    expect(html).not.toContain("Install offline speech recognition");
    expect(fixture.run).not.toHaveBeenCalled();
    expect(fixture.completeOnboarding).not.toHaveBeenCalled();
  });

  it("requires the 18+ confirmation and states the AI and minors notices", () => {
    const html = renderToStaticMarkup(createElement(Route.options.component!));
    expect(html).toContain("Animas are AI companions, not people.");
    expect(html).toContain("may not be suitable for some minors");
    expect(html).toMatch(
      /<input[^>]*type="checkbox"[^>]*name="adult-confirmed"/u,
    );
    expect(html).not.toMatch(/professional help/iu);
    expect(html).toContain('href="/safety"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Continue<\/button>/u);
  });
});
