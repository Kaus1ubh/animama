import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeaturePackStatus } from "../../../../shared/desktop-runtime";
import { DesktopFeaturePacksPanel } from "./DesktopFeaturePacksPanel";

const fixture = vi.hoisted(() => ({
  available: true,
  packs: [] as FeaturePackStatus[],
  pending: null,
  error: null,
  run: vi.fn(),
}));
vi.mock("@/hooks/useDesktopFeaturePacks", () => ({
  useDesktopFeaturePacks: () => fixture,
}));

beforeEach(() => {
  fixture.available = true;
  fixture.packs = [
    {
      id: "expanded-included-content",
      state: "not_installed",
      available: false,
    },
  ];
});

describe("optional feature pack controls", () => {
  it("does not offer desktop installation in the external web runtime", () => {
    fixture.available = false;
    expect(renderToStaticMarkup(<DesktopFeaturePacksPanel />)).toBe("");
  });
  it("keeps a retained pack the catalog no longer offers without inventing sizes or enabling Install", () => {
    fixture.packs = [
      {
        id: "expanded-included-content",
        state: "update_available",
        available: false,
        hasInstalledFiles: true,
      },
    ];
    const html = renderToStaticMarkup(<DesktopFeaturePacksPanel />);
    expect(html).toContain("No compatible released pack");
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*>Install compatible version<\/button>/u,
    );
    expect(html).toContain(">Remove</button>");
    expect(fixture.run).not.toHaveBeenCalled();
  });
  it("omits unreleased packs from the general Settings catalog", () => {
    fixture.packs = [
      {
        id: "expanded-included-content",
        state: "not_installed",
        available: false,
      },
    ];
    expect(renderToStaticMarkup(<DesktopFeaturePacksPanel />)).toBe("");
  });
  it("lists only the remaining pack, never speech recognition or document processing", () => {
    fixture.packs = [
      {
        id: "expanded-included-content",
        state: "not_installed",
        available: true,
      },
    ];
    const html = renderToStaticMarkup(<DesktopFeaturePacksPanel />);
    expect(html).toContain("Expanded Included content");
    expect(html).not.toMatch(/speech|document/iu);
  });
  it("keeps an active pack's removal refusal from offering Install", () => {
    fixture.packs = [
      {
        id: "expanded-included-content",
        state: "failed",
        available: true,
        version: "0.1.0",
        activeVersion: "0.1.0",
        hasInstalledFiles: true,
        error: "pack_in_use",
        blockers: [
          {
            kind: "preview_lease",
            id: "preview-1",
            label: "Content preview open",
          },
        ],
      },
    ];
    const html = renderToStaticMarkup(<DesktopFeaturePacksPanel />);
    expect(html).toContain("Content preview open");
    expect(html).toContain("Close content previews");
    expect(html).not.toMatch(/document/iu);
    expect(html).not.toContain(">Install<");
  });
  it("shows bounded progress and cancellation for a catalog download", () => {
    fixture.packs = [
      {
        id: "expanded-included-content",
        state: "downloading",
        available: true,
        downloadBytes: 1024,
        installedBytes: 4096,
        minimumFreeBytes: 8192,
        progress: 0.5,
      },
    ];
    const html = renderToStaticMarkup(<DesktopFeaturePacksPanel />);
    expect(html).toContain('value="0.5"');
    expect(html).toContain(">Cancel</button>");
    expect(html).toContain(`${(1024).toLocaleString()} bytes download`);
  });
  it("shows affected content and retains removal for a failed but installed pack", () => {
    fixture.packs = [
      {
        id: "expanded-included-content",
        state: "failed",
        available: false,
        hasInstalledFiles: true,
        error: "pack_in_use",
        blockers: [{ kind: "anima_loadout", id: "fixture", label: "My Anima" }],
      },
    ];
    const html = renderToStaticMarkup(<DesktopFeaturePacksPanel />);
    expect(html).toContain("My Anima");
    expect(html).toContain(">Remove</button>");
  });
});
