import { describe, expect, it } from "vitest";

import {
  BENCH_SAMPLE_RATE,
  runClip,
  type BenchClock,
  type BenchEngine,
} from "./bench-runner";

function virtualClock(): BenchClock & { advance: (ms: number) => void } {
  let time = 0;
  return {
    now: () => time,
    advance: (ms) => {
      time += ms;
    },
    sleepUntil: async (target) => {
      time = Math.max(time, target);
    },
  };
}

const seconds = (value: number) =>
  new Float32Array(Math.round(value * BENCH_SAMPLE_RATE));

/** Decoding costs `msPerAudioSecond` of virtual time per second of audio. */
function windowEngine(
  clock: ReturnType<typeof virtualClock>,
  msPerAudioSecond: number,
): BenchEngine & { calls: number[] } {
  const calls: number[] = [];
  return {
    calls,
    transcribe: async (audio) => {
      calls.push(audio.length);
      clock.advance((audio.length / BENCH_SAMPLE_RATE) * msPerAudioSecond);
      return `words ${audio.length}`;
    },
  };
}

describe("runClip", () => {
  it("times a finished window as one decode in throughput mode", async () => {
    const clock = virtualClock();
    const engine = windowEngine(clock, 100);

    const result = await runClip(engine, seconds(4), "en", {
      mode: "throughput",
      interim: false,
      clock,
    });

    expect(result).toMatchObject({
      audioSeconds: 4,
      finalLatencyMs: 400,
      processingMs: 400,
      firstInterimMs: null,
      interimCount: 0,
    });
    expect(engine.calls).toEqual([4 * BENCH_SAMPLE_RATE]);
  });

  it("shows interim text while paced audio arrives and decodes the whole window last", async () => {
    const clock = virtualClock();
    const engine = windowEngine(clock, 50);

    const result = await runClip(engine, seconds(3), "ja", {
      mode: "paced",
      interim: true,
      clock,
    });

    expect(result.interimCount).toBeGreaterThan(0);
    expect(result.firstInterimMs).toBeGreaterThanOrEqual(600);
    expect(result.firstInterimMs).toBeLessThan(1000);
    expect(engine.calls.at(-1)).toBe(3 * BENCH_SAMPLE_RATE);
    expect(result.text).toBe(`words ${3 * BENCH_SAMPLE_RATE}`);
    expect(result.processingMs).toBe(150);
    expect(result.finalLatencyMs).toBeGreaterThanOrEqual(150);
  });

  it("counts a preview still running at the end of the audio in the final delay", async () => {
    const clock = virtualClock();
    // 100 ms per audio second: a preview of ~2.4 s still runs when 2.6 s ends.
    const engine = windowEngine(clock, 100);

    const result = await runClip(engine, seconds(2.6), "en", {
      mode: "paced",
      interim: true,
      clock,
    });

    expect(clock.now() - 2600).toBeCloseTo(result.finalLatencyMs, 6);
    expect(result.finalLatencyMs).toBeGreaterThan(result.processingMs);
  });

  it("decodes once after the audio ends when paced without interim text", async () => {
    const clock = virtualClock();
    const engine = windowEngine(clock, 50);

    const result = await runClip(engine, seconds(2), "ko", {
      mode: "paced",
      interim: false,
      clock,
    });

    expect(engine.calls).toEqual([2 * BENCH_SAMPLE_RATE]);
    expect(result.finalLatencyMs).toBe(100);
    expect(clock.now()).toBe(2100);
  });
});
