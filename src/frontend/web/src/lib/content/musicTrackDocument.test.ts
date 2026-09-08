import { describe, expect, it } from "vitest";

import {
  EMPTY_MUSIC_TRACK_DOCUMENT,
  validateMusicTrackDocument,
} from "./musicTrackDocument";

describe("validateMusicTrackDocument", () => {
  it("requires a name and audio file", () => {
    expect(validateMusicTrackDocument(EMPTY_MUSIC_TRACK_DOCUMENT)).toEqual([
      "Name is required.",
      "Choose an audio file.",
    ]);
  });

  it("accepts bounded playback defaults", () => {
    expect(
      validateMusicTrackDocument({
        ...EMPTY_MUSIC_TRACK_DOCUMENT,
        name: "Quiet Study",
        gain: 0.6,
        file: new File(["audio"], "study.mp3", { type: "audio/mpeg" }),
      }),
    ).toEqual([]);
  });
});
