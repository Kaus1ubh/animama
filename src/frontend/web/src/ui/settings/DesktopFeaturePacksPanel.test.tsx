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
    { id: "parakeet-stt", state: "not_installed", available: false },
  ];
});

describe("optional feature pack controls", () => {
  it("does not offer desktop installation in the external web runtime", () => {
    fixture.available = false;
    expect(renderToStaticMarkup(<DesktopFeaturePacksPanel />)).toBe("");
  });
  it("shows an unavailable contextual entry without inventing sizes or enabling Install", () => {
    const html = renderToStaticMarkup(
      <DesktopFeaturePacksPanel only="parakeet-stt" />,
    );
    expect(html).toContain("No compatible released pack");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Install<\/button>/u);
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
  it("lists the GPU encoder only for recovery, leaving downloads to the WebGPU setting", () => {
    fixture.packs = [
      { id: "parakeet-stt-webgpu", state: "not_installed", available: true },
    ];
    expect(renderToStaticMarkup(<DesktopFeaturePacksPanel />)).toBe("");
    fixture.packs = [
      {
        id: "parakeet-stt-webgpu",
        state: "update_available",
        available: true,
        hasInstalledFiles: true,
      },
    ];
    expect(renderToStaticMarkup(<DesktopFeaturePacksPanel />)).toContain(
      "GPU speech encoder",
    );
  });
  it("keeps an active pack's removal refusal from offering Install", () => {
    fixture.packs = [
      {
        id: "parakeet-stt",
        state: "failed",
        available: true,
        version: "0.1.0",
        activeVersion: "0.1.0",
        hasInstalledFiles: true,
        error: "pack_dependent_installed",
        blockers: [
          {
            kind: "feature_pack",
            id: "parakeet-stt-webgpu",
            label: "Remove GPU speech encoder first",
          },
        ],
      },
    ];
    const html = renderToStaticMarkup(<DesktopFeaturePacksPanel />);
    expect(html).toContain("Remove GPU speech encoder first");
    expect(html).not.toContain(">Install<");
  });
  it("shows bounded progress and cancellation for a catalog download", () => {
    fixture.packs = [
      {
        id: "parakeet-stt",
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
