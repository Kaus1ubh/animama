import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SoundController } from "./SoundController";

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

function deferredPlay(): {
  result: PlayResult;
  resolve: () => void;
} {
  let resolve: (() => void) | null = null;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return {
    result: () => promise,
    resolve: () => resolve?.(),
  };
}

describe("SoundController", () => {
  beforeEach(() => {
    MockAudio.instances = [];
    MockAudio.playResults = [];
    globalThis.Audio = MockAudio as unknown as typeof Audio;
  });

  afterEach(() => {
    globalThis.Audio = originalAudio;
  });

  it("does not let a stale play completion interrupt a newer BGM source", async () => {
    const first = deferredPlay();
    const second = deferredPlay();
    MockAudio.playResults.push(first.result, second.result);
    const controller = new SoundController();

    const firstAttempt = controller.playBgm({ trackUrl: "blob:first" });
    controller.stopBgm();
    const secondAttempt = controller.playBgm({ trackUrl: "blob:second" });
    const audio = MockAudio.instances[0]!;

    first.resolve();
    await expect(firstAttempt).resolves.toBe(false);
    expect(audio.paused).toBe(false);
    expect(audio.src).toBe("blob:second");

    second.resolve();
    await expect(secondAttempt).resolves.toBe(true);
    expect(controller.getSnapshot().bgmState).toBe("playing");
    controller.dispose();
  });

  it("retains an autoplay-blocked state and retries after activation", async () => {
    MockAudio.playResults.push(
      () => Promise.reject(new DOMException("blocked", "NotAllowedError")),
      () => Promise.resolve(),
    );
    const controller = new SoundController();

    await expect(
      controller.playBgm({ trackUrl: "blob:autoplay" }),
    ).resolves.toBe(false);
    expect(controller.getSnapshot()).toMatchObject({
      bgmState: "blocked",
      pendingAutoplayRetry: true,
    });

    await expect(controller.retryPendingBgmAutoplay()).resolves.toBe(true);
    expect(controller.getSnapshot()).toMatchObject({
      bgmState: "playing",
      pendingAutoplayRetry: false,
    });
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
