import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PyModelAssetState } from "@animama/runtime-contracts/api-types";
import { VoiceCloningDownload } from "./VoiceCloningDownload";

const asset: PyModelAssetState = {
  id: "pocket-tts-voice-cloning-encoder",
  status: "not_installed",
  size_bytes: 39_768_446,
  required_free_bytes: 39_768_446,
  media_type: "application/octet-stream",
  license_ref: "pocket-tts-voice-cloning",
  files_total: 1,
  files_verified: 0,
};
const props = {
  sampleName: "Narrator.wav",
  error: null,
  busy: false,
  cancelling: false,
  onDownload: vi.fn(),
  onCancelDownload: vi.fn(),
  onClose: vi.fn(),
};

describe("first-use cloning download", () => {
  it("offers a separate sized download, the retained sample and bundled attribution", () => {
    const html = renderToStaticMarkup(
      <VoiceCloningDownload {...props} asset={asset} />,
    );
    expect(html).toContain("38 MB");
    expect(html).toContain("Narrator.wav");
    expect(html).toContain("Download and clone");
    expect(html).toContain("Not now");
    expect(html).toContain("Model attribution");
    expect(props.onDownload).not.toHaveBeenCalled();
  });

  it("distinguishes completed transfer from verified availability and closing from cancellation", () => {
    const html = renderToStaticMarkup(
      <VoiceCloningDownload
        {...props}
        busy
        asset={{
          ...asset,
          status: "downloading",
          total_bytes: asset.size_bytes,
          bytes_downloaded: asset.size_bytes,
        }}
      />,
    );
    expect(html).toContain("Verifying voice cloning");
    expect(html).toContain("Closing keeps the download running");
    expect(html).toContain("Cancel download");
    expect(html).not.toContain("Download and clone");
  });

  it("offers retry if polling failed while a shared download may still be running", () => {
    const html = renderToStaticMarkup(
      <VoiceCloningDownload
        {...props}
        error="Connection interrupted."
        asset={{ ...asset, status: "downloading" }}
      />,
    );
    expect(html).toContain("Connection interrupted.");
    expect(html).toContain("Retry download");
    expect(html).toContain("Cancel download");
  });
});
