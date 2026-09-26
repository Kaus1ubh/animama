import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { FeaturePackStatus } from "../../../../shared/desktop-runtime";
import { ParakeetWebgpuDownload } from "./ExperimentalSettings";

const base: FeaturePackStatus = {
  id: "parakeet-stt",
  state: "installed",
  available: true,
  version: "0.1.0",
  activeVersion: "0.1.0",
  hasInstalledFiles: true,
};
const gpu: FeaturePackStatus = {
  id: "parakeet-stt-webgpu",
  state: "not_installed",
  available: true,
  version: "0.1.0",
  hasInstalledFiles: false,
  downloadBytes: 1_134_137_016,
  installedBytes: 1_238_962_007,
  minimumFreeBytes: 3_679_169_894,
};

function render(
  props: Partial<Parameters<typeof ParakeetWebgpuDownload>[0]> = {},
) {
  return renderToStaticMarkup(
    <ParakeetWebgpuDownload
      status="model_missing"
      gpuPack={gpu}
      basePack={base}
      pending={null}
      prompted={false}
      run={vi.fn()}
      {...props}
    />,
  );
}

describe("GPU speech encoder download control", () => {
  it("offers the download with its size and free space once an adapter exists", () => {
    const html = render();
    expect(html).toContain("1.1 GB download · 3.4 GB free space required");
    expect(html).toMatch(
      /<button(?![^>]*disabled="")[^>]*>.*Download GPU encoder<\/button>/su,
    );
  });

  it("never offers it without WebGPU, before probing, or outside the catalog", () => {
    expect(render({ status: "unsupported" })).toBe("");
    expect(render({ status: null })).toBe("");
    expect(render({ gpuPack: undefined })).toBe("");
    expect(render({ gpuPack: { ...gpu, available: false } })).toBe("");
  });

  it("asks for offline speech recognition first", () => {
    const html = render({
      basePack: { ...base, state: "not_installed", activeVersion: undefined },
    });
    expect(html).toContain(
      "Install offline speech recognition first in General → Optional",
    );
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*>.*Download GPU encoder/su,
    );
  });

  it("shows progress and cancel while downloading", () => {
    const html = render({
      gpuPack: { ...gpu, state: "downloading", progress: 0.25 },
    });
    expect(html).toContain('value="0.25"');
    expect(html).toContain("Cancel");
    expect(html).not.toContain("Download GPU encoder");
  });

  it("offers retry after a failure and removal once installed", () => {
    expect(
      render({
        gpuPack: { ...gpu, state: "failed", error: "pack_download_failed" },
      }),
    ).toContain("Retry download");
    const installed = render({
      status: "available",
      gpuPack: {
        ...gpu,
        state: "installed",
        activeVersion: "0.1.0",
        hasInstalledFiles: true,
      },
    });
    expect(installed).toContain("Remove GPU encoder");
    expect(installed).not.toContain("Download GPU encoder");
    // Retained files stay removable even without a WebGPU adapter.
    expect(
      render({
        status: "unsupported",
        gpuPack: { ...gpu, state: "installed", hasInstalledFiles: true },
      }),
    ).toContain("Remove GPU encoder");
  });

  it("treats an active version as installed after an interrupted removal", () => {
    const html = render({
      status: "available",
      gpuPack: {
        ...gpu,
        state: "failed",
        error: "pack_cancelled",
        activeVersion: "0.1.0",
        hasInstalledFiles: true,
      },
    });
    expect(html).toContain("Remove GPU encoder");
    expect(html).not.toContain("Retry download");
    expect(html).not.toContain("free space required");
  });

  it("names a retained compatible update and shows bridge errors", () => {
    const html = render({
      gpuPack: { ...gpu, state: "update_available", hasInstalledFiles: true },
      error:
        "The pack change could not finish. Review its status below, then retry.",
    });
    expect(html).toContain("Install compatible version");
    expect(html).toContain('role="alert"');
    expect(html).toContain("briefly reloads the app");
  });

  it("prompts for the download when the setting is turned on without it", () => {
    expect(render({ prompted: true })).toContain(
      "Download the GPU speech encoder to use this setting.",
    );
  });
});
