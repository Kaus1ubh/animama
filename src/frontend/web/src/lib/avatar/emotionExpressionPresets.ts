import type { ResolvedEmotionGroup } from "@/lib/emotion";

export type EmotionExpressionComposition = Record<string, number>;
export type EmotionExpressionIntensity = 1 | 2 | 3;
export type EmotionExpressionIntensityMap = Record<
  EmotionExpressionIntensity,
  EmotionExpressionComposition
>;

export const EMOTION_EXPRESSION_INTENSITIES = [1, 2, 3] as const;

// Not all VRMs will have Fcl_* expressions, use relaxed as fallback
const RELAXED_FALLBACK: EmotionExpressionIntensityMap = {
  1: { relaxed: 0.2 },
  2: { relaxed: 0.4 },
  3: { relaxed: 0.6 },
};

export const EMOTION_INTENSITY_MAP: Record<
  ResolvedEmotionGroup,
  EmotionExpressionIntensityMap
> = {
  affection: {
    1: { Fcl_MTH_Fun: 0.6 },
    2: { Fcl_MTH_Fun: 1.0, Fcl_MTH_Large: 0.1 },
    3: { Fcl_MTH_Fun: 1.0, Fcl_MTH_Large: 0.2 },
  },
  esteem: {
    1: { Fcl_MTH_Fun: 0.6 },
    2: { Fcl_MTH_Fun: 1.0, Fcl_MTH_Large: 0.1 },
    3: { Fcl_MTH_Fun: 1.0, Fcl_MTH_Large: 0.2 },
  },
  delight: {
    1: { Fcl_MTH_Fun: 0.6 },
    2: { Fcl_MTH_Fun: 1.0, Fcl_MTH_Joy: 0.1 },
    3: { Fcl_MTH_Fun: 1.0, Fcl_MTH_Joy: 0.2 },
  },
  drive: { 1: { neutral: 1.0 }, 2: { neutral: 1.0 }, 3: { neutral: 1.0 } },
  gloom: {
    1: { sad: 0.3 },
    2: { sad: 0.5 },
    3: { sad: 0.7 },
  },
  rejection: {
    1: { angry: 0.4 },
    2: { angry: 0.7 },
    3: { angry: 1.0 },
  },
  revulsion: {
    1: { angry: 0.15, sad: 0.15 },
    2: { angry: 0.25, sad: 0.25 },
    3: { angry: 0.4, sad: 0.4 },
  },
  alarm: {
    1: { surprised: 0.1 },
    2: { surprised: 0.25 },
    3: { surprised: 0.4 },
  },
  neutral: { 1: { neutral: 1.0 }, 2: { neutral: 1.0 }, 3: { neutral: 1.0 } },
};

export const EMOTION_INTENSITY_FALLBACK_MAP: Partial<
  Record<ResolvedEmotionGroup, EmotionExpressionIntensityMap>
> = {
  affection: RELAXED_FALLBACK,
  esteem: RELAXED_FALLBACK,
  delight: RELAXED_FALLBACK,
};
