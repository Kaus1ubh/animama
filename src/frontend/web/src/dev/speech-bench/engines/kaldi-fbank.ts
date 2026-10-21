/**
 * Kaldi-compatible log-mel filterbank, low-frame-rate stacking and CMVN, as
 * SenseVoice's FunASR front end computes them (`WavFrontend`: 80 bins,
 * 25 ms / 10 ms Hamming frames with `snip_edges`, no dither). The FFT comes
 * from parakeet.js, which the app already ships.
 */
import { fft, precomputeTwiddles } from "parakeet.js";

const FRAME_LENGTH = 400;
const FRAME_SHIFT = 160;
const FFT_SIZE = 512;
const PREEMPHASIS = 0.97;
const LOW_HZ = 20;
const HIGH_HZ = 8000;
const SAMPLE_RATE = 16000;
const FLOAT_EPSILON = 1.1920929e-7;

const melScale = (hz: number) => 1127 * Math.log(1 + hz / 700);

type MelBank = { start: number; weights: Float64Array };

/** Kaldi triangular mel filters over FFT bins 0…255 (no Nyquist bin). */
function melBanks(bins: number): MelBank[] {
  const binWidth = SAMPLE_RATE / FFT_SIZE;
  const low = melScale(LOW_HZ);
  const delta = (melScale(HIGH_HZ) - low) / (bins + 1);
  return Array.from({ length: bins }, (_, bin) => {
    const left = low + bin * delta;
    const center = left + delta;
    const right = center + delta;
    const weights: number[] = [];
    let start = -1;
    for (let k = 0; k < FFT_SIZE / 2; k += 1) {
      const mel = melScale(k * binWidth);
      if (mel <= left || mel >= right) continue;
      if (start < 0) start = k;
      weights[k - start] =
        mel <= center
          ? (mel - left) / (center - left)
          : (right - mel) / (right - center);
    }
    return {
      start,
      weights: Float64Array.from(weights, (weight) => weight ?? 0),
    };
  });
}

const hamming = Float64Array.from(
  { length: FRAME_LENGTH },
  (_, i) => 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (FRAME_LENGTH - 1)),
);
const twiddles = precomputeTwiddles(FFT_SIZE);
const bankCache = new Map<number, MelBank[]>();

/** Log-mel frames `[frames × bins]` for 16 kHz samples in [-1, 1]. */
export function kaldiFbank(audio: Float32Array, bins = 80): Float32Array[] {
  let banks = bankCache.get(bins);
  if (!banks) {
    banks = melBanks(bins);
    bankCache.set(bins, banks);
  }
  const frameCount =
    audio.length < FRAME_LENGTH
      ? 0
      : 1 + Math.floor((audio.length - FRAME_LENGTH) / FRAME_SHIFT);
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  const frames: Float32Array[] = [];
  for (let frame = 0; frame < frameCount; frame += 1) {
    const offset = frame * FRAME_SHIFT;
    let mean = 0;
    for (let i = 0; i < FRAME_LENGTH; i += 1) {
      re[i] = audio[offset + i] * 32768;
      mean += re[i];
    }
    mean /= FRAME_LENGTH;
    for (let i = 0; i < FRAME_LENGTH; i += 1) re[i] -= mean;
    for (let i = FRAME_LENGTH - 1; i > 0; i -= 1) {
      re[i] -= PREEMPHASIS * re[i - 1];
    }
    re[0] -= PREEMPHASIS * re[0];
    for (let i = 0; i < FRAME_LENGTH; i += 1) re[i] *= hamming[i];
    re.fill(0, FRAME_LENGTH);
    im.fill(0);
    fft(re, im, FFT_SIZE, twiddles);

    const features = new Float32Array(bins);
    banks.forEach(({ start, weights }, bin) => {
      let energy = 0;
      for (let k = 0; k < weights.length; k += 1) {
        const index = start + k;
        energy += weights[k] * (re[index] * re[index] + im[index] * im[index]);
      }
      features[bin] = Math.log(Math.max(energy, FLOAT_EPSILON));
    });
    frames.push(features);
  }
  return frames;
}

/**
 * FunASR low-frame-rate stacking: `ceil(T / shift)` outputs of `window`
 * consecutive frames, left-padded with copies of the first frame and
 * right-padded with the last.
 */
export function stackLowFrameRate(
  frames: Float32Array[],
  window = 7,
  shift = 6,
): Float32Array {
  const bins = frames[0]?.length ?? 0;
  const padded = [
    ...Array.from({ length: (window - 1) >> 1 }, () => frames[0]),
    ...frames,
  ];
  const outputs = Math.ceil(frames.length / shift);
  const stacked = new Float32Array(outputs * window * bins);
  for (let output = 0; output < outputs; output += 1) {
    for (let offset = 0; offset < window; offset += 1) {
      const source =
        padded[Math.min(output * shift + offset, padded.length - 1)];
      stacked.set(source, (output * window + offset) * bins);
    }
  }
  return stacked;
}

/** Apply `(x + negMean) × invStddev` per feature dimension, in place. */
export function applyCmvn(
  features: Float32Array,
  negMean: Float32Array,
  invStddev: Float32Array,
): Float32Array {
  const dims = negMean.length;
  for (let index = 0; index < features.length; index += 1) {
    const dim = index % dims;
    features[index] = (features[index] + negMean[dim]) * invStddev[dim];
  }
  return features;
}
