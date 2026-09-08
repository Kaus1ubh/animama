import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateStatus } from "../../../../shared/desktop-runtime";
import { DesktopUpdatesPanel } from "./DesktopUpdatesPanel";

const fixture = vi.hoisted(() => ({
  status: { state: "idle" } as UpdateStatus,
  pending: false,
  error: false,
  run: vi.fn(),
}));
vi.mock("@/hooks/useDesktopUpdates", () => ({
  useDesktopUpdates: () => fixture,
}));
beforeEach(() => {
  fixture.status = { state: "idle" };
  fixture.run.mockClear();
});
describe("desktop update consent", () => {
  it("hides unavailable updater controls and quiet startup checks", () => {
    fixture.status = { state: "unavailable" };
    expect(renderToStaticMarkup(<DesktopUpdatesPanel />)).toBe("");
    fixture.status = { state: "checking" };
    expect(renderToStaticMarkup(<DesktopUpdatesPanel notice />)).toBe("");
  });
  it("shows an available download without starting it and a separate restart after download", () => {
    fixture.status = {
      state: "available",
      version: "0.2.0",
      downloadBytes: 1000,
      minimumFreeBytes: 2000,
    };
    let html = renderToStaticMarkup(<DesktopUpdatesPanel notice />);
    expect(html).toContain("Download update");
    expect(html).toContain("Later");
    expect(html).not.toContain("Restart to install");
    expect(fixture.run).not.toHaveBeenCalled();
    fixture.status = { ...fixture.status, state: "downloaded" };
    html = renderToStaticMarkup(<DesktopUpdatesPanel />);
    expect(html).toContain("Restart to install");
    expect(html).not.toContain("Download update");
  });
  it("explains a blocked referenced-content upgrade and keeps check failures out of the startup notice", () => {
    fixture.status = {
      state: "error",
      code: "update_pack_references_blocked",
      retry: "download",
    };
    expect(renderToStaticMarkup(<DesktopUpdatesPanel />)).toContain(
      "referenced Expanded Included content",
    );
    fixture.status = {
      state: "error",
      code: "update_check_failed",
      retry: "check",
    };
    expect(renderToStaticMarkup(<DesktopUpdatesPanel notice />)).toBe("");
  });
});
