import { beforeAll, describe, expect, it } from "vitest";

import { playbackResumedAnchor } from "@/lib/speech/speech-pcm-tap";

type Message = { type: string; [key: string]: unknown };
type Processor = {
  port: {
    postMessage: (message: Message) => void;
    onmessage: (event: { data: Message }) => void;
  };
  process: (inputs: unknown[], outputs: Float32Array[][]) => boolean;
};

const RATE = 24_000;
const QUANTUM = 128;
const scope = globalThis as Record<string, unknown>;
let Processor: new (options: unknown) => Processor;

beforeAll(async () => {
  // The worklet's globals, as an AudioWorkletGlobalScope provides them.
  scope.sampleRate = RATE;
  scope.currentTime = 0;
  scope.AudioWorkletProcessor = class {
    port = { postMessage: () => undefined, onmessage: () => undefined };
  };
  scope.registerProcessor = (_name: string, processor: typeof Processor) => {
    Processor = processor;
  };
  // @ts-expect-error -- the worklet is a plain script without types.
  await import("../../../../public/tts/audio/pcm-processor.worklet.js");
});

function player() {
  const messages: Message[] = [];
  const processor = new Processor({
    processorOptions: { minBufferBeforePlaybackMs: 10 },
  });
  processor.port.postMessage = (message) => messages.push(message);
  const play = (quanta: number) => {
    for (let i = 0; i < quanta; i += 1) {
      processor.process([], [[new Float32Array(QUANTUM)]]);
      scope.currentTime = (scope.currentTime as number) + QUANTUM / RATE;
    }
  };
  const add = (samples: number) =>
    processor.port.onmessage({
      data: { type: "audio", data: new Float32Array(samples).fill(0.1) },
    });
  const end = () =>
    processor.port.onmessage({ data: { type: "stream-ended" } });
  return { messages, play, add, end };
}

describe("PCM worklet", () => {
  it("reports which sample plays when playback resumes after an underrun", () => {
    scope.currentTime = 1;
    const { messages, play, add } = player();
    add(QUANTUM * 4);
    play(4);
    // Starved for three quanta, then fed again.
    play(3);
    expect(messages.some((message) => message.type === "underrun")).toBe(true);
    add(QUANTUM * 4);
    const resumedAt = scope.currentTime as number;
    play(1);

    const resumed = messages.filter((m) => m.type === "playback-resumed");
    expect(resumed).toEqual([
      {
        type: "playback-resumed",
        playedSamples: QUANTUM * 4,
        audioTime: resumedAt,
      },
    ]);
    // On the run clock: sample 512 (0.0213 s) played 3 quanta late.
    const anchor = playbackResumedAnchor({ ...resumed[0], sampleRate: RATE })!;
    expect(anchor.runSec).toBeCloseTo((QUANTUM * 4) / RATE);
    expect(anchor.contextSec - (1 + anchor.runSec)).toBeCloseTo(
      (3 * QUANTUM) / RATE,
    );
  });

  it("starts counting again for a new stream", () => {
    const { messages, play, add, end } = player();
    add(QUANTUM * 2);
    end();
    play(3);
    expect(messages.some((m) => m.type === "playback-complete")).toBe(true);
    // The next run's stream reuses the worklet; its count starts at zero.
    add(QUANTUM * 2);
    play(3);
    add(QUANTUM * 2);
    play(1);
    expect(
      messages.filter((m) => m.type === "playback-resumed").at(-1),
    ).toMatchObject({ playedSamples: QUANTUM * 2 });
  });

  it("ignores a resume report without its fields", () => {
    expect(playbackResumedAnchor({ playedSamples: 10 })).toBeNull();
    expect(
      playbackResumedAnchor({ playedSamples: 10, audioTime: 1, sampleRate: 0 }),
    ).toBeNull();
  });
});
