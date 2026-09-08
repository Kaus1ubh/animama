import { describe, expect, it } from "vitest";

import type { PyAnimaMusicTrack } from "@/lib/content/catalogTypes";
import { presentMusicTrack } from "./musicTrackPresentation";

const track: PyAnimaMusicTrack = {
  binding_id: "music-1",
  item_id: "builtin:music:study",
  name: "Quiet Study",
  description: null,
  source: { type: "builtin", content_id: "builtin:music:study", version: 1 },
  enabled: true,
  autoplay: true,
  release_defaults: { loop: true, gain: 1 },
  effective_loop: false,
  effective_gain: 0.65,
  loop_override: false,
  gain_override: 0.65,
  duration_seconds: 125,
  codec: "mpeg-layer-iii",
};

describe("presentMusicTrack", () => {
  it("summarizes persistent playback configuration", () => {
    expect(presentMusicTrack(track)).toEqual({
      id: "music-1",
      title: "Quiet Study",
      status: "Autoplay",
      detail: "2:05 · Play once · 65% gain",
    });
  });
});
