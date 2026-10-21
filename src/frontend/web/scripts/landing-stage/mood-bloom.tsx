import { useEffect, useId, useMemo, useRef } from "react";
import {
  CloudRain,
  Crown,
  Flame,
  Frown,
  Heart,
  Sun,
  ThumbsDown,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  EMOTION_GROUP_MEMBERS,
  EMOTION_GROUPS,
  TRACKED_EMOTIONS,
  type EmotionGroup,
  type TrackedEmotion,
} from "@/lib/emotion";
import {
  EMOTION_PALETTE,
  buildEmotionPresentation,
  emotionLabel,
} from "@/lib/emotion/presentation";
import { cn } from "@/lib/utils";

/*
 * The Emotions stop's picture of her emotional state: a flower of her 24
 * emotions, fed the same eased 0–30 values as the bars beside it, so it
 * glides between reactions.
 */

const MAX = 30;
const reducedMotion = () =>
  matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The emotion group each emotion belongs to. */
const GROUP_OF = Object.fromEntries(
  EMOTION_GROUPS.flatMap((group) =>
    EMOTION_GROUP_MEMBERS[group].map((emotion) => [emotion, group]),
  ),
) as Record<TrackedEmotion, EmotionGroup>;

/** A little symbol for each emotion group. */
const GROUP_ICONS: Record<EmotionGroup, LucideIcon> = {
  affection: Heart,
  esteem: Crown,
  delight: Sun,
  drive: Flame,
  alarm: Zap,
  rejection: ThumbsDown,
  revulsion: Frown,
  gloom: CloudRain,
};

/** The emotion she feels most. */
function strongest(values: Record<TrackedEmotion, number>) {
  return TRACKED_EMOTIONS.reduce((best, emotion) =>
    values[emotion] > values[best] ? emotion : best,
  );
}

/** One slim petal pointing up from the centre, `length` long. */
function petalPath(length: number, width: number) {
  const w = length * width;
  return [
    "M0,0",
    `C${w},${-length * 0.32} ${w * 0.85},${-length * 0.86} 0,${-length}`,
    `C${-w * 0.85},${-length * 0.86} ${-w},${-length * 0.32} 0,0`,
    "Z",
  ].join(" ");
}

/** A petal's length for a value. */
const petalLength = (value: number) => 22 + 62 * Math.min(1, value / MAX);

/** Degrees between a group's three petals. */
const FAN_DEG = 13;

/** Milliseconds a reaction's new values take to show before a petal pulses. */
const PULSE_AFTER_MS = 450;

/** Pollen drifting off the strongest petal: count and drift time. */
const POLLEN = 6;
const POLLEN_SEC = 2.4;

/**
 * The strongest value at which her strongest petal sheds pollen and pulses
 * for a reaction. Below it (a brand-new Anima, or one that feels next to
 * nothing) no petal is singled out.
 */
const BLOOM_MIN_STRENGTH = 3;

/**
 * A flower of her 24 emotions: each emotion group is a fan of three slim
 * petals in its colour, one per emotion, whose length is how strongly she
 * feels it. Petals deepen in colour toward the heart, the strongest lie on
 * top, and they sway. The flower opens from a bud when mounted (remount it
 * to open again). Once her strongest emotion reaches `BLOOM_MIN_STRENGTH`,
 * that petal pulses whenever `beat` changes (a new reaction) and sheds a
 * little pollen. The three strongest groups carry a small symbol at their
 * tips (named on hover). Her current mascot sits at the heart on a glow of
 * her strongest colour.
 */
export function MoodBloom({
  values,
  beat,
  className,
}: {
  values: Record<TrackedEmotion, number>;
  /** Changes when a new reaction starts. */
  beat?: string | number | null;
  className?: string;
}) {
  const { t } = useTranslation("emotion");
  const presentation = useMemo(
    () => buildEmotionPresentation(values, t),
    [values, t],
  );
  const uid = useId();
  const still = reducedMotion();
  const step = 360 / EMOTION_GROUPS.length;
  const top = strongest(values);
  // At rest (all zero, or next to nothing) no petal is singled out;
  // `strongest` would otherwise pick the first emotion.
  const alive = values[top] >= BLOOM_MIN_STRENGTH;

  /** Each emotion's petal angle: its group's slot, fanned out. */
  const angleOf = (emotion: TrackedEmotion) => {
    const group = GROUP_OF[emotion];
    const slot = EMOTION_GROUPS.indexOf(group) * step;
    const member = (
      EMOTION_GROUP_MEMBERS[group] as readonly TrackedEmotion[]
    ).indexOf(emotion);
    return slot + (member - 1) * FAN_DEG;
  };

  // Pulse the strongest petal once the new reaction's values land, if one
  // is strong enough to single out.
  const latest = useRef({ top, alive });
  latest.current = { top, alive };
  const pulses = useRef(new Map<TrackedEmotion, SVGAnimateTransformElement>());
  useEffect(() => {
    if (still || beat === undefined || beat === null) return;
    const timer = window.setTimeout(() => {
      if (latest.current.alive)
        pulses.current.get(latest.current.top)?.beginElement();
    }, PULSE_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [beat, still]);

  // The strongest petals are drawn last, on top.
  const order = [...TRACKED_EMOTIONS].sort((a, b) => values[a] - values[b]);
  const named = presentation.topGroups.map(({ group }) => group);
  const pollenFrom = Math.round(petalLength(values[top]) * 0.85);
  return (
    <svg
      viewBox="-100 -100 200 200"
      className={cn("h-48 w-full overflow-visible", className)}
      role="img"
      aria-label={presentation.feeling.label}
    >
      <defs>
        <filter
          id={`${uid}-shadow`}
          x="-20%"
          y="-20%"
          width="140%"
          height="140%"
        >
          <feDropShadow
            dx="0"
            dy="1.2"
            stdDeviation="1.4"
            floodOpacity="0.16"
          />
        </filter>
        {EMOTION_GROUPS.map((group) => (
          // From a petal's base (deep) to its tip (light).
          <linearGradient
            key={group}
            id={`${uid}-${group}`}
            x1="0.5"
            y1="1"
            x2="0.5"
            y2="0"
          >
            <stop
              offset="0%"
              stopColor={EMOTION_PALETTE[group]}
              stopOpacity={0.9}
            />
            <stop
              offset="100%"
              stopColor={EMOTION_PALETTE[group]}
              stopOpacity={0.3}
            />
          </linearGradient>
        ))}
        <radialGradient id={`${uid}-heart`}>
          <stop offset="0%" stopColor={presentation.color} stopOpacity={0.6} />
          <stop
            offset="55%"
            stopColor={presentation.color}
            stopOpacity={0.25}
          />
          <stop offset="100%" stopColor={presentation.color} stopOpacity={0} />
        </radialGradient>
      </defs>
      <g filter={`url(#${uid}-shadow)`}>
        {order.map((emotion) => {
          const group = GROUP_OF[emotion];
          const groupIndex = EMOTION_GROUPS.indexOf(group);
          return (
            <g key={emotion} transform={`rotate(${angleOf(emotion)})`}>
              {/* Opening from a bud, group by group. */}
              <g>
                {still ? null : (
                  <animateTransform
                    attributeName="transform"
                    type="scale"
                    values="0.12; 1.06; 1"
                    keyTimes="0; 0.7; 1"
                    calcMode="spline"
                    keySplines="0.2 0.8 0.3 1; 0.4 0 0.6 1"
                    dur="0.8s"
                    begin={`${groupIndex * 0.06}s`}
                    fill="freeze"
                  />
                )}
                {/* Swaying, each group at its own pace. */}
                <g>
                  {still ? null : (
                    <animateTransform
                      attributeName="transform"
                      type="rotate"
                      values="-3 0 0; 3 0 0; -3 0 0"
                      dur={`${3.6 + (groupIndex % 3) * 0.5}s`}
                      begin={`${-groupIndex * 0.45}s`}
                      repeatCount="indefinite"
                    />
                  )}
                  {/* The pulse when a reaction lands. */}
                  <g>
                    {still ? null : (
                      <animateTransform
                        ref={(element) => {
                          if (element)
                            pulses.current.set(
                              emotion,
                              element as SVGAnimateTransformElement,
                            );
                          else pulses.current.delete(emotion);
                        }}
                        attributeName="transform"
                        type="scale"
                        values="1; 1.16; 1"
                        keyTimes="0; 0.4; 1"
                        dur="0.6s"
                        begin="indefinite"
                      />
                    )}
                    <path
                      d={petalPath(petalLength(values[emotion]), 0.2)}
                      fill={`url(#${uid}-${group})`}
                      stroke={EMOTION_PALETTE[group]}
                      strokeWidth={1}
                      strokeOpacity={0.75}
                      strokeLinejoin="round"
                    >
                      <title>{emotionLabel(emotion, t)}</title>
                    </path>
                  </g>
                </g>
              </g>
            </g>
          );
        })}
      </g>
      {/* Pollen drifting off the strongest petal. */}
      {still || !alive ? null : (
        <g transform={`rotate(${angleOf(top)})`} pointerEvents="none">
          {Array.from({ length: POLLEN }, (_, index) => {
            const side = ((index * 37) % 11) - 5;
            const drift = 16 + ((index * 13) % 12);
            const begin = `${(index * POLLEN_SEC) / POLLEN}s`;
            return (
              <circle
                key={index}
                r={1.2 + (index % 3) * 0.5}
                fill={EMOTION_PALETTE[GROUP_OF[top]]}
                opacity={0}
              >
                <animate
                  attributeName="cx"
                  values={`${side * 0.6}; ${side * 1.8}`}
                  dur={`${POLLEN_SEC}s`}
                  begin={begin}
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="cy"
                  values={`${-pollenFrom}; ${-pollenFrom - drift}`}
                  dur={`${POLLEN_SEC}s`}
                  begin={begin}
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="opacity"
                  values="0; 0.9; 0"
                  keyTimes="0; 0.3; 1"
                  dur={`${POLLEN_SEC}s`}
                  begin={begin}
                  repeatCount="indefinite"
                />
              </circle>
            );
          })}
        </g>
      )}
      {/* A symbol at the tip of each of the three strongest groups. */}
      {named.map((group) => {
        const longest = Math.max(
          ...EMOTION_GROUP_MEMBERS[group].map((emotion) => values[emotion]),
        );
        const tip =
          ((EMOTION_GROUPS.indexOf(group) * step - 90) * Math.PI) / 180;
        const at = petalLength(longest) + 11;
        const Icon = GROUP_ICONS[group];
        const label = presentation.groups.find(
          (entry) => entry.group === group,
        )?.label;
        return (
          <g
            key={group}
            transform={`translate(${Math.cos(tip) * at} ${Math.sin(tip) * at})`}
          >
            <title>{label}</title>
            <circle
              r={8}
              fill="var(--card)"
              stroke={EMOTION_PALETTE[group]}
              strokeWidth={1}
            />
            <Icon
              x={-5}
              y={-5}
              width={10}
              height={10}
              color={EMOTION_PALETTE[group]}
              strokeWidth={2.4}
            />
          </g>
        );
      })}
      {/* The flower's heart: a soft glow in her strongest group's colour
          where the petals meet, with her mascot on it. */}
      <circle r={34} fill={`url(#${uid}-heart)`} />
      <image
        href={presentation.feeling.mascot}
        x={-23}
        y={-23}
        width={46}
        height={46}
      />
    </svg>
  );
}
