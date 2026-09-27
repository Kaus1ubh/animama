import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { PocketVoiceAvailability } from "@/lib/speech/pocket/voice-preferences";

import { PocketVoiceDownloadIcon } from "./PocketVoiceDownloadIcon";

function render(availability: PocketVoiceAvailability | null) {
  return renderToStaticMarkup(
    <PocketVoiceDownloadIcon availability={availability} />,
  );
}

const assetId = "pocket-voice-anna";

describe("PocketVoiceDownloadIcon", () => {
  it("shows nothing for core, installed or not-yet-known voices", () => {
    expect(render(null)).toBe("");
    expect(render({ status: "installed", assetId })).toBe("");
    expect(render({ status: "unknown", assetId })).toBe("");
  });

  it("marks a voice that downloads when selected", () => {
    const html = render({ status: "not_installed", assetId });
    expect(html).toContain('data-state="not_installed"');
    expect(html).toContain('aria-label="Downloads when selected"');
    expect(html).not.toContain("text-destructive");
  });

  it("tints a failed download and offers retry on select", () => {
    const html = render({ status: "failed", assetId });
    expect(html).toContain('data-state="failed"');
    expect(html).toContain("text-destructive/70");
    expect(html).toContain('aria-label="Download failed; select to retry"');
  });

  it("shows a progress ring while downloading", () => {
    const html = render({ status: "downloading", assetId, progress: 0.4 });
    expect(html).toContain('data-state="downloading"');
    expect(html).toContain('aria-label="Downloading 40%"');
    expect(
      render({ status: "downloading", assetId, progress: null }),
    ).toContain('aria-label="Downloading 0%"');
  });
});
