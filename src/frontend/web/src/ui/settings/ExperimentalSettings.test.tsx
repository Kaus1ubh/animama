import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PyModelAssetState } from "@animama/runtime-contracts/api-types";

import type { FeaturePackStatus } from "../../../../shared/desktop-runtime";
import {
  ParakeetWebgpuAssetDownload,
  ParakeetWebgpuDetails,
  ParakeetWebgpuDownload,
} from "./ExperimentalSettings";

const detailsState = vi.hoisted(() => ({ assets: [] as PyModelAssetState[] }));

vi.mock("@/hooks/useDesktopFeaturePacks", () => ({
  useDesktopFeaturePacks: () => ({
    available: false,
    packs: [],
    pending: null,
    run: vi.fn(),
  }),
}));
vi.mock("@/lib/speech/client-parakeet/assets", () => ({
  CLIENT_PARAKEET_WEBGPU_ENCODER: { source: "model-asset" },
  PARAKEET_WEBGPU_ENCODER_ASSET_ID: "parakeet-tdt-0.6b-v2-webgpu-encoder",
}));
vi.mock("@/lib/speech/client-parakeet/client", () => ({
  getLastClientParakeetBackendState: () => null,
  getParakeetWebgpuStatus: vi.fn(),
}));
vi.mock("@/platform/RuntimePlatformProvider", () => ({
  useRuntimePlatform: () => ({ kind: "web", isDesktop: false }),
}));
vi.mock("@/query/hooks/useModelAssets", () => ({
  useModelAssets: () => ({
    data: { assets: detailsState.assets, free_bytes: 40 * 1024 ** 3 },
    isPending: false,
  }),
}));
vi.mock("@/query/mutations/useModelAssetActions", () => ({
  useModelAssetAction: () => ({
    isPending: false,
    isError: false,
    mutate: vi.fn(),
  }),
}));

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

const GIB = 1024 ** 3;
const encoder: PyModelAssetState = {
  id: "parakeet-tdt-0.6b-v2-webgpu-encoder",
  status: "not_installed",
  size_bytes: 1.2 * GIB,
  required_free_bytes: 1.3 * GIB,
  media_type: "application/octet-stream",
  license_ref: "CC-BY-4.0",
};

function renderAsset(
  props: Partial<Parameters<typeof ParakeetWebgpuAssetDownload>[0]> = {},
) {
  return renderToStaticMarkup(
    <ParakeetWebgpuAssetDownload
      status="model_missing"
      asset={encoder}
      freeBytes={40 * GIB}
      pending={false}
      prompted={false}
      onInstall={vi.fn()}
      onCancel={vi.fn()}
      onRemove={vi.fn()}
      {...props}
    />,
  );
}

describe("self-host GPU speech encoder download", () => {
  it("offers the download with its size and free space once an adapter exists", () => {
    const html = renderAsset();
    expect(html).toContain("1.2 GB download · 40 GB free for downloads");
    expect(html).toMatch(
      /<button(?![^>]*disabled="")[^>]*>.*Download GPU encoder<\/button>/su,
    );
    expect(html).toContain("Model attribution");
    expect(html).not.toContain("reloads the app");
  });

  it("never offers it without WebGPU, before probing, or without the asset", () => {
    expect(renderAsset({ status: "unsupported" })).toBe("");
    expect(renderAsset({ status: null })).toBe("");
    expect(renderAsset({ asset: undefined })).toBe("");
  });

  it("refuses to start without enough free space", () => {
    const html = renderAsset({ freeBytes: 1 * GIB });
    expect(html).toContain("Not enough free space");
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*>.*Download GPU encoder/su,
    );
  });

  it("shows progress and cancel while downloading", () => {
    const html = renderAsset({
      asset: {
        ...encoder,
        status: "downloading",
        bytes_downloaded: 0.3 * GIB,
        total_bytes: 1.2 * GIB,
      },
    });
    expect(html).toContain('value="0.25"');
    expect(html).toContain("Cancel");
    expect(html).not.toContain("Download GPU encoder");
  });

  it("explains a failure and offers retry", () => {
    const html = renderAsset({
      asset: { ...encoder, status: "failed", reason: "asset_hash_invalid" },
    });
    expect(html).toContain("did not match its checksum");
    expect(html).toContain("Retry download");
  });

  it("offers removal once installed, even without a WebGPU adapter", () => {
    const installed = { ...encoder, status: "installed" as const };
    for (const status of ["available", "unsupported"] as const) {
      const html = renderAsset({ status, asset: installed });
      expect(html).toContain("Remove GPU encoder");
      expect(html).not.toContain("Download GPU encoder");
      expect(html).not.toContain("free for downloads");
    }
  });

  it("prompts for the download and shows request errors", () => {
    const html = renderAsset({
      prompted: true,
      error: "The encoder change could not finish. Retry in a moment.",
    });
    expect(html).toContain(
      "Download the GPU speech encoder to use this setting.",
    );
    expect(html).toContain('role="alert"');
  });
});

describe("GPU encoder management when another STT provider is selected", () => {
  beforeEach(() => {
    detailsState.assets = [];
  });

  // SSR leaves the capability probe pending, so recovery cannot depend on it.
  const renderDetails = () =>
    renderToStaticMarkup(<ParakeetWebgpuDetails selected={false} />);

  it("hides details when there is no managed encoder", () => {
    expect(renderDetails()).toBe("");
    detailsState.assets = [encoder];
    expect(renderDetails()).toBe("");
  });

  it("keeps installed encoder removal reachable before the capability probe", () => {
    detailsState.assets = [{ ...encoder, status: "installed" }];
    const html = renderDetails();
    expect(html).toContain("Remove GPU encoder");
    expect(html).not.toContain("Download GPU encoder");
  });

  it("keeps download progress and cancellation reachable before the probe", () => {
    detailsState.assets = [
      {
        ...encoder,
        status: "downloading",
        bytes_downloaded: 0.3 * GIB,
        total_bytes: 1.2 * GIB,
      },
    ];
    const html = renderDetails();
    expect(html).toContain('value="0.25"');
    expect(html).toContain("Cancel");
    expect(html).not.toContain("Download GPU encoder");
  });

  it("keeps a failed download retry reachable before the probe", () => {
    detailsState.assets = [
      { ...encoder, status: "failed", reason: "asset_hash_invalid" },
    ];
    const html = renderDetails();
    expect(html).toContain("Retry download");
    expect(html).toContain("did not match its checksum");
  });
});
