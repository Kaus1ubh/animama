import { describe, expect, it } from "vitest";

import {
  type SpeechPreviewConfig,
  type SpeechPreviewEvent,
  createSpeechPreviewController,
  shouldEnableSpeechPreviews,
} from "./preview-controller";

const SAMPLE_RATE = 16000;
const FRAME_SAMPLES = 512; // 32 ms MicVAD v5 frame
const FRAME_MS = (FRAME_SAMPLES / SAMPLE_RATE) * 1000;

const CONFIG: SpeechPreviewConfig = {
  sampleRateHz: SAMPLE_RATE,
  preSpeechPadMs: 64,
  firstPreviewMs: 320,
  minIntervalMs: 320,
  intervalDecodeMultiplier: 1.5,
  maxPreviewDecodeMs: 400,
  maxPreviewAudioMs: 1000,
};

type Deferred = {
  audio: Float32Array;
  turnId: string;
  windowId: string;
  resolve: (text: string, decodeMs: number) => Promise<void>;
  reject: (error: Error) => Promise<void>;
};

function setup(
  config: Partial<SpeechPreviewConfig> = {},
  shouldPreview?: (turnId: string) => boolean,
) {
  let nowMs = 0;
  const requests: Deferred[] = [];
  const previews: Array<{ turnId: string; windowId: string; text: string }> =
    [];
  const events: SpeechPreviewEvent[] = [];
  const controller = createSpeechPreviewController({
    config: { ...CONFIG, ...config },
    now: () => nowMs,
    transcribe: ({ audio, turnId, windowId }) =>
      new Promise((resolve, reject) => {
        requests.push({
          audio,
          turnId,
          windowId,
          resolve: async (text, decodeMs) => {
            nowMs += decodeMs;
            resolve({ text, decodeMs });
            await Promise.resolve();
            await Promise.resolve();
          },
          reject: async (error) => {
            reject(error);
            await Promise.resolve();
            await Promise.resolve();
          },
        });
      }),
    onPreview: (preview) => previews.push(preview),
    onEvent: (event) => events.push(event),
    shouldPreview,
  });

  /** Push `count` frames whose samples all equal `value`, advancing time. */
  const pushFrames = (count: number, value = 0.5) => {
    for (let index = 0; index < count; index += 1) {
      nowMs += FRAME_MS;
      controller.pushFrame(new Float32Array(FRAME_SAMPLES).fill(value));
    }
  };

  return { controller, requests, previews, events, pushFrames };
}

describe("createSpeechPreviewController", () => {
  it("waits for the first-preview threshold before decoding", () => {
    const { controller, requests, pushFrames } = setup();
    controller.startWindow({ turnId: "t1", windowId: "w1" });
    pushFrames(9); // 288 ms
    expect(requests).toHaveLength(0);
    pushFrames(1); // 320 ms
    expect(requests).toHaveLength(1);
    expect(requests[0].windowId).toBe("w1");
  });

  it("seeds the window with pre-speech pad audio from before the window opened", () => {
    const { controller, requests, pushFrames } = setup();
    pushFrames(5, 0.1); // silence before speech; only 64 ms (2 frames) retained
    controller.startWindow({ turnId: "t1", windowId: "w1" });
    pushFrames(10, 0.5);
    const audio = requests[0].audio;
    expect(audio.length).toBe(12 * FRAME_SAMPLES);
    expect(audio[0]).toBeCloseTo(0.1);
    expect(audio[2 * FRAME_SAMPLES]).toBeCloseTo(0.5);
  });

  it("keeps at most one preview in flight and publishes its text", async () => {
    const { controller, requests, previews, pushFrames } = setup();
    controller.startWindow({ turnId: "t1", windowId: "w1" });
    pushFrames(10);
    pushFrames(20);
    expect(requests).toHaveLength(1);
    await requests[0].resolve("hello", 50);
    expect(previews).toEqual([{ turnId: "t1", windowId: "w1", text: "hello" }]);
  });

  it("spaces previews by the larger of the minimum interval and the scaled decode time", async () => {
    const { controller, requests, pushFrames } = setup();
    controller.startWindow({ turnId: "t1", windowId: "w1" });
    pushFrames(10);
    await requests[0].resolve("a", 100); // 100 ms decode of 320 ms audio
    // Interval is max(320, 150) = 320 ms after the first dispatch.
    pushFrames(6);
    expect(requests).toHaveLength(1);
    pushFrames(1);
    expect(requests).toHaveLength(2);
  });

  it("stops previewing a window when the predicted decode exceeds the budget", async () => {
    const { controller, requests, events, pushFrames } = setup();
    controller.startWindow({ turnId: "t1", windowId: "w1" });
    pushFrames(10); // 320 ms
    // 300 ms decode for 320 ms audio: the next ~640 ms window predicts ~600 ms.
    await requests[0].resolve("a", 300);
    pushFrames(20);
    expect(requests).toHaveLength(1);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "budget_exceeded", windowId: "w1" }),
    );
  });

  it("previews only the most recent audio once the window exceeds the cap", () => {
    const { controller, requests, pushFrames } = setup({
      firstPreviewMs: 1600,
    });
    controller.startWindow({ turnId: "t1", windowId: "w1" });
    pushFrames(50); // 1.6 s buffered, cap is 1 s
    expect(requests).toHaveLength(1);
    expect(requests[0].audio.length).toBe(SAMPLE_RATE);
  });

  it("drops a preview result that arrives after its window ended", async () => {
    const { controller, requests, previews, pushFrames } = setup();
    controller.startWindow({ turnId: "t1", windowId: "w1" });
    pushFrames(10);
    controller.endWindow("w1");
    await requests[0].resolve("late", 50);
    expect(previews).toHaveLength(0);
  });

  it("does not preview after the window ends", () => {
    const { controller, requests, pushFrames } = setup();
    controller.startWindow({ turnId: "t1", windowId: "w1" });
    pushFrames(5);
    controller.endWindow("w1");
    pushFrames(20);
    expect(requests).toHaveLength(0);
  });

  it("drops results and pending state after reset", async () => {
    const { controller, requests, previews, pushFrames } = setup();
    controller.startWindow({ turnId: "t1", windowId: "w1" });
    pushFrames(10);
    controller.reset();
    await requests[0].resolve("stale", 50);
    pushFrames(20);
    expect(previews).toHaveLength(0);
    expect(requests).toHaveLength(1);
  });

  it("stops previewing a window after a decode error without throwing", async () => {
    const { controller, requests, previews, events, pushFrames } = setup();
    controller.startWindow({ turnId: "t1", windowId: "w1" });
    pushFrames(10);
    await requests[0].reject(new Error("boom"));
    pushFrames(20);
    expect(requests).toHaveLength(1);
    expect(previews).toHaveLength(0);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "preview_failed", windowId: "w1" }),
    );
  });

  it("starts fresh for the next window", async () => {
    const { controller, requests, previews, pushFrames } = setup();
    controller.startWindow({ turnId: "t1", windowId: "w1" });
    pushFrames(10);
    controller.endWindow("w1");
    await requests[0].resolve("old", 50);
    controller.startWindow({ turnId: "t1", windowId: "w2" });
    pushFrames(10);
    expect(requests).toHaveLength(2);
    await requests[1].resolve("new", 50);
    expect(previews).toEqual([{ turnId: "t1", windowId: "w2", text: "new" }]);
  });

  it("previews a new window again after a slow decode stopped the previous one", async () => {
    const { controller, requests, previews, pushFrames } = setup();
    controller.startWindow({ turnId: "t1", windowId: "w1" });
    pushFrames(10);
    await requests[0].resolve("slow", 1_000); // decode slower than real time
    pushFrames(20);
    expect(requests).toHaveLength(1); // budget stops w1
    controller.endWindow("w1");

    controller.startWindow({ turnId: "t1", windowId: "w2" });
    pushFrames(10);
    expect(requests).toHaveLength(2);
    await requests[1].resolve("fast again", 50);
    expect(previews.at(-1)).toEqual({
      turnId: "t1",
      windowId: "w2",
      text: "fast again",
    });
  });

  it("waits 1.5x the last decode when that exceeds the minimum interval", async () => {
    const { controller, requests, pushFrames } = setup({
      maxPreviewDecodeMs: 10_000,
    });
    controller.startWindow({ turnId: "t1", windowId: "w1" });
    pushFrames(10); // dispatch at 320 ms
    await requests[0].resolve("a", 300); // interval = max(320, 450) = 450 ms
    pushFrames(4); // 748 ms
    expect(requests).toHaveLength(1);
    pushFrames(1); // 780 ms
    expect(requests).toHaveLength(2);
  });

  it("never previews when the decode budget is zero", () => {
    const { controller, requests, pushFrames } = setup({
      maxPreviewDecodeMs: 0,
    });
    controller.startWindow({ turnId: "t1", windowId: "w1" });
    pushFrames(40);
    expect(requests).toHaveLength(0);
  });

  it("skips dispatch while previews are not wanted and resumes afterwards", () => {
    let wanted = false;
    const { controller, requests, pushFrames } = setup({}, () => wanted);
    controller.startWindow({ turnId: "t1", windowId: "w1" });
    pushFrames(20);
    expect(requests).toHaveLength(0);
    wanted = true;
    pushFrames(1);
    expect(requests).toHaveLength(1);
  });

  it("budget-checks a first preview that was held back until the window grew long", async () => {
    let wanted = true;
    const { controller, requests, events, pushFrames } = setup(
      {},
      () => wanted,
    );
    controller.startWindow({ turnId: "t1", windowId: "w1" });
    pushFrames(10);
    await requests[0].resolve("a", 160); // 0.5 ms of decode per ms of audio
    controller.endWindow("w1");

    wanted = false; // e.g. the assistant is still speaking
    controller.startWindow({ turnId: "t1", windowId: "w2" });
    pushFrames(60); // ~1.9 s buffered while held back: predicts ~960 ms
    wanted = true;
    pushFrames(1);
    expect(requests).toHaveLength(1);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "budget_exceeded", windowId: "w2" }),
    );
  });

  it("does not send a late first preview before any decode rate is known", () => {
    let wanted = false;
    const { controller, requests, events, pushFrames } = setup(
      {},
      () => wanted,
    );
    controller.startWindow({ turnId: "t1", windowId: "w1" });
    pushFrames(60); // held back until the window is ~1.9 s long
    wanted = true;
    pushFrames(1);
    expect(requests).toHaveLength(0);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "budget_exceeded",
        windowId: "w1",
        predictedDecodeMs: null,
      }),
    );
  });

  it("endWindow(null) ends whichever window is open", async () => {
    const { controller, requests, previews, pushFrames } = setup();
    controller.startWindow({ turnId: "t1", windowId: "w1" });
    pushFrames(10);
    controller.endWindow(null);
    await requests[0].resolve("late", 50);
    pushFrames(20);
    expect(previews).toHaveLength(0);
    expect(requests).toHaveLength(1);
  });

  it("never decodes more than the capped audio tail", () => {
    const { controller, requests, pushFrames } = setup({
      firstPreviewMs: 3200,
    });
    controller.startWindow({ turnId: "t1", windowId: "w1" });
    pushFrames(100); // 3.2 s buffered, cap is 1 s
    expect(requests).toHaveLength(1);
    expect(requests[0].audio.length).toBe(SAMPLE_RATE);
    expect(requests[0].audio[SAMPLE_RATE - 1]).toBeCloseTo(0.5);
  });

  it("ignores empty preview text", async () => {
    const { controller, requests, previews, pushFrames } = setup();
    controller.startWindow({ turnId: "t1", windowId: "w1" });
    pushFrames(10);
    await requests[0].resolve("   ", 50);
    expect(previews).toHaveLength(0);
  });
});

describe("shouldEnableSpeechPreviews", () => {
  it("enables previews only on the WebGPU backend", () => {
    expect(shouldEnableSpeechPreviews("webgpu")).toBe(true);
    expect(shouldEnableSpeechPreviews("wasm")).toBe(false);
  });
});
