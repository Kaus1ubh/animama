import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SoundController } from "./SoundController";
import { resolveAudioPrefs } from "./audio-prefs";

type PlayResult = () => Promise<void>;

class MockAudio {
  static instances: MockAudio[] = [];
  static playResults: PlayResult[] = [];

  src = "";
  preload = "";
  loop = false;
  muted = false;
  volume = 1;
  currentTime = 0;
  paused = true;
  readyState = 0;
  networkState = 0;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(src?: string) {
    this.src = src ?? "";
    MockAudio.instances.push(this);
  }

  play(): Promise<void> {
    this.paused = false;
    return MockAudio.playResults.shift()?.() ?? Promise.resolve();
  }

  pause(): void {
    this.paused = true;
  }

  load(): void {}
}

const originalAudio = globalThis.Audio;

describe("SoundController", () => {
  beforeEach(() => {
    MockAudio.instances = [];
    MockAudio.playResults = [];
    globalThis.Audio = MockAudio as unknown as typeof Audio;
  });

  afterEach(() => {
    globalThis.Audio = originalAudio;
  });

  it("stops only sound owned by the cancelled occurrence and refuses late playback", () => {
    const controller = new SoundController();
    const occurrence = new AbortController();
    controller.playSfx("blob:unrelated");
    controller.playSfx("blob:owned", { signal: occurrence.signal });
    occurrence.abort();
    expect(
      MockAudio.instances.find((audio) => audio.src === "blob:owned")?.paused,
    ).toBe(true);
    expect(
      MockAudio.instances.find((audio) => audio.src === "blob:unrelated")
        ?.paused,
    ).toBe(false);
    expect(
      controller.playSfx("blob:late", { signal: occurrence.signal }),
    ).toBeNull();
    controller.dispose();
  });

  it("restores retained TTS/SFX mix without resuming historical Music", () => {
    const controller = new SoundController();
    controller.restorePersistedState(
      resolveAudioPrefs({
        version: 2,
        bgmTrackUrl: "blob:old-music",
        bgmWasPlaying: true,
        bgmVolume: 1,
        selectedBgmRuntimeIdByAnimaId: { anima: "old" },
        sfxVolume: 0.4,
        ttsVolume: 0.6,
        ttsMuted: true,
      }),
    );
    expect(MockAudio.instances).toHaveLength(0);
    expect(controller.getSnapshot()).toEqual({
      masterMuted: false,
      sfxMuted: false,
      ttsMuted: true,
      sfxVolume: 0.4,
      ttsVolume: 0.6,
    });
    controller.playSfx("blob:kept-sfx", { volume: 0.5 });
    expect(MockAudio.instances[0]?.volume).toBeCloseTo(0.2);
    controller.setMasterMuted(true);
    expect(MockAudio.instances[0]?.muted).toBe(true);
    controller.dispose();
  });

  it("refuses a ninth concurrent SFX playback", () => {
    const controller = new SoundController();
    const firstEight = Array.from({ length: 8 }, (_, index) =>
      controller.playSfx(`blob:sfx-${index}`),
    );

    expect(firstEight.every(Boolean)).toBe(true);
    expect(controller.playSfx("blob:sfx-9")).toBeNull();
    controller.dispose();
  });
});
