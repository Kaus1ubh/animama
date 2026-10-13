/**
 * Places lip-sync units on the audio: an explicit-duration Viterbi over 10 ms
 * feature frames. Each unit takes a contiguous run of frames whose length
 * follows a log-normal prior; pauses may take none. Emissions come from
 * loudness and voicing, and optionally from a phone model's vowel posteriors and
 * phone density. Provider timing adds a cost for every frame a unit spends
 * outside its window, so the windows guide without forcing.
 *
 * With `partial`, the audio may end before the text does (planning on the audio
 * received so far), and the path may stop at any unit. With `fromFrame`, only
 * the audio from that frame on is aligned, for planners that keep the units they
 * have already placed.
 */

import type { SpeechFeatures } from "@/lib/lipsync/audio/features";
import { LIPSYNC_VOWELS, type LipSyncVowel } from "@/lib/lipsync/track";
import type { LipSyncUnit } from "@/lib/lipsync/text/units";

const LOG_EPS = 1e-4;
/** Cost per frame a unit spends outside its provider window. */
const WINDOW_COST = 1.5;
/** Skipping an optional pause costs a little, so real pauses are preferred. */
const SKIP_PAUSE_COST = 0.5;
/** Leading and trailing silence may take up to this many frames. */
const MAX_EDGE_FRAMES = 300;
/** Frames per unit of speech weight, when the audio cannot tell yet. */
export const DEFAULT_FRAMES_PER_WEIGHT = 16;

/** Phone-model evidence on its own frame grid. */
export type AcousticEvidence = {
  /** Per-frame vowel posteriors, and `density`: how speech-like the sound is. */
  posteriors: Record<LipSyncVowel | "density", Float32Array>;
  frameSec: number;
};

/** A provider timing window, in seconds, with how far a unit may stray without cost. */
export type UnitWindow = {
  startSec: number;
  endSec: number;
  toleranceSec: number;
};

export type AlignedUnit = {
  unit: LipSyncUnit;
  startSec: number;
  endSec: number;
};

export type AlignOptions = {
  acoustic?: AcousticEvidence;
  /** One per unit, or `null` where the provider gave none. */
  windows?: ReadonlyArray<UnitWindow | null>;
  /** The audio may end before the text does. */
  partial?: boolean;
  /** Align only the audio from this feature frame on. */
  fromFrame?: number;
  /** The clip's loudness levels; see `loudnessLevels`. */
  levels?: LoudnessLevels;
  /** Speaking rate: frames per unit of speech weight. Measured from the audio otherwise. */
  framesPerWeight?: number;
};

export type LoudnessLevels = {
  /** Below this level (dBFS) a frame counts as silence. */
  floor: number;
  /** The loud end of speech: the 97th percentile. */
  peak: number;
};

type State = {
  unit: LipSyncUnit | null;
  optional: boolean;
  minF: number;
  maxF: number;
  meanF: number;
  sigma: number;
  /** Frames, relative to the aligned span. */
  window?: [number, number];
  emission: Float64Array;
};

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

const MIN_SPEECH_PEAK_DB = -35;
const NOISE_PERCENTILE = 8;
/** Frames of audio after which the noise percentile is fully trusted. */
const NOISE_SETTLED_FRAMES = 300;
const HISTOGRAM_MIN_DB = -120;
const HISTOGRAM_STEP_DB = 0.5;
const HISTOGRAM_BINS = 260;

/**
 * The clip's loudness levels: the floor sits 8 dB over the noise, no lower than
 * 38 dB and no higher than 20 dB under the peak. The noise is the 8th
 * percentile once three seconds have arrived; before that a lower percentile,
 * so a start that is mostly a laugh or a sigh still finds the silence before
 * it. Before any speech, the peak is taken as at least -35 dBFS. Percentiles
 * come from a 0.5 dB histogram, so this stays cheap as audio grows.
 */
export function loudnessLevels(loudnessDb: Float32Array): LoudnessLevels {
  const counts = new Uint32Array(HISTOGRAM_BINS);
  for (const db of loudnessDb) {
    const bin = Math.round((db - HISTOGRAM_MIN_DB) / HISTOGRAM_STEP_DB);
    counts[Math.max(0, Math.min(HISTOGRAM_BINS - 1, bin))]! += 1;
  }
  const percentile = (p: number) => {
    const rank = Math.round((p / 100) * Math.max(0, loudnessDb.length - 1));
    let seen = 0;
    for (let bin = 0; bin < HISTOGRAM_BINS; bin += 1) {
      seen += counts[bin]!;
      if (seen > rank) return HISTOGRAM_MIN_DB + bin * HISTOGRAM_STEP_DB;
    }
    return HISTOGRAM_MIN_DB;
  };
  // A whisper in the test set peaks at -22 dBFS; quieter audio is silence.
  const peak = Math.max(percentile(97), MIN_SPEECH_PEAK_DB);
  const noise = percentile(
    NOISE_PERCENTILE * Math.min(1, loudnessDb.length / NOISE_SETTLED_FRAMES),
  );
  const floor = Math.min(Math.max(noise + 8, peak - 38), peak - 20);
  return { floor, peak };
}

/** Speech units' total weight, and the seconds tags that make a sound should take. */
function unitLoad(units: readonly LipSyncUnit[]) {
  let tagSec = 0;
  let speechWeight = 0;
  for (const unit of units) {
    if (unit.kind === "tag") {
      const kind = unit.tag!.kind;
      if (kind !== "pause" && kind !== "sound_effect") tagSec += unit.weight;
    } else if (unit.kind !== "pause") speechWeight += unit.weight;
  }
  return { tagSec, speechWeight };
}

export function alignUnits(
  units: readonly LipSyncUnit[],
  features: SpeechFeatures,
  options: AlignOptions = {},
): AlignedUnit[] {
  const rate = features.rate;
  const from = Math.max(0, options.fromFrame ?? 0);
  const T = features.loudnessDb.length - from;
  if (T <= 0 || !units.length) return [];
  const { floor } = options.levels ?? loudnessLevels(features.loudnessDb);
  const speech = new Float64Array(T);
  const voiced = new Float64Array(T);
  for (let t = 0; t < T; t += 1) {
    speech[t] = sigmoid((features.loudnessDb[from + t]! - (floor + 4)) / 2.5);
    voiced[t] = Math.min(
      1,
      Math.max(0, (features.voicing[from + t]! - 0.45) / 0.4),
    );
  }

  const { acoustic } = options;
  // Phone density: speech-like (1) against other sound (0); neutral without a model.
  const dense = new Float64Array(T).fill(0.5);
  const vowelShare: Partial<Record<LipSyncVowel, Float64Array>> = {};
  if (acoustic) {
    const at = (key: LipSyncVowel | "density", t: number) => {
      const series = acoustic.posteriors[key];
      const index = Math.floor((from + t) / rate / acoustic.frameSec);
      return series[Math.min(series.length - 1, index)] ?? 0;
    };
    for (const vowel of LIPSYNC_VOWELS) vowelShare[vowel] = new Float64Array(T);
    for (let t = 0; t < T; t += 1) {
      dense[t] = Math.min(1, at("density", t) / 0.3);
      let total = 0.05;
      for (const vowel of LIPSYNC_VOWELS) total += at(vowel, t);
      for (const vowel of LIPSYNC_VOWELS) {
        vowelShare[vowel]![t] = at(vowel, t) / total;
      }
    }
  }

  // Prefix sums of log emission probabilities, for constant-time span scores.
  const cache = new Map<string, Float64Array>();
  const emission = (key: string, probability: (t: number) => number) => {
    let prefix = cache.get(key);
    if (!prefix) {
      prefix = new Float64Array(T + 1);
      for (let t = 0; t < T; t += 1) {
        prefix[t + 1] = prefix[t]! + Math.log(probability(t) + LOG_EPS);
      }
      cache.set(key, prefix);
    }
    return prefix;
  };
  const speechLike = (t: number) => speech[t]! * (0.3 + 0.7 * voiced[t]!);
  // With a phone model, a sound with few phones is less likely speech.
  const notSpeech = (t: number) => (acoustic ? 1 - 0.8 * dense[t]! : 1);
  const emissions = {
    speech: () => emission("speech", speechLike),
    whisper: () => emission("whisper", (t) => speech[t]!),
    vowel: (vowel: LipSyncVowel, whisper: boolean) =>
      emission(`vowel:${vowel}:${whisper}`, (t) => {
        const base = whisper ? speech[t]! : speechLike(t);
        return (
          base * (0.2 + 0.8 * vowelShare[vowel]![t]!) * (0.1 + 0.9 * dense[t]!)
        );
      }),
    // Lips together: quiet (a stop) or voiced (a hum), never a loud breath.
    closure: () =>
      emission(
        "closure",
        (t) => 0.3 + 0.7 * Math.max(1 - speech[t]!, voiced[t]!),
      ),
    silence: () => emission("silence", (t) => 1 - speech[t]!),
    // A pause may be silent or hold an unscripted breath: quiet, or audible
    // but not speech.
    pause: () =>
      emission("pause", (t) =>
        acoustic
          ? 1 - speech[t]! + speech[t]! * (1 - dense[t]!) * 0.6
          : 1 - speech[t]! + speech[t]! * (1 - voiced[t]!) * 0.4,
      ),
    laugh: () =>
      emission("laugh", (t) => (0.15 + 0.6 * speech[t]!) * notSpeech(t)),
    // Sighs, gasps and other vocal sounds: audible and mostly unvoiced.
    breath: () =>
      emission(
        "breath",
        (t) => (0.05 + speech[t]! * (1 - 0.85 * voiced[t]!)) * notSpeech(t),
      ),
    any: () => emission("any", () => 0.5),
  };

  let framesPerWeight = options.framesPerWeight;
  if (framesPerWeight === undefined) {
    // Speaking rate: active frames shared by the speech units' weights.
    let active = 0;
    for (let t = 0; t < T; t += 1) active += speech[t]! > 0.5 ? 1 : 0;
    const { tagSec, speechWeight } = unitLoad(units);
    framesPerWeight = Math.max(
      4,
      Math.min(30, (active - tagSec * rate * 0.8) / Math.max(1, speechWeight)),
    );
  }

  const windowFrames = (index: number): [number, number] | undefined => {
    const window = options.windows?.[index];
    if (!window) return undefined;
    return [
      Math.floor((window.startSec - window.toleranceSec) * rate) - from,
      Math.ceil((window.endSec + window.toleranceSec) * rate) - from,
    ];
  };

  const edge = (): State => ({
    unit: null,
    optional: true,
    minF: 1,
    maxF: Math.min(T, MAX_EDGE_FRAMES),
    meanF: 25,
    sigma: 3,
    emission: emissions.silence(),
  });
  const states: State[] = [edge()];
  units.forEach((unit, index) => {
    const window = windowFrames(index);
    if (unit.kind === "pause") {
      const mean = Math.max(3, unit.weight * rate);
      states.push({
        unit,
        optional: true,
        minF: 2,
        maxF: Math.round(mean * 6),
        meanF: mean,
        sigma: 1,
        window,
        emission: emissions.pause(),
      });
    } else if (unit.kind === "tag") {
      const kind = unit.tag!.kind;
      const mean = unit.weight * rate;
      states.push({
        unit,
        optional: false,
        minF: 5,
        maxF: Math.round(mean * 4),
        meanF: mean,
        sigma: 0.7,
        window,
        emission:
          kind === "laugh"
            ? emissions.laugh()
            : kind === "sigh" || kind === "gasp" || kind === "vocal"
              ? emissions.breath()
              : kind === "pause"
                ? emissions.silence()
                : emissions.any(),
      });
    } else {
      const mean = unit.weight * framesPerWeight;
      states.push({
        unit,
        optional: false,
        minF: 1,
        maxF: Math.max(4, Math.round(mean * 3.5)),
        meanF: Math.max(1, mean),
        sigma: 0.55,
        window,
        emission:
          unit.kind === "closure" || unit.kind === "nasal"
            ? emissions.closure()
            : acoustic && unit.kind === "syllable" && unit.vowel
              ? emissions.vowel(unit.vowel, !!unit.whisper)
              : unit.whisper
                ? emissions.whisper()
                : emissions.speech(),
      });
    }
  });
  states.push(edge());
  return viterbi(states, T, !!options.partial).map((span) => ({
    unit: span.unit,
    startSec: (from + span.start) / rate,
    endSec: (from + span.end) / rate,
  }));
}

/**
 * The cheapest path through the states over `T` frames. In a partial plan the
 * path may end in any state, and the last unit may still be sounding: its
 * duration prior only penalises it for running long.
 */
function viterbi(states: State[], T: number, partial: boolean) {
  const INF = 1e18;
  const S = states.length;
  let previous = new Float64Array(T + 1).fill(INF);
  previous[0] = 0;
  const back: Int32Array[] = [];
  /** For partial plans: the cost of ending in each state, still open, and its start. */
  const openCost = new Float64Array(S).fill(INF);
  const openFrom = new Int32Array(S).fill(-1);
  for (let s = 0; s < S; s += 1) {
    const state = states[s]!;
    const prefix = state.emission;
    const current = new Float64Array(T + 1).fill(INF);
    const from = new Int32Array(T + 1).fill(-1);
    const logMean = Math.log(state.meanF);
    // The duration prior's cost for each length, computed once per state.
    const maxF = Math.min(state.maxF, T);
    const durationCost = new Float64Array(maxF + 1);
    for (let d = 1; d <= maxF; d += 1) {
      const z = (Math.log(d) - logMean) / state.sigma;
      durationCost[d] = 0.5 * z * z;
    }
    const windowCost = (a: number, t: number) =>
      state.window
        ? WINDOW_COST *
          (Math.max(0, state.window[0] - a) + Math.max(0, t - state.window[1]))
        : 0;
    for (let t = 0; t <= T; t += 1) {
      if (state.optional && previous[t]! + SKIP_PAUSE_COST < current[t]!) {
        current[t] = previous[t]! + SKIP_PAUSE_COST;
        from[t] = t;
      }
      const low = Math.max(0, t - maxF);
      for (let a = t - state.minF; a >= low; a -= 1) {
        const p = previous[a]!;
        if (p >= INF) continue;
        const cost =
          p -
          (prefix[t]! - prefix[a]!) +
          durationCost[t - a]! +
          windowCost(a, t);
        if (cost < current[t]!) {
          current[t] = cost;
          from[t] = a;
        }
      }
    }
    if (partial && state.unit) {
      // Only a tag, long enough to matter, may end open; a cut-short syllable
      // still pays its full prior, which keeps partial plans from lagging.
      const open = state.unit.kind === "tag";
      for (let a = T - 1; a >= Math.max(0, T - maxF); a -= 1) {
        const p = previous[a]!;
        if (p >= INF) continue;
        const d = T - a;
        const duration = open && d < state.meanF ? 0 : durationCost[d]!;
        const cost =
          p - (prefix[T]! - prefix[a]!) + duration + windowCost(a, T);
        if (cost < openCost[s]!) {
          openCost[s] = cost;
          openFrom[s] = a;
        }
      }
    }
    back.push(from);
    previous = current;
  }
  let last = S - 1;
  let lastFrom = back[last]![T]!;
  if (partial) {
    let best = previous[T]!;
    for (let s = 0; s < S; s += 1) {
      if (openCost[s]! < best) {
        best = openCost[s]!;
        last = s;
        lastFrom = openFrom[s]!;
      }
    }
  }
  const out: Array<{ unit: LipSyncUnit; start: number; end: number }> = [];
  let t = T;
  for (let s = last; s >= 0; s -= 1) {
    const a = s === last ? lastFrom : back[s]![t]!;
    const unit = states[s]!.unit;
    if (unit && a >= 0 && a < t) out.push({ unit, start: a, end: t });
    if (a < 0) break;
    t = a;
  }
  return out.reverse();
}
