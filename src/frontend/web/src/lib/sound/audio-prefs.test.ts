import { describe, expect, it } from "vitest";

import { resolveAudioPrefs } from "./audio-prefs";

describe("audio preferences", () => {
  it("migrates legacy URL preferences by retaining mix values only", () => {
    expect(
      resolveAudioPrefs({
        version: 1,
        bgmTrackUrl: "https://storage.example/private.mp3",
        bgmWasPlaying: true,
        bgmMuted: true,
        sfxMuted: false,
        ttsMuted: true,
        bgmVolume: 0.2,
        sfxVolume: 0.4,
        ttsVolume: 0.6,
      }),
    ).toEqual({
      version: 2,
      selectedBgmRuntimeIdByAnimaId: {},
      bgmMuted: true,
      sfxMuted: false,
      ttsMuted: true,
      bgmVolume: 0.2,
      sfxVolume: 0.4,
      ttsVolume: 0.6,
    });
  });

  it("retains bounded per-Anima runtime selections without raw URLs", () => {
    const selected = Object.fromEntries(
      Array.from({ length: 105 }, (_, index) => [
        `anima-${index}`,
        `track-${index}`,
      ]),
    );
    const resolved = resolveAudioPrefs({
      version: 2,
      selectedBgmRuntimeIdByAnimaId: {
        "": "invalid",
        "anima-empty": "",
        ...selected,
      },
    });

    expect(Object.keys(resolved.selectedBgmRuntimeIdByAnimaId)).toHaveLength(
      100,
    );
    expect(resolved.selectedBgmRuntimeIdByAnimaId["anima-104"]).toBe(
      "track-104",
    );
    expect(JSON.stringify(resolved)).not.toContain("http");
  });
});
