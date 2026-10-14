/**
 * Speech audio features for lip-sync alignment, at 100 frames per second.
 *
 * Each 10 ms frame describes a 30 ms window centred on the frame's time:
 *
 * - `loudnessDb`: RMS level in dBFS;
 * - `voicing`: peak normalised autocorrelation for a fundamental between 75
 *   and 700 Hz (on an 8 kHz decimated signal), high for vowels and low for
 *   breath, whispers, gasps and silence;
 * - `pitchHz`: the fundamental at that peak. It is meaningful only where
 *   `voicing` is high.
 *
 * The extractor is incremental: PCM can arrive in chunks of any size, and a
 * frame is emitted as soon as all of its window has arrived. Pushing a whole
 * clip and finishing gives exactly the frames of `analyseSpeechAudio`.
 */

export const FEATURE_FRAME_RATE = 100;

const WINDOW_SEC = 0.03;
const DECIMATED_RATE = 8000;
const MIN_PITCH_HZ = 75;
const MAX_PITCH_HZ = 700;
/** Below this energy a window counts as silence and gets no voicing. */
const SILENT_ENERGY = 1e-7;

export type SpeechFeatures = {
  rate: number;
  loudnessDb: Float32Array;
  voicing: Float32Array;
  pitchHz: Float32Array;
};

export type SpeechFeatureExtractor = {
  /** Append PCM (Float32 in [-1, 1] or Int16) and return the number of frames now available. */
  push: (pcm: Float32Array | Int16Array) => number;
  /** Mark the end of the audio; the remaining frames use the windows that fit. */
  finish: () => number;
  /** Frames emitted so far. */
  frameCount: () => number;
  /** A copy of the frames emitted so far. */
  features: () => SpeechFeatures;
  /** Seconds of audio received so far. */
  receivedSec: () => number;
};

/** A growable Float32 or Float64 buffer. */
function growable<T extends Float32Array | Float64Array>(
  create: (size: number) => T,
) {
  let data = create(1024);
  let length = 0;
  return {
    get data() {
      return data;
    },
    get length() {
      return length;
    },
    push(value: number) {
      if (length === data.length) {
        const next = create(data.length * 2);
        next.set(data);
        data = next;
      }
      data[length] = value;
      length += 1;
    },
  };
}

/** Window sizes and pitch lags for one sample rate. */
function frameGeometry(sampleRate: number) {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error(`Invalid sample rate: ${sampleRate}`);
  }
  const step = Math.max(1, Math.round(sampleRate / DECIMATED_RATE));
  const decimatedRate = sampleRate / step;
  return {
    step,
    decimatedRate,
    halfWindow: Math.floor((WINDOW_SEC * sampleRate) / 2),
    decimatedWindow: Math.round(WINDOW_SEC * decimatedRate),
    minLag: Math.floor(decimatedRate / MAX_PITCH_HZ),
    maxLag: Math.ceil(decimatedRate / MIN_PITCH_HZ),
  };
}

type FrameGeometry = ReturnType<typeof frameGeometry>;

/** Whether frame `f`'s windows lie wholly inside `samples` samples of audio. */
function frameReady(
  g: FrameGeometry,
  sampleRate: number,
  f: number,
  samples: number,
): boolean {
  const centre = Math.round((f / FEATURE_FRAME_RATE) * sampleRate);
  const decimatedStart =
    Math.round((f / FEATURE_FRAME_RATE) * g.decimatedRate) -
    (g.decimatedWindow >> 1);
  return (
    centre + g.halfWindow <= samples &&
    decimatedStart + g.decimatedWindow + g.maxLag < Math.floor(samples / g.step)
  );
}

/**
 * Frames an extractor has emitted once `samples` samples have arrived, before
 * the audio is finished: every frame whose windows have fully arrived.
 */
export function speechFeatureFramesReady(
  sampleRate: number,
  samples: number,
): number {
  const g = frameGeometry(sampleRate);
  const total = Math.ceil((samples / sampleRate) * FEATURE_FRAME_RATE);
  let f = total;
  while (f > 0 && !frameReady(g, sampleRate, f - 1, samples)) f -= 1;
  return f;
}

export function createSpeechFeatureExtractor(
  sampleRate: number,
): SpeechFeatureExtractor {
  const g = frameGeometry(sampleRate);
  const { step, decimatedRate, halfWindow, decimatedWindow, minLag, maxLag } =
    g;

  // Prefix sums of squared samples make each RMS window O(1).
  const squares = growable((size) => new Float64Array(size));
  squares.push(0);
  const decimated = growable((size) => new Float32Array(size));
  let pendingSum = 0;
  let pendingCount = 0;
  let samples = 0;
  let finished = false;

  const loudness = growable((size) => new Float32Array(size));
  const voicingOut = growable((size) => new Float32Array(size));
  const pitch = growable((size) => new Float32Array(size));

  const totalFrames = () =>
    Math.ceil((samples / sampleRate) * FEATURE_FRAME_RATE);

  const ready = (f: number) => frameReady(g, sampleRate, f, samples);

  const computeFrame = (f: number) => {
    const centre = Math.round((f / FEATURE_FRAME_RATE) * sampleRate);
    const a = Math.max(0, centre - halfWindow);
    const b = Math.min(samples, centre + halfWindow);
    const mean = b > a ? (squares.data[b]! - squares.data[a]!) / (b - a) : 0;
    loudness.push(10 * Math.log10(mean + 1e-10));

    const x = decimated.data;
    const start =
      Math.round((f / FEATURE_FRAME_RATE) * decimatedRate) -
      (decimatedWindow >> 1);
    let best = 0;
    let bestLag = 0;
    if (start >= 0 && start + decimatedWindow + maxLag < decimated.length) {
      let e0 = 0;
      for (let n = 0; n < decimatedWindow; n += 1)
        e0 += x[start + n]! * x[start + n]!;
      if (e0 >= SILENT_ENERGY) {
        for (let lag = minLag; lag <= maxLag; lag += 1) {
          let c = 0;
          let e1 = 0;
          for (let n = 0; n < decimatedWindow; n += 1) {
            const y = x[start + n + lag]!;
            c += x[start + n]! * y;
            e1 += y * y;
          }
          const r = c / Math.sqrt(e0 * e1 + 1e-12);
          if (r > best) {
            best = r;
            bestLag = lag;
          }
        }
      }
    }
    voicingOut.push(best);
    pitch.push(bestLag > 0 ? decimatedRate / bestLag : 0);
  };

  const emitReady = () => {
    const total = totalFrames();
    while (loudness.length < total && (finished || ready(loudness.length))) {
      computeFrame(loudness.length);
    }
    return loudness.length;
  };

  return {
    push(pcm) {
      if (finished)
        throw new Error("Speech feature extractor already finished");
      const scale = pcm instanceof Int16Array ? 1 / 32768 : 1;
      for (let i = 0; i < pcm.length; i += 1) {
        const value = pcm[i]! * scale;
        squares.push(squares.data[squares.length - 1]! + value * value);
        pendingSum += value;
        pendingCount += 1;
        if (pendingCount === step) {
          decimated.push(pendingSum / step);
          pendingSum = 0;
          pendingCount = 0;
        }
      }
      samples += pcm.length;
      return emitReady();
    },
    finish() {
      finished = true;
      return emitReady();
    },
    frameCount: () => loudness.length,
    features: () => ({
      rate: FEATURE_FRAME_RATE,
      loudnessDb: loudness.data.slice(0, loudness.length),
      voicing: voicingOut.data.slice(0, voicingOut.length),
      pitchHz: pitch.data.slice(0, pitch.length),
    }),
    receivedSec: () => samples / sampleRate,
  };
}

/** Features of a whole clip. */
export function analyseSpeechAudio(
  pcm: Float32Array | Int16Array,
  sampleRate: number,
): SpeechFeatures {
  const extractor = createSpeechFeatureExtractor(sampleRate);
  extractor.push(pcm);
  extractor.finish();
  return extractor.features();
}

/** The first `frames` frames of `features`. */
export function sliceSpeechFeatures(
  features: SpeechFeatures,
  frames: number,
): SpeechFeatures {
  const end = Math.max(0, Math.min(frames, features.loudnessDb.length));
  return {
    rate: features.rate,
    loudnessDb: features.loudnessDb.subarray(0, end),
    voicing: features.voicing.subarray(0, end),
    pitchHz: features.pitchHz.subarray(0, end),
  };
}
