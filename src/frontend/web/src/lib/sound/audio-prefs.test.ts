import { describe, expect, it } from "vitest";
import { resolveAudioPrefs } from "./audio-prefs";

describe("audio preference retirement", () => {
  it.each([1, 2])(
    "retains TTS/SFX and discards every Music preference from version %s",
    (version) => {
      expect(
        resolveAudioPrefs({
          version,
          bgmTrackUrl: "https://example.test/private.mp3",
          bgmWasPlaying: true,
          selectedBgmRuntimeIdByAnimaId: { anima: "track" },
          bgmMuted: true,
          bgmVolume: 0.2,
          sfxMuted: false,
          ttsMuted: true,
          sfxVolume: 0.4,
          ttsVolume: 0.6,
        }),
      ).toEqual({
        version: 3,
        sfxMuted: false,
        ttsMuted: true,
        sfxVolume: 0.4,
        ttsVolume: 0.6,
      });
    },
  );
  it("bounds retained mix values and rejects malformed settings", () => {
    expect(
      resolveAudioPrefs({
        version: 3,
        sfxMuted: "yes",
        ttsMuted: true,
        sfxVolume: 4,
        ttsVolume: NaN,
      }),
    ).toEqual({
      version: 3,
      sfxMuted: false,
      ttsMuted: true,
      sfxVolume: 1,
      ttsVolume: 0.5,
    });
  });
});
