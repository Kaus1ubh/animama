import { describe, expect, it } from "vitest";
import {
  analyseSpeechAudio,
  createSpeechFeatureExtractor,
  FEATURE_FRAME_RATE,
  speechFeatureFramesReady,
} from "./features";

const RATE = 24000;

function tone(hz: number, seconds: number, amplitude = 0.3): Float32Array {
  const pcm = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < pcm.length; i += 1) {
    pcm[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / RATE);
  }
  return pcm;
}

function noise(seconds: number, amplitude = 0.3): Float32Array {
  // A fixed linear congruential generator keeps the test deterministic.
  let state = 12345;
  const pcm = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < pcm.length; i += 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    pcm[i] = amplitude * ((state / 2147483648) * 2 - 1);
  }
  return pcm;
}

const middle = (values: Float32Array) =>
  values.subarray(
    Math.floor(values.length * 0.25),
    Math.floor(values.length * 0.75),
  );

describe("analyseSpeechAudio", () => {
  it("gives 100 frames per second of audio", () => {
    const features = analyseSpeechAudio(tone(200, 1.234), RATE);
    expect(features.rate).toBe(FEATURE_FRAME_RATE);
    expect(features.loudnessDb.length).toBe(124);
    expect(features.voicing.length).toBe(124);
    expect(features.pitchHz.length).toBe(124);
  });

  it("finds a voiced tone and its pitch", () => {
    const features = analyseSpeechAudio(tone(200, 1), RATE);
    for (const value of middle(features.voicing))
      expect(value).toBeGreaterThan(0.9);
    for (const hz of middle(features.pitchHz))
      expect(Math.abs(hz - 200)).toBeLessThan(8);
    // A sine of amplitude 0.3 has an RMS of about -13.5 dBFS.
    for (const db of middle(features.loudnessDb))
      expect(Math.abs(db + 13.5)).toBeLessThan(0.5);
  });

  it("treats noise as unvoiced and silence as quiet", () => {
    const noisy = analyseSpeechAudio(noise(1), RATE);
    const meanVoicing =
      middle(noisy.voicing).reduce((sum, value) => sum + value, 0) /
      middle(noisy.voicing).length;
    expect(meanVoicing).toBeLessThan(0.5);

    const silent = analyseSpeechAudio(new Float32Array(RATE), RATE);
    for (const db of silent.loudnessDb) expect(db).toBeLessThanOrEqual(-99);
    for (const value of silent.voicing) expect(value).toBe(0);
  });

  it("accepts Int16 PCM", () => {
    const float = tone(220, 0.5);
    const int16 = Int16Array.from(float, (value) => Math.round(value * 32767));
    const a = analyseSpeechAudio(float, RATE);
    const b = analyseSpeechAudio(int16, RATE);
    for (let f = 0; f < a.loudnessDb.length; f += 1) {
      expect(Math.abs(a.loudnessDb[f]! - b.loudnessDb[f]!)).toBeLessThan(0.01);
    }
  });
});

describe("createSpeechFeatureExtractor", () => {
  it("emits the same frames incrementally as for the whole clip", () => {
    const pcm = new Float32Array([
      ...tone(180, 0.6),
      ...noise(0.3, 0.05),
      ...tone(260, 0.5),
    ]);
    const whole = analyseSpeechAudio(pcm, RATE);

    const extractor = createSpeechFeatureExtractor(RATE);
    const sizes = [1, 7, 480, 1023, 2400, 5, 9600];
    let offset = 0;
    let previous = 0;
    for (let k = 0; offset < pcm.length; k += 1) {
      const size = sizes[k % sizes.length]!;
      const available = extractor.push(pcm.subarray(offset, offset + size));
      expect(available).toBeGreaterThanOrEqual(previous);
      previous = available;
      offset += size;
    }
    // Every frame emitted before the end only used audio that had arrived.
    expect(extractor.frameCount()).toBeLessThan(whole.loudnessDb.length);
    extractor.finish();
    const incremental = extractor.features();

    expect(Array.from(incremental.loudnessDb)).toEqual(
      Array.from(whole.loudnessDb),
    );
    expect(Array.from(incremental.voicing)).toEqual(Array.from(whole.voicing));
    expect(Array.from(incremental.pitchHz)).toEqual(Array.from(whole.pitchHz));
  });

  it("emits a frame only once its window has arrived", () => {
    const extractor = createSpeechFeatureExtractor(RATE);
    extractor.push(tone(200, 0.1));
    // 0.1 s gives 10 frames in total; the last few wait for the window's tail.
    expect(extractor.frameCount()).toBeGreaterThan(5);
    expect(extractor.frameCount()).toBeLessThan(10);
    expect(extractor.receivedSec()).toBeCloseTo(0.1, 6);
    expect(extractor.finish()).toBe(10);
  });

  it("reports which frames are ready for any amount of audio", () => {
    const pcm = tone(190, 0.8);
    for (const samples of [0, 1, 700, 2400, 2401, 5000, 12345, 19200]) {
      const extractor = createSpeechFeatureExtractor(RATE);
      extractor.push(pcm.subarray(0, samples));
      expect(extractor.frameCount()).toBe(
        speechFeatureFramesReady(RATE, samples),
      );
    }
  });

  it("rejects audio after finishing", () => {
    const extractor = createSpeechFeatureExtractor(RATE);
    extractor.finish();
    expect(() => extractor.push(new Float32Array(10))).toThrow(/finished/);
  });
});
