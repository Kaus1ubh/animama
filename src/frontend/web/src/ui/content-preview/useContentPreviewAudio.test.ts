import { describe, expect, it, vi } from "vitest";

import {
  attemptContentPreviewAudioPlayback,
  stopContentPreviewAudioPlayback,
} from "./useContentPreviewAudio";

describe("content preview audio controls", () => {
  it("reports successful first-click playback", async () => {
    const play = vi.fn().mockResolvedValue(undefined);
    await expect(attemptContentPreviewAudioPlayback({ play })).resolves.toBe(
      "playing",
    );
    expect(play).toHaveBeenCalledOnce();
  });

  it("preserves a manual-play fallback when autoplay is blocked", async () => {
    const play = vi.fn().mockRejectedValue(new DOMException("Blocked"));
    await expect(attemptContentPreviewAudioPlayback({ play })).resolves.toBe(
      "blocked",
    );
  });

  it("stops and rewinds replaced preview audio", () => {
    const audio = { pause: vi.fn(), currentTime: 8 };
    stopContentPreviewAudioPlayback(audio);
    expect(audio.pause).toHaveBeenCalledOnce();
    expect(audio.currentTime).toBe(0);
  });
});
