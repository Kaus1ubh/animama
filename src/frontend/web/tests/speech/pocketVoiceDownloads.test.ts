import { describe, expect, it } from "vitest";

import { POCKET_VOICES } from "../../src/lib/speech/pocket/voice-catalog";
import {
  pocketVoiceAvailability,
  pocketVoiceWorkerUrls,
} from "../../src/lib/speech/pocket/voice-downloads";

const downloadable = POCKET_VOICES.find(
  (voice) => voice.delivery === "download",
)!;
const core = POCKET_VOICES.find((voice) => voice.delivery === "core")!;

describe("pocketVoiceWorkerUrls", () => {
  it("routes every downloadable voice through its model-asset content route", () => {
    const urls = pocketVoiceWorkerUrls();
    expect(urls[downloadable.id]).toBe(
      `/v1/model-assets/${downloadable.assetId}/content`,
    );
    expect(urls[core.id]).toBeUndefined();
    expect(Object.keys(urls)).toHaveLength(
      POCKET_VOICES.filter((voice) => voice.delivery === "download").length,
    );
  });
});

describe("pocketVoiceAvailability", () => {
  it("maps downloader states onto downloadable voices", () => {
    const lookup = pocketVoiceAvailability([
      {
        id: downloadable.assetId!,
        status: "downloading",
        bytes_downloaded: 25,
        total_bytes: 100,
      },
    ]);
    expect(lookup(downloadable.id)).toEqual({
      status: "downloading",
      assetId: downloadable.assetId,
      progress: 0.25,
    });
    expect(lookup(core.id)).toBeNull();
  });

  it("treats an unlisted asset as not installed", () => {
    expect(pocketVoiceAvailability([])(downloadable.id)).toEqual({
      status: "not_installed",
      assetId: downloadable.assetId,
      progress: null,
    });
  });
});
