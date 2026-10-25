import { describe, expect, it } from "vitest";

import { applyCmvn, kaldiFbank, stackLowFrameRate } from "./kaldi-fbank";

const tone = (hz: number, seconds: number) =>
  Float32Array.from(
    { length: Math.round(seconds * 16000) },
    (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / 16000),
  );

describe("kaldiFbank", () => {
  it("frames 25 ms windows every 10 ms without padding the edges", () => {
    expect(kaldiFbank(new Float32Array(399))).toHaveLength(0);
    expect(kaldiFbank(new Float32Array(400))).toHaveLength(1);
    expect(kaldiFbank(new Float32Array(16000))).toHaveLength(98);
  });

  it("floors silence at log(FLT_EPSILON)", () => {
    const [frame] = kaldiFbank(new Float32Array(400));
    expect(frame[0]).toBeCloseTo(Math.log(1.1920929e-7), 5);
  });

  it("puts a tone's energy in the mel bins around its frequency", () => {
    const [frame] = kaldiFbank(tone(1000, 0.05));
    const peak = frame.indexOf(Math.max(...frame));
    // 1 kHz sits about a third of the way up Kaldi's 20–8000 Hz mel range.
    expect(peak).toBeGreaterThan(20);
    expect(peak).toBeLessThan(30);
    expect(frame[peak] - frame[79]).toBeGreaterThan(5);
  });

  it("matches Kaldi's own filterbank on a mixed signal", () => {
    // Two tones plus a deterministic ramp of noise, 0.25 s.
    const signal = Float32Array.from(
      { length: 4000 },
      (_, n) =>
        0.3 * Math.sin((2 * Math.PI * 440 * n) / 16000) +
        0.2 * Math.sin((2 * Math.PI * 1700 * n) / 16000) +
        0.05 * (((n * 7919) % 1000) / 1000 - 0.5),
    );
    // kaldi-native-fbank 1.22.4 with FunASR's options (80 bins, 20 Hz to
    // Nyquist, Hamming, pre-emphasis 0.97, DC removal, snip edges, no
    // dither), samples scaled by 32768; bins 0, 10, 40 and 79.
    const reference: Record<number, number[]> = {
      0: [11.6523, 12.7266, 16.6814, 20.0935],
      5: [11.8799, 12.9523, 16.8583, 20.1255],
      22: [13.1619, 12.704, 16.7133, 20.1147],
    };
    const frames = kaldiFbank(signal);
    expect(frames).toHaveLength(23);
    for (const [frame, values] of Object.entries(reference)) {
      [0, 10, 40, 79].forEach((bin, index) =>
        expect(frames[Number(frame)][bin]).toBeCloseTo(values[index], 2),
      );
    }
  });
});

describe("stackLowFrameRate", () => {
  const frames = Array.from({ length: 10 }, (_, i) => Float32Array.of(i));

  it("pads the start with the first frame and the end with the last", () => {
    expect(Array.from(stackLowFrameRate(frames))).toEqual([
      0, 0, 0, 0, 1, 2, 3, 3, 4, 5, 6, 7, 8, 9,
    ]);
  });

  it("emits ceil(T / shift) stacked frames", () => {
    const thirtyThree = Array.from({ length: 33 }, (_, i) =>
      Float32Array.of(i),
    );
    const stacked = stackLowFrameRate(thirtyThree);
    expect(stacked.length / 7).toBe(Math.ceil(33 / 6));
  });
});

describe("applyCmvn", () => {
  it("shifts and scales each feature dimension", () => {
    const features = Float32Array.of(1, 2, 3, 4);
    applyCmvn(features, Float32Array.of(-1, 1), Float32Array.of(2, 0.5));
    expect(Array.from(features)).toEqual([0, 1.5, 4, 2.5]);
  });
});
