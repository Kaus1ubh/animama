import type {
  SpeechGestureBeat,
  SpeechGestureTimeline,
  SpeechGestureWordTiming,
} from "./speech-gesture-timeline";

type PhonemizedText = string[][] | null | undefined;

export const VOWEL_VISEME_FPS = 60;

type VowelKey = "A" | "E" | "I" | "O" | "U";

export type VowelVisemeValues = Record<VowelKey, number>;

export type VowelVisemeKeyframe = VowelVisemeValues & {
  frameIndex: number;
  timeSec: number;
};

export type {
  SpeechGestureBeat,
  SpeechGestureTimeline,
  SpeechGestureWordTiming,
} from "./speech-gesture-timeline";

export type GruutVisemeKeyframePlan = {
  fps: number;
  durationSec: number;
  durationMs: number;
  frameCount: number;
  confidence: "high" | "medium";
  basis: "phoneme_viseme_plan";
  keyframes: VowelVisemeKeyframe[];
  speechGestureTimeline: SpeechGestureTimeline;
  features: {
    wordCount: number;
    phonemeCount: number;
    mappedPhonemeCount: number;
    unmappedPhonemeCount: number;
    commaPauseCount: number;
    clausePauseCount: number;
    sentencePauseCount: number;
    ellipsisPauseCount: number;
    lineBreakPauseCount: number;
    paragraphPauseCount: number;
    neutralFrameCount: number;
    neutralFrameRatio: number;
    alignmentStatus: "ok" | "count_mismatch" | "no_tokenized_text";
  };
  diagnostics: {
    unmappedPhonemesSample: string[];
  };
};

export type BuildGruutVisemeKeyframesInput = {
  phonemizedText?: PhonemizedText;
  tokenizedText?: string | null;
  fps?: number;
  targetDurationSec?: number | null;
};

type NormalizedPhoneme = {
  raw: string;
  value: string;
  primaryStress: boolean;
  secondaryStress: boolean;
  longMark: boolean;
};

type PunctuationAnalysis = {
  pausesAfterWordMs: number[];
  leadingPauseMs: number;
  commaPauseCount: number;
  clausePauseCount: number;
  sentencePauseCount: number;
  ellipsisPauseCount: number;
  lineBreakPauseCount: number;
  paragraphPauseCount: number;
  alignmentStatus: "ok" | "count_mismatch" | "no_tokenized_text";
};

type PhonemeTimingClass =
  | "stop"
  | "affricate"
  | "fricative"
  | "nasal"
  | "approximant"
  | "vowel"
  | "diphthong"
  | "unknown";

type StaticMotion = {
  kind: "static";
  target: VowelVisemeValues;
};

type DiphthongMotion = {
  kind: "diphthong";
  from: VowelVisemeValues;
  to: VowelVisemeValues;
};

type SilentMotion = {
  kind: "silent";
};

type PhonemeMotion = StaticMotion | DiphthongMotion | SilentMotion;

type PhonemeClassification = {
  timingClass: PhonemeTimingClass;
  durationMs: number;
  motion: PhonemeMotion;
  mapped: boolean;
  unmappedSample?: string;
};

type LocalControlPoint = {
  timeSec: number;
  values: VowelVisemeValues;
};

type PhonemeEvent = {
  kind: "phoneme";
  unitIndex: number;
  startSec: number;
  endSec: number;
  points: LocalControlPoint[];
};

type PhonemeUnit = {
  index: number;
  wordIndex: number;
  wordPhonemeIndex: number;
  phoneme: NormalizedPhoneme;
  classification: PhonemeClassification;
  startSec: number;
  endSec: number;
  hasPauseBefore: boolean;
  hasPauseAfter: boolean;
};

const MIN_DURATION_MS = 250;
const MAX_DURATION_MS = 120_000;
const EPS = 1e-6;
const COARTICULATION_OVERLAP_SEC = 0.06;
const NEUTRAL_FRAME_THRESHOLD = 0.03;
const STATIC_ATTACK_MAX_SEC = 0.045;
const STATIC_RELEASE_MAX_SEC = 0.075;
const DIPHTHONG_ATTACK_MAX_SEC = 0.04;
const DIPHTHONG_RELEASE_MAX_SEC = 0.07;
const KEYFRAME_SMOOTHING_WEIGHTS = [1, 2, 3, 2, 1] as const;
const KEYFRAME_SMOOTHING_RADIUS = Math.floor(
  KEYFRAME_SMOOTHING_WEIGHTS.length / 2,
);
const KEYFRAME_SMOOTHING_SILENCE_THRESHOLD = 0.01;

const DURATION_MS = {
  stop: 38,
  affricate: 70,
  fricative: 60,
  nasal: 55,
  approximant: 55,
  vowel: 85,
  diphthong: 120,
  unknown: 50,
} as const;

const PUNCTUATION_PAUSE_MS = {
  comma: 120,
  clause: 170,
  sentence: 260,
  ellipsis: 450,
  lineBreak: 180,
  paragraph: 320,
} as const;

const ZERO_VISEME: VowelVisemeValues = {
  A: 0,
  E: 0,
  I: 0,
  O: 0,
  U: 0,
};

const IPA_DIPHTHONGS = new Set(["aɪ", "aʊ", "eɪ", "oʊ", "ɔɪ"]);
const STOPS = new Set(["p", "b", "t", "d", "k", "g", "ɡ", "ʔ", "ɾ"]);
const AFFRICATES = new Set(["tʃ", "dʒ", "t͡ʃ", "d͡ʒ"]);
const FRICATIVES = new Set(["f", "v", "s", "z", "ʃ", "ʒ", "θ", "ð", "h"]);
const NASALS = new Set(["m", "n", "ŋ"]);
const APPROXIMANTS = new Set(["j", "w", "ɹ", "r", "l"]);

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundMs(value: number): number {
  return Math.round(value);
}

function normalizeDurationMs(value: number): number {
  return clamp(value, MIN_DURATION_MS, MAX_DURATION_MS);
}

function cloneValues(values: VowelVisemeValues): VowelVisemeValues {
  return { ...values };
}

function sumValues(values: VowelVisemeValues): number {
  return values.A + values.E + values.I + values.O + values.U;
}

function addValues(
  a: VowelVisemeValues,
  b: VowelVisemeValues,
): VowelVisemeValues {
  return {
    A: a.A + b.A,
    E: a.E + b.E,
    I: a.I + b.I,
    O: a.O + b.O,
    U: a.U + b.U,
  };
}

function scaleValues(
  values: VowelVisemeValues,
  factor: number,
): VowelVisemeValues {
  return clampNormalizeValues({
    A: values.A * factor,
    E: values.E * factor,
    I: values.I * factor,
    O: values.O * factor,
    U: values.U * factor,
  });
}

function clampNormalizeValues(values: VowelVisemeValues): VowelVisemeValues {
  const clamped: VowelVisemeValues = {
    A: clamp(values.A, 0, 1),
    E: clamp(values.E, 0, 1),
    I: clamp(values.I, 0, 1),
    O: clamp(values.O, 0, 1),
    U: clamp(values.U, 0, 1),
  };
  const total = sumValues(clamped);
  if (total <= 1 || total <= EPS) return clamped;
  return {
    A: clamped.A / total,
    E: clamped.E / total,
    I: clamped.I / total,
    O: clamped.O / total,
    U: clamped.U / total,
  };
}

function lerpValues(
  a: VowelVisemeValues,
  b: VowelVisemeValues,
  alpha: number,
): VowelVisemeValues {
  const safeAlpha = clamp(alpha, 0, 1);
  return clampNormalizeValues({
    A: a.A + (b.A - a.A) * safeAlpha,
    E: a.E + (b.E - a.E) * safeAlpha,
    I: a.I + (b.I - a.I) * safeAlpha,
    O: a.O + (b.O - a.O) * safeAlpha,
    U: a.U + (b.U - a.U) * safeAlpha,
  });
}

function hasEnergy(values: VowelVisemeValues): boolean {
  return sumValues(values) > EPS;
}

function isSpeechGestureNucleus(unit: PhonemeUnit): boolean {
  return (
    unit.classification.timingClass === "vowel" ||
    unit.classification.timingClass === "diphthong"
  );
}

function getNucleusBeatTimeSec(unit: PhonemeUnit): number {
  return (unit.startSec + unit.endSec) / 2;
}

function buildSpeechGestureTimeline(
  units: readonly PhonemeUnit[],
  durationSec: number,
  durationMs: number,
): SpeechGestureTimeline {
  const beats: SpeechGestureBeat[] = [];
  const wordTimingByIndex = new Map<number, SpeechGestureWordTiming>();

  let wordIndex = -1;
  let pendingPrimaryStress = false;

  for (const unit of units) {
    const existingWordTiming = wordTimingByIndex.get(unit.wordIndex);
    if (existingWordTiming) {
      existingWordTiming.startSec = Math.min(
        existingWordTiming.startSec,
        unit.startSec,
      );
      existingWordTiming.endSec = Math.max(
        existingWordTiming.endSec,
        unit.endSec,
      );
    } else {
      wordTimingByIndex.set(unit.wordIndex, {
        wordIndex: unit.wordIndex,
        startSec: unit.startSec,
        endSec: unit.endSec,
      });
    }

    if (unit.wordIndex !== wordIndex) {
      wordIndex = unit.wordIndex;
      pendingPrimaryStress = false;
    }

    if (unit.phoneme.primaryStress) {
      pendingPrimaryStress = true;
    }

    if (!isSpeechGestureNucleus(unit)) {
      continue;
    }

    const hasPrimaryStress = unit.phoneme.primaryStress || pendingPrimaryStress;
    pendingPrimaryStress = false;

    if (hasPrimaryStress) {
      beats.push({
        timeSec: getNucleusBeatTimeSec(unit),
        wordIndex: unit.wordIndex,
        phonemeIndex: unit.index,
        phoneme: unit.phoneme.value,
      });
    }
  }

  return {
    utteranceDurationSec: durationSec,
    durationSec,
    durationMs,
    wordTimings: Array.from(wordTimingByIndex.values()).sort(
      (left, right) => left.wordIndex - right.wordIndex,
    ),
    beats,
    features: {
      primaryStressCount: beats.length,
      wordCount: wordTimingByIndex.size,
    },
  };
}

function normalizePhoneme(raw: unknown): NormalizedPhoneme | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  return {
    raw: trimmed,
    value: trimmed.replace(/[ˈˌː]/g, "").trim(),
    primaryStress: trimmed.includes("ˈ"),
    secondaryStress: trimmed.includes("ˌ"),
    longMark: trimmed.includes("ː"),
  };
}

function tokenizeTokenizedText(text: string): string[] {
  const matches = text.match(/\n{2,}|\n|\.{3}|…|[A-Za-z0-9']+|[,:;.!?]/g);
  return matches ?? [];
}

function analyzePunctuation(
  tokenizedText: string | null | undefined,
  spokenWordCount: number,
): PunctuationAnalysis {
  const pausesAfterWordMs = new Array(Math.max(0, spokenWordCount)).fill(0);
  if (!tokenizedText || !tokenizedText.trim()) {
    return {
      pausesAfterWordMs,
      leadingPauseMs: 0,
      commaPauseCount: 0,
      clausePauseCount: 0,
      sentencePauseCount: 0,
      ellipsisPauseCount: 0,
      lineBreakPauseCount: 0,
      paragraphPauseCount: 0,
      alignmentStatus: "no_tokenized_text",
    };
  }

  const tokens = tokenizeTokenizedText(tokenizedText);
  let seenWordCount = 0;
  let latestWordIndex = -1;
  let leadingPauseMs = 0;
  let commaPauseCount = 0;
  let clausePauseCount = 0;
  let sentencePauseCount = 0;
  let ellipsisPauseCount = 0;
  let lineBreakPauseCount = 0;
  let paragraphPauseCount = 0;

  const applyPause = (ms: number) => {
    if (latestWordIndex >= 0 && latestWordIndex < pausesAfterWordMs.length) {
      pausesAfterWordMs[latestWordIndex] += ms;
      return;
    }
    leadingPauseMs += ms;
  };

  for (const token of tokens) {
    if (/^[A-Za-z0-9']+$/.test(token)) {
      latestWordIndex = seenWordCount;
      seenWordCount += 1;
      continue;
    }

    if (token === "..." || token === "…") {
      ellipsisPauseCount += 1;
      applyPause(PUNCTUATION_PAUSE_MS.ellipsis);
      continue;
    }
    if (/^\n{2,}$/.test(token)) {
      paragraphPauseCount += 1;
      applyPause(PUNCTUATION_PAUSE_MS.paragraph);
      continue;
    }
    if (token === "\n") {
      lineBreakPauseCount += 1;
      applyPause(PUNCTUATION_PAUSE_MS.lineBreak);
      continue;
    }
    if (token === ",") {
      commaPauseCount += 1;
      applyPause(PUNCTUATION_PAUSE_MS.comma);
      continue;
    }
    if (token === ";" || token === ":") {
      clausePauseCount += 1;
      applyPause(PUNCTUATION_PAUSE_MS.clause);
      continue;
    }
    if (token === "." || token === "!" || token === "?") {
      sentencePauseCount += 1;
      applyPause(PUNCTUATION_PAUSE_MS.sentence);
    }
  }

  const alignmentStatus =
    seenWordCount === spokenWordCount ? "ok" : "count_mismatch";

  return {
    pausesAfterWordMs,
    leadingPauseMs,
    commaPauseCount,
    clausePauseCount,
    sentencePauseCount,
    ellipsisPauseCount,
    lineBreakPauseCount,
    paragraphPauseCount,
    alignmentStatus,
  };
}

function makeValues(
  A: number,
  E: number,
  I: number,
  O: number,
  U: number,
): VowelVisemeValues {
  return clampNormalizeValues({ A, E, I, O, U });
}

function getStaticVowelTarget(phoneme: string): VowelVisemeValues | null {
  switch (phoneme) {
    case "a":
    case "ɑ":
    case "ɐ":
    case "æ":
    case "ʌ":
      return makeValues(1, 0, 0, 0, 0);

    case "e":
    case "ɛ":
    case "ɜ":
      return makeValues(0.05, 1, 0.15, 0, 0);
    case "ə":
    case "ɚ":
    case "ɝ":
      return makeValues(0.03, 0.55, 0.08, 0.05, 0.05);

    case "i":
      return makeValues(0, 0.15, 1, 0, 0);
    case "ɪ":
      return makeValues(0, 0.2, 0.85, 0, 0);

    case "o":
      return makeValues(0, 0, 0, 1, 0.15);
    case "ɔ":
      return makeValues(0.1, 0, 0, 0.9, 0.1);
    case "ɒ":
      return makeValues(0.2, 0, 0, 0.75, 0);

    case "u":
      return makeValues(0, 0, 0.05, 0.2, 1);
    case "ʊ":
      return makeValues(0, 0, 0.05, 0.25, 0.75);
    default:
      return null;
  }
}

function getDiphthongTargets(
  phoneme: string,
): { from: VowelVisemeValues; to: VowelVisemeValues } | null {
  switch (phoneme) {
    case "aɪ":
      return {
        from: makeValues(1, 0, 0, 0, 0),
        to: makeValues(0, 0.15, 1, 0, 0),
      };
    case "aʊ":
      return {
        from: makeValues(1, 0, 0, 0, 0),
        to: makeValues(0, 0, 0.05, 0.2, 1),
      };
    case "eɪ":
      return {
        from: makeValues(0.05, 1, 0.15, 0, 0),
        to: makeValues(0, 0.15, 1, 0, 0),
      };
    case "oʊ":
      return {
        from: makeValues(0, 0, 0, 1, 0.15),
        to: makeValues(0, 0, 0.05, 0.2, 1),
      };
    case "ɔɪ":
      return {
        from: makeValues(0.1, 0, 0, 0.9, 0.1),
        to: makeValues(0, 0.15, 1, 0, 0),
      };
    default:
      return null;
  }
}

function classifyPhoneme(phoneme: NormalizedPhoneme): PhonemeClassification {
  const p = phoneme.value;
  if (!p) {
    return {
      timingClass: "unknown",
      durationMs: DURATION_MS.unknown,
      motion: { kind: "silent" },
      mapped: false,
      unmappedSample: p,
    };
  }

  let timingClass: PhonemeTimingClass = "unknown";
  if (IPA_DIPHTHONGS.has(p)) timingClass = "diphthong";
  else if (getStaticVowelTarget(p)) timingClass = "vowel";
  else if (AFFRICATES.has(p)) timingClass = "affricate";
  else if (STOPS.has(p)) timingClass = "stop";
  else if (FRICATIVES.has(p)) timingClass = "fricative";
  else if (NASALS.has(p)) timingClass = "nasal";
  else if (APPROXIMANTS.has(p)) timingClass = "approximant";

  let durationMs = DURATION_MS[timingClass];
  if (phoneme.primaryStress) durationMs *= 1.2;
  else if (phoneme.secondaryStress) durationMs *= 1.1;
  if (phoneme.longMark) durationMs *= 1.3;
  if (p === "ə" || p === "ɚ" || p === "ɝ") {
    durationMs *= 0.8;
  }

  if (timingClass === "diphthong") {
    const targets = getDiphthongTargets(p);
    if (targets) {
      return {
        timingClass,
        durationMs,
        motion: { kind: "diphthong", ...targets },
        mapped: true,
      };
    }
  }

  if (timingClass === "vowel") {
    const target = getStaticVowelTarget(p);
    if (target) {
      return {
        timingClass,
        durationMs,
        motion: { kind: "static", target },
        mapped: true,
      };
    }
  }

  if (p === "j") {
    return {
      timingClass: "approximant",
      durationMs,
      motion: { kind: "static", target: makeValues(0, 0.1, 0.45, 0, 0) },
      mapped: true,
    };
  }
  if (p === "w") {
    return {
      timingClass: "approximant",
      durationMs,
      motion: { kind: "static", target: makeValues(0, 0, 0, 0.2, 0.55) },
      mapped: true,
    };
  }
  if (p === "ɹ" || p === "r") {
    return {
      timingClass: "approximant",
      durationMs,
      motion: { kind: "static", target: makeValues(0.05, 0.25, 0.05, 0.2, 0) },
      mapped: true,
    };
  }
  if (p === "l") {
    return {
      timingClass: "approximant",
      durationMs,
      motion: { kind: "static", target: makeValues(0, 0.2, 0.12, 0, 0) },
      mapped: true,
    };
  }

  if (timingClass !== "unknown") {
    return {
      timingClass,
      durationMs,
      motion: { kind: "silent" },
      mapped: true,
    };
  }

  return {
    timingClass,
    durationMs,
    motion: { kind: "silent" },
    mapped: false,
    unmappedSample: p,
  };
}

function getMotionAnchorStart(motion: PhonemeMotion): VowelVisemeValues | null {
  if (motion.kind === "static") return motion.target;
  if (motion.kind === "diphthong") return motion.from;
  return null;
}

function getMotionAnchorEnd(motion: PhonemeMotion): VowelVisemeValues | null {
  if (motion.kind === "static") return motion.target;
  if (motion.kind === "diphthong") return motion.to;
  return null;
}

function consonantCarryScale(timingClass: PhonemeTimingClass): number {
  switch (timingClass) {
    case "stop":
      return 0.18;
    case "affricate":
      return 0.24;
    case "fricative":
      return 0.28;
    case "nasal":
      return 0.35;
    case "approximant":
      return 0.38;
    case "unknown":
      return 0.2;
    default:
      return 0.2;
  }
}

function buildConsonantCarryMotion(
  timingClass: PhonemeTimingClass,
  prevAnchor: VowelVisemeValues | null,
  nextAnchor: VowelVisemeValues | null,
): PhonemeMotion {
  const scale = consonantCarryScale(timingClass);
  if (prevAnchor && nextAnchor) {
    return {
      kind: "diphthong",
      from: scaleValues(prevAnchor, scale),
      to: scaleValues(nextAnchor, Math.max(0.15, scale * 0.9)),
    };
  }
  if (prevAnchor) {
    return {
      kind: "static",
      target: scaleValues(prevAnchor, scale),
    };
  }
  if (nextAnchor) {
    return {
      kind: "static",
      target: scaleValues(nextAnchor, Math.max(0.15, scale * 0.85)),
    };
  }
  return { kind: "silent" };
}

function addPoint(
  points: LocalControlPoint[],
  timeSec: number,
  values: VowelVisemeValues,
): void {
  const safeTime = timeSec < 0 ? 0 : timeSec;
  const normalizedValues = clampNormalizeValues(values);
  const last = points[points.length - 1];
  if (!last || Math.abs(last.timeSec - safeTime) > EPS) {
    points.push({ timeSec: safeTime, values: normalizedValues });
    return;
  }
  points[points.length - 1] = { timeSec: safeTime, values: normalizedValues };
}

function buildStaticControlPoints(
  durationSec: number,
  target: VowelVisemeValues,
): LocalControlPoint[] {
  if (durationSec <= EPS) return [];
  return [
    { timeSec: 0, values: cloneValues(target) },
    { timeSec: durationSec, values: cloneValues(target) },
  ];
}

function buildDiphthongControlPoints(
  durationSec: number,
  from: VowelVisemeValues,
  to: VowelVisemeValues,
): LocalControlPoint[] {
  if (durationSec <= EPS) return [];
  const points: LocalControlPoint[] = [];
  const phases: Array<[number, VowelVisemeValues]> = [
    [0.0, from],
    [0.15, from],
    [0.45, from],
    [0.7, to],
    [0.85, to],
    [1.0, to],
  ];

  for (const [ratio, values] of phases) {
    addPoint(points, durationSec * ratio, values);
  }
  return points;
}

function buildCoarticulatedEventControlPoints(args: {
  eventDurationSec: number;
  coreStartLocalSec: number;
  coreEndLocalSec: number;
  motion: PhonemeMotion;
  hasPauseBefore: boolean;
  hasPauseAfter: boolean;
  isFirst: boolean;
  isLast: boolean;
}): LocalControlPoint[] {
  const {
    eventDurationSec,
    coreStartLocalSec,
    coreEndLocalSec,
    motion,
    hasPauseBefore,
    hasPauseAfter,
    isFirst,
    isLast,
  } = args;

  if (eventDurationSec <= EPS) return [];
  const points: LocalControlPoint[] = [];
  const coreDurSec = Math.max(EPS, coreEndLocalSec - coreStartLocalSec);

  const shouldZeroAtStart = hasPauseBefore || isFirst;
  const shouldZeroAtEnd = hasPauseAfter || isLast;

  if (motion.kind === "silent") {
    return [
      { timeSec: 0, values: cloneValues(ZERO_VISEME) },
      { timeSec: eventDurationSec, values: cloneValues(ZERO_VISEME) },
    ];
  }

  if (motion.kind === "static") {
    const corePoints = buildStaticControlPoints(coreDurSec, motion.target);
    if (corePoints.length === 0) return [];
    const preOverlapSec = Math.max(0, coreStartLocalSec);
    const postOverlapSec = Math.max(0, eventDurationSec - coreEndLocalSec);
    const target = motion.target;

    if (preOverlapSec > EPS) {
      addPoint(points, 0, ZERO_VISEME);
      addPoint(points, coreStartLocalSec, target);
    } else if (shouldZeroAtStart) {
      const attackSec = Math.min(STATIC_ATTACK_MAX_SEC, coreDurSec * 0.4);
      addPoint(points, 0, ZERO_VISEME);
      addPoint(points, Math.min(coreEndLocalSec, attackSec), target);
    } else {
      addPoint(points, 0, target);
    }

    addPoint(points, coreEndLocalSec, target);

    if (postOverlapSec > EPS) {
      addPoint(points, eventDurationSec, ZERO_VISEME);
    } else if (shouldZeroAtEnd) {
      const releaseSec = Math.min(STATIC_RELEASE_MAX_SEC, coreDurSec * 0.45);
      const releaseStartSec = Math.max(0, coreEndLocalSec - releaseSec);
      addPoint(points, releaseStartSec, target);
      addPoint(points, coreEndLocalSec, ZERO_VISEME);
    } else {
      addPoint(points, eventDurationSec, target);
    }
    return points;
  }

  const corePoints = buildDiphthongControlPoints(
    coreDurSec,
    motion.from,
    motion.to,
  );
  if (corePoints.length === 0) return [];
  const preOverlapSec = Math.max(0, coreStartLocalSec);
  const postOverlapSec = Math.max(0, eventDurationSec - coreEndLocalSec);
  if (preOverlapSec > EPS) {
    addPoint(points, 0, ZERO_VISEME);
  } else if (shouldZeroAtStart) {
    const attackSec = Math.min(DIPHTHONG_ATTACK_MAX_SEC, coreDurSec * 0.3);
    addPoint(points, 0, ZERO_VISEME);
    addPoint(points, Math.min(coreEndLocalSec, attackSec), motion.from);
  }
  for (const point of corePoints) {
    addPoint(points, coreStartLocalSec + point.timeSec, point.values);
  }
  if (postOverlapSec > EPS) {
    addPoint(points, eventDurationSec, ZERO_VISEME);
  } else if (shouldZeroAtEnd) {
    const releaseSec = Math.min(DIPHTHONG_RELEASE_MAX_SEC, coreDurSec * 0.35);
    const releaseStartSec = Math.max(0, coreEndLocalSec - releaseSec);
    addPoint(points, releaseStartSec, motion.to);
    addPoint(points, eventDurationSec, ZERO_VISEME);
  }
  return points;
}

function sampleLocalControlPoints(
  points: LocalControlPoint[],
  timeSec: number,
): VowelVisemeValues {
  if (points.length === 0) return cloneValues(ZERO_VISEME);
  if (timeSec <= points[0]!.timeSec + EPS) {
    return cloneValues(points[0]!.values);
  }

  const last = points[points.length - 1]!;
  if (timeSec >= last.timeSec - EPS) return cloneValues(last.values);

  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i]!;
    const p1 = points[i + 1]!;
    if (timeSec < p0.timeSec - EPS || timeSec > p1.timeSec + EPS) continue;
    const span = Math.max(EPS, p1.timeSec - p0.timeSec);
    const alpha = (timeSec - p0.timeSec) / span;
    return lerpValues(p0.values, p1.values, alpha);
  }
  return cloneValues(ZERO_VISEME);
}

function keyframeEnergy(frame: VowelVisemeKeyframe): number {
  return frame.A + frame.E + frame.I + frame.O + frame.U;
}

function smoothVowelVisemeKeyframes(
  keyframes: VowelVisemeKeyframe[],
): VowelVisemeKeyframe[] {
  if (keyframes.length <= 2) return keyframes;

  return keyframes.map((frame, index) => {
    let weightedA = 0;
    let weightedE = 0;
    let weightedI = 0;
    let weightedO = 0;
    let weightedU = 0;
    let totalWeight = 0;
    let neighborHasEnergy =
      keyframeEnergy(frame) > KEYFRAME_SMOOTHING_SILENCE_THRESHOLD;

    for (
      let offset = -KEYFRAME_SMOOTHING_RADIUS;
      offset <= KEYFRAME_SMOOTHING_RADIUS;
      offset += 1
    ) {
      const neighborIndex = index + offset;
      if (neighborIndex < 0 || neighborIndex >= keyframes.length) continue;
      const weight =
        KEYFRAME_SMOOTHING_WEIGHTS[offset + KEYFRAME_SMOOTHING_RADIUS] ?? 0;
      if (weight <= 0) continue;
      const neighbor = keyframes[neighborIndex]!;
      if (keyframeEnergy(neighbor) > KEYFRAME_SMOOTHING_SILENCE_THRESHOLD) {
        neighborHasEnergy = true;
      }

      weightedA += neighbor.A * weight;
      weightedE += neighbor.E * weight;
      weightedI += neighbor.I * weight;
      weightedO += neighbor.O * weight;
      weightedU += neighbor.U * weight;
      totalWeight += weight;
    }

    if (!neighborHasEnergy || totalWeight <= 0) {
      return frame;
    }

    const smoothed = clampNormalizeValues({
      A: weightedA / totalWeight,
      E: weightedE / totalWeight,
      I: weightedI / totalWeight,
      O: weightedO / totalWeight,
      U: weightedU / totalWeight,
    });

    return {
      frameIndex: frame.frameIndex,
      timeSec: frame.timeSec,
      A: smoothed.A,
      E: smoothed.E,
      I: smoothed.I,
      O: smoothed.O,
      U: smoothed.U,
    };
  });
}

export function buildGruutVisemeKeyframes({
  phonemizedText,
  tokenizedText,
  fps = VOWEL_VISEME_FPS,
  targetDurationSec = null,
}: BuildGruutVisemeKeyframesInput): GruutVisemeKeyframePlan | null {
  if (!Array.isArray(phonemizedText) || phonemizedText.length === 0) {
    return null;
  }

  const spokenWords = phonemizedText
    .map((word) =>
      Array.isArray(word)
        ? word
            .map((ph) => normalizePhoneme(ph))
            .filter((ph): ph is NormalizedPhoneme => ph !== null)
        : [],
    )
    .filter((word): word is NormalizedPhoneme[] => Array.isArray(word));

  const wordCount = spokenWords.length;
  const punctuation = analyzePunctuation(tokenizedText, wordCount);

  const units: PhonemeUnit[] = [];
  let currentMs = punctuation.leadingPauseMs;
  let phonemeCount = 0;
  let mappedPhonemeCount = 0;
  let unmappedPhonemeCount = 0;
  const unmappedSamples = new Set<string>();

  for (let wordIndex = 0; wordIndex < spokenWords.length; wordIndex += 1) {
    const wordPhonemes = spokenWords[wordIndex]!;
    for (
      let wordPhonemeIndex = 0;
      wordPhonemeIndex < wordPhonemes.length;
      wordPhonemeIndex += 1
    ) {
      const phoneme = wordPhonemes[wordPhonemeIndex]!;
      if (!phoneme.value) continue;
      phonemeCount += 1;
      const classification = classifyPhoneme(phoneme);
      if (classification.mapped) {
        mappedPhonemeCount += 1;
      } else {
        unmappedPhonemeCount += 1;
        if (
          classification.unmappedSample &&
          unmappedSamples.size < 16 &&
          classification.unmappedSample.trim()
        ) {
          unmappedSamples.add(classification.unmappedSample);
        }
      }

      const durationMs = Math.max(1, classification.durationMs);
      const startSec = currentMs / 1000;
      currentMs += durationMs;
      const endSec = currentMs / 1000;

      units.push({
        index: units.length,
        wordIndex,
        wordPhonemeIndex,
        phoneme,
        classification,
        startSec,
        endSec,
        hasPauseBefore: false,
        hasPauseAfter: false,
      });
    }

    if (wordIndex < punctuation.pausesAfterWordMs.length) {
      const pauseAfterWordMs = punctuation.pausesAfterWordMs[wordIndex] ?? 0;
      if (pauseAfterWordMs > 0) {
        const lastUnit = units[units.length - 1];
        if (lastUnit) {
          lastUnit.hasPauseAfter = true;
        }
      }
      currentMs += pauseAfterWordMs;
    }
  }

  if (phonemeCount <= 0) {
    return null;
  }

  const baselineTimelineMs = Math.max(1, currentMs);
  const requestedTargetDurationMs =
    typeof targetDurationSec === "number" &&
    Number.isFinite(targetDurationSec) &&
    targetDurationSec > 0
      ? roundMs(normalizeDurationMs(targetDurationSec * 1000))
      : null;
  const durationMs =
    requestedTargetDurationMs ?? roundMs(normalizeDurationMs(currentMs));
  const timelineScale =
    requestedTargetDurationMs != null ? durationMs / baselineTimelineMs : 1;

  if (Math.abs(timelineScale - 1) > EPS) {
    for (const unit of units) {
      unit.startSec *= timelineScale;
      unit.endSec *= timelineScale;
    }
  }

  if (units[0] && punctuation.leadingPauseMs > 0) {
    units[0].hasPauseBefore = true;
  }
  for (let i = 1; i < units.length; i += 1) {
    units[i]!.hasPauseBefore = units[i - 1]!.hasPauseAfter;
  }

  const durationSec = durationMs / 1000;
  const speechGestureTimeline = buildSpeechGestureTimeline(
    units,
    durationSec,
    durationMs,
  );
  const safeFps =
    Number.isFinite(fps) && fps > 0
      ? Math.max(1, Math.round(fps))
      : VOWEL_VISEME_FPS;
  const frameCount = Math.max(1, Math.round(durationSec * safeFps));
  const confidence: "high" | "medium" =
    unmappedPhonemeCount > mappedPhonemeCount ? "medium" : "high";

  const findPrevAnchor = (index: number): VowelVisemeValues | null => {
    for (let j = index - 1; j >= 0; j -= 1) {
      const candidate = units[j]!;
      if (candidate.hasPauseAfter) break;
      const anchor = getMotionAnchorEnd(candidate.classification.motion);
      if (anchor && hasEnergy(anchor)) return anchor;
    }
    return null;
  };

  const findNextAnchor = (index: number): VowelVisemeValues | null => {
    for (let j = index + 1; j < units.length; j += 1) {
      const previous = units[j - 1]!;
      if (previous.hasPauseAfter) break;
      const candidate = units[j]!;
      const anchor = getMotionAnchorStart(candidate.classification.motion);
      if (anchor && hasEnergy(anchor)) return anchor;
    }
    return null;
  };

  const events: PhonemeEvent[] = [];
  for (let i = 0; i < units.length; i += 1) {
    const unit = units[i]!;
    const isFirst = i === 0;
    const isLast = i === units.length - 1;
    const overlapBeforeSec =
      isFirst || unit.hasPauseBefore ? 0 : COARTICULATION_OVERLAP_SEC;
    const overlapAfterSec =
      isLast || unit.hasPauseAfter ? 0 : COARTICULATION_OVERLAP_SEC;

    const eventStartSec = Math.max(0, unit.startSec - overlapBeforeSec);
    const eventEndSec = Math.min(durationSec, unit.endSec + overlapAfterSec);
    if (eventEndSec <= eventStartSec + EPS) {
      continue;
    }

    let motion = unit.classification.motion;
    if (motion.kind === "silent") {
      motion = buildConsonantCarryMotion(
        unit.classification.timingClass,
        findPrevAnchor(i),
        findNextAnchor(i),
      );
    }

    const coreStartLocalSec = Math.max(0, unit.startSec - eventStartSec);
    const coreEndLocalSec = Math.max(
      coreStartLocalSec,
      unit.endSec - eventStartSec,
    );
    const points = buildCoarticulatedEventControlPoints({
      eventDurationSec: eventEndSec - eventStartSec,
      coreStartLocalSec,
      coreEndLocalSec,
      motion,
      hasPauseBefore: unit.hasPauseBefore,
      hasPauseAfter: unit.hasPauseAfter,
      isFirst,
      isLast,
    });
    if (points.length === 0) continue;

    events.push({
      kind: "phoneme",
      unitIndex: unit.index,
      startSec: eventStartSec,
      endSec: eventEndSec,
      points,
    });
  }

  const rawKeyframes: VowelVisemeKeyframe[] = [];
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const timeSec = frameIndex / safeFps;
    let accumulated = cloneValues(ZERO_VISEME);

    for (const event of events) {
      if (timeSec < event.startSec - EPS) {
        continue;
      }
      if (timeSec > event.endSec + EPS) {
        continue;
      }
      const sample = sampleLocalControlPoints(
        event.points,
        timeSec - event.startSec,
      );
      accumulated = addValues(accumulated, sample);
    }

    const normalized = clampNormalizeValues(accumulated);
    rawKeyframes.push({
      frameIndex,
      timeSec,
      A: normalized.A,
      E: normalized.E,
      I: normalized.I,
      O: normalized.O,
      U: normalized.U,
    });
  }

  const keyframes = smoothVowelVisemeKeyframes(rawKeyframes);
  let neutralFrameCount = 0;
  for (const frame of keyframes) {
    if (sumValues(frame) < NEUTRAL_FRAME_THRESHOLD) {
      neutralFrameCount += 1;
    }
  }

  return {
    fps: safeFps,
    durationSec,
    durationMs,
    frameCount,
    confidence,
    basis: "phoneme_viseme_plan",
    keyframes,
    speechGestureTimeline,
    features: {
      wordCount,
      phonemeCount,
      mappedPhonemeCount,
      unmappedPhonemeCount,
      commaPauseCount: punctuation.commaPauseCount,
      clausePauseCount: punctuation.clausePauseCount,
      sentencePauseCount: punctuation.sentencePauseCount,
      ellipsisPauseCount: punctuation.ellipsisPauseCount,
      lineBreakPauseCount: punctuation.lineBreakPauseCount,
      paragraphPauseCount: punctuation.paragraphPauseCount,
      neutralFrameCount,
      neutralFrameRatio: frameCount > 0 ? neutralFrameCount / frameCount : 0,
      alignmentStatus: punctuation.alignmentStatus,
    },
    diagnostics: {
      unmappedPhonemesSample: Array.from(unmappedSamples),
    },
  };
}
