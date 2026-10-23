"use client";

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
import { useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";
import { useFormatters } from "@animama/product-ui/i18n";
import {
  EMOTION_GROUP_MEMBERS,
  EMOTION_GROUPS,
  EMOTION_MAX_VALUE,
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

/** How a group was chosen; touch selections persist until a tap elsewhere. */
export type MoodBloomSelectionInput = "pointer" | "keyboard" | "touch";

/**
 * Makes each emotion group a selectable target. The caller owns the selected
 * group and shows its details in the element named by `describedBy`.
 */
export type MoodBloomSelection = {
  group: EmotionGroup | null;
  /** The petal under the pointer within the chosen group, if any. */
  emotion?: TrackedEmotion | null;
  /** `emotion` is the petal the pointer or tap is on; keyboard passes none. */
  onSelect: (
    group: EmotionGroup,
    input: MoodBloomSelectionInput,
    emotion: TrackedEmotion | null,
  ) => void;
  /** Keyboard focus left a group. */
  onBlur: () => void;
  /** The pointer left a group. */
  onClearPointer: () => void;
  describedBy?: string;
};

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

/** Degrees between neighbouring groups, and between a group's three petals. */
const SLOT_DEG = 360 / EMOTION_GROUPS.length;
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

/** Half the drawing's width: room for the petals and the labelled rim. */
const EXTENT = 128;

/** Where each group's symbol and name sit, beyond its longest petal. */
const RIM = 104;

/** Faint reference rings at these values, so petal lengths can be compared. */
const SCALE_RINGS = [10, 20, 30] as const;

/** Opacity of groups other than the chosen one, and of a chosen petal's siblings. */
const FADED = 0.15;
const SIBLING = 0.55;

/** The chosen group's petals grow by this much. */
const CHOSEN_SCALE = 1.08;

/** Each group's selectable wedge runs from the mascot's edge past its name. */
const TARGET_INNER = 24;
const TARGET_OUTER = EXTENT;

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

/** A ring sector pointing up, `spread` degrees wide. */
function wedgePath(inner: number, outer: number, spread: number) {
  const half = (spread / 2) * (Math.PI / 180);
  const point = (radius: number, side: -1 | 1) =>
    `${(side * Math.sin(half) * radius).toFixed(2)},${(-Math.cos(half) * radius).toFixed(2)}`;
  return [
    `M${point(inner, -1)}`,
    `L${point(outer, -1)}`,
    `A${outer},${outer} 0 0 1 ${point(outer, 1)}`,
    `L${point(inner, 1)}`,
    `A${inner},${inner} 0 0 0 ${point(inner, -1)}`,
    "Z",
  ].join(" ");
}

/** A petal's length for a value. */
const petalLength = (value: number) =>
  22 + 62 * Math.min(1, value / EMOTION_MAX_VALUE);

/** Each emotion's petal angle: its group's slot, fanned out. */
function angleOf(emotion: TrackedEmotion) {
  const group = GROUP_OF[emotion];
  const member = (
    EMOTION_GROUP_MEMBERS[group] as readonly TrackedEmotion[]
  ).indexOf(emotion);
  return EMOTION_GROUPS.indexOf(group) * SLOT_DEG + (member - 1) * FAN_DEG;
}

/** A point `radius` out from the centre at `degrees` clockwise from the top. */
function polar(degrees: number, radius: number) {
  const radians = (degrees * Math.PI) / 180;
  return { x: Math.sin(radians) * radius, y: -Math.cos(radians) * radius };
}

/**
 * The emotion of `group` whose petal lies nearest `degrees` (clockwise from
 * the top): each petal owns the part of its group's slot closest to it.
 */
export function emotionAtAngle(
  group: EmotionGroup,
  degrees: number,
): TrackedEmotion {
  const members = EMOTION_GROUP_MEMBERS[group] as readonly TrackedEmotion[];
  // The offset from the slot's centre, folded into -180..180.
  const offset =
    ((((degrees - EMOTION_GROUPS.indexOf(group) * SLOT_DEG) % 360) + 540) %
      360) -
    180;
  const member = Math.round(offset / FAN_DEG) + 1;
  return members[Math.min(members.length - 1, Math.max(0, member))];
}

/**
 * The petal of `group` under a pointer at (`clientX`, `clientY`), or null at
 * the very centre. The drawing is centred in its square-fitted SVG, so the
 * angle from the SVG box's centre is the angle in the drawing.
 */
function emotionAtPointer(
  svg: SVGSVGElement | null,
  group: EmotionGroup,
  clientX: number,
  clientY: number,
): TrackedEmotion | null {
  if (!svg) return null;
  const box = svg.getBoundingClientRect();
  const dx = clientX - (box.left + box.width / 2);
  const dy = clientY - (box.top + box.height / 2);
  if (dx === 0 && dy === 0) return null;
  return emotionAtAngle(group, (Math.atan2(dx, -dy) * 180) / Math.PI);
}

/**
 * A flower of an Anima's 24 emotions: each emotion group is a fan of three
 * slim petals in its colour, one per emotion, whose length is how strongly
 * she feels it. Petals deepen in colour toward the heart, the strongest lie
 * on top, and they sway. The flower opens from a bud when mounted (remount it
 * to open again). Once her strongest emotion reaches `BLOOM_MIN_STRENGTH`,
 * that petal pulses whenever `beat` changes (a new reaction) and sheds a
 * little pollen. Faint rings mark 10, 20 and 30; every group's symbol and
 * name sit around the rim, the three strongest emphasised, and her current
 * mascot sits at the heart on a glow of her strongest colour. With
 * `selection`, each group is a button chosen by hover, keyboard or tap: the
 * chosen group's slot is tinted and its petals grow while the others fade,
 * and the petal under the pointer shows its name and score at the rim.
 */
export function MoodBloom({
  emotionalState,
  beat,
  selection,
  className,
}: {
  emotionalState?: unknown;
  /** Changes when a new reaction starts. */
  beat?: string | number | null;
  selection?: MoodBloomSelection;
  className?: string;
}) {
  const { t } = useTranslation("emotion");
  const formatters = useFormatters();
  // `t` changes with the UI Locale, so a language switch rebuilds the labels.
  const presentation = useMemo(
    () => buildEmotionPresentation(emotionalState, t),
    [emotionalState, t],
  );
  const values = presentation.runtime.values;
  const uid = useId();
  const still = useReducedMotion() ?? false;
  // Her strongest emotion, when strong enough to single out; at rest (all
  // zero, or next to nothing) no petal sheds pollen or pulses.
  const dominant = presentation.runtime.dominantEmotion;
  const top =
    dominant && dominant.value >= BLOOM_MIN_STRENGTH ? dominant.emotion : null;

  // Pulse the strongest petal once the new reaction's values land.
  const latest = useRef(top);
  latest.current = top;
  const pulses = useRef(new Map<TrackedEmotion, SVGAnimateTransformElement>());
  useEffect(() => {
    if (still || beat === undefined || beat === null) return;
    const timer = window.setTimeout(() => {
      if (latest.current) pulses.current.get(latest.current)?.beginElement();
    }, PULSE_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [beat, still]);

  // The strongest petals are drawn last, on top.
  const order = [...TRACKED_EMOTIONS].sort((a, b) => values[a] - values[b]);
  const named = presentation.topGroups.map(({ group }) => group);
  const pollenFrom = top ? Math.round(petalLength(values[top]) * 0.85) : 0;
  const selected = selection?.group ?? null;
  // The petal under the pointer, only within the chosen group.
  const pointed =
    selected && selection?.emotion && GROUP_OF[selection.emotion] === selected
      ? selection.emotion
      : null;
  return (
    <svg
      viewBox={`${-EXTENT} ${-EXTENT} ${EXTENT * 2} ${EXTENT * 2}`}
      className={cn("h-48 w-full overflow-visible", className)}
      role={selection ? "group" : "img"}
      aria-label={selection ? t("bloom.label") : presentation.feeling.label}
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
      {/* Reference rings on the fixed 0–30 scale, behind the petals. */}
      <g aria-hidden="true" pointerEvents="none">
        {SCALE_RINGS.map((value) => (
          <circle
            key={value}
            data-bloom-ring={value}
            r={petalLength(value)}
            fill="none"
            stroke="var(--border)"
            strokeWidth={0.75}
            strokeDasharray={value === EMOTION_MAX_VALUE ? undefined : "2 3"}
          />
        ))}
      </g>
      {/* The chosen group's slot, tinted in its colour. */}
      {selected ? (
        <path
          data-bloom-highlight={selected}
          d={wedgePath(TARGET_INNER, RIM - 10, SLOT_DEG)}
          transform={`rotate(${EMOTION_GROUPS.indexOf(selected) * SLOT_DEG})`}
          fill={EMOTION_PALETTE[selected]}
          fillOpacity={0.08}
          stroke={EMOTION_PALETTE[selected]}
          strokeOpacity={0.35}
          strokeWidth={1}
          strokeLinejoin="round"
          pointerEvents="none"
          aria-hidden="true"
        />
      ) : null}
      {/* The drawing is decorative; selectable groups carry the labels. */}
      <g filter={`url(#${uid}-shadow)`} aria-hidden="true">
        {order.map((emotion) => {
          const group = GROUP_OF[emotion];
          const groupIndex = EMOTION_GROUPS.indexOf(group);
          const opacity =
            selected === null
              ? 1
              : selected !== group
                ? FADED
                : pointed && pointed !== emotion
                  ? SIBLING
                  : 1;
          return (
            <g
              key={emotion}
              transform={`rotate(${angleOf(emotion)})`}
              opacity={opacity}
              className="transition-opacity duration-150 motion-reduce:transition-none"
            >
              {/* The chosen group grows a little (a CSS transform, so it
                  eases; it scales about the flower's heart). */}
              <g
                style={{
                  transform:
                    selected === group ? `scale(${CHOSEN_SCALE})` : undefined,
                }}
                className="transition-transform duration-150 motion-reduce:transition-none"
              >
                {/* Opening from a bud, group by group; each waits as a bud
                  until its staggered start. */}
                <g transform={still ? undefined : "scale(0.12)"}>
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
                        data-bloom-petal={emotion}
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
            </g>
          );
        })}
      </g>
      {/* Pollen drifting off the strongest petal. */}
      {still || top === null ? null : (
        <g
          transform={`rotate(${angleOf(top)})`}
          pointerEvents="none"
          aria-hidden="true"
        >
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
      {/* Every group's symbol and name around the rim, so the bloom reads
          without hovering: the strongest three stand out, groups she does
          not feel at all are faint. Names sit on the outer side. */}
      {presentation.groups.map(({ group, label, maximum }) => {
        const at = polar(EMOTION_GROUPS.indexOf(group) * SLOT_DEG, RIM);
        const strong = named.includes(group);
        const chosen = selected === group;
        const opacity = selected
          ? chosen
            ? 1
            : 0.35
          : strong
            ? 1
            : maximum > 0
              ? 0.75
              : 0.5;
        const Icon = GROUP_ICONS[group];
        // While a petal is pointed at, its group's name gives way to that
        // emotion and its score. Beside the flower, that longer name runs
        // inward from the symbol so it stays inside the drawing.
        const pointedHere = chosen ? pointed : null;
        const inward = pointedHere !== null && Math.abs(at.x) > RIM - 1;
        return (
          <g
            key={group}
            data-bloom-rim={group}
            data-strong={strong ? "true" : undefined}
            aria-hidden="true"
            pointerEvents="none"
            transform={`translate(${at.x.toFixed(2)} ${at.y.toFixed(2)})`}
            opacity={opacity}
            className="transition-opacity duration-150 motion-reduce:transition-none"
          >
            <circle
              r={8}
              fill="var(--card)"
              stroke={EMOTION_PALETTE[group]}
              strokeWidth={chosen ? 2 : 1}
            />
            <Icon
              x={-5}
              y={-5}
              width={10}
              height={10}
              color={EMOTION_PALETTE[group]}
              strokeWidth={2.4}
            />
            <text
              data-bloom-name={group}
              x={inward ? Math.sign(at.x) * 8 : 0}
              y={at.y < -1 ? -12 : 19}
              textAnchor={inward ? (at.x > 0 ? "end" : "start") : "middle"}
              fontSize={10}
              fontWeight={strong || chosen ? 600 : 400}
              fill={
                chosen
                  ? EMOTION_PALETTE[group]
                  : strong
                    ? "var(--foreground)"
                    : "var(--muted-foreground)"
              }
              stroke="var(--card)"
              strokeWidth={pointedHere ? 3 : 0}
              paintOrder="stroke"
            >
              {pointedHere ? (
                <>
                  {emotionLabel(pointedHere, t)}{" "}
                  <tspan className="tabular-nums">
                    {formatters.number(values[pointedHere])}
                  </tspan>
                </>
              ) : (
                label
              )}
            </text>
          </g>
        );
      })}
      {/* The flower's heart: a soft glow in her strongest group's colour
          where the petals meet, with her mascot on it. */}
      <circle
        r={34}
        fill={`url(#${uid}-heart)`}
        pointerEvents="none"
        aria-hidden="true"
      />
      <image
        href={presentation.feeling.mascot}
        x={-23}
        y={-23}
        width={46}
        height={46}
        pointerEvents="none"
        aria-hidden="true"
      />
      {selection
        ? presentation.groups.map((group) => (
            <BloomGroupTarget
              key={group.group}
              group={group.group}
              label={t("bloom.group", {
                group: group.label,
                maximum: formatters.number(group.maximum),
                emotions: formatters.list(
                  group.emotions.map((emotion) =>
                    t("bloom.groupEmotion", {
                      emotion: emotion.label,
                      value: formatters.number(emotion.value),
                    }),
                  ),
                ),
              })}
              selection={selection}
            />
          ))
        : null}
    </svg>
  );
}

/**
 * A transparent wedge over a group's slot, out past its name, that selects it
 * on hover, focus, Enter, Space or tap, and shows a focus ring for keyboard
 * users. Pointer and tap selections also report the petal under the pointer.
 */
function BloomGroupTarget({
  group,
  label,
  selection,
}: {
  group: EmotionGroup;
  label: string;
  selection: MoodBloomSelection;
}) {
  const pointerType = useRef<string | null>(null);
  const select = (
    input: MoodBloomSelectionInput,
    event?: { clientX: number; clientY: number; currentTarget: Element },
  ) =>
    selection.onSelect(
      group,
      input,
      event
        ? emotionAtPointer(
            event.currentTarget.closest("svg"),
            group,
            event.clientX,
            event.clientY,
          )
        : null,
    );
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-describedby={selection.describedBy}
      data-emotion-group={group}
      data-selected={selection.group === group ? "true" : undefined}
      transform={`rotate(${EMOTION_GROUPS.indexOf(group) * SLOT_DEG})`}
      onMouseEnter={(event) => select("pointer", event)}
      // Follows the pointer from petal to petal within the group.
      onMouseMove={(event) => select("pointer", event)}
      onMouseLeave={selection.onClearPointer}
      onPointerDown={(event) => {
        pointerType.current = event.pointerType;
      }}
      onFocus={(event) => {
        if (event.currentTarget.matches(":focus-visible")) select("keyboard");
      }}
      onBlur={(event) => {
        // Moving to the next group hands the selection over directly; clearing
        // it in between would empty the caption while nothing has focus, and a
        // surrounding dialog's focus trap would then reclaim focus.
        const next = event.relatedTarget;
        if (
          next instanceof Element &&
          next.closest("svg") === event.currentTarget.ownerSVGElement &&
          next.closest("[data-emotion-group]")
        )
          return;
        selection.onBlur();
      }}
      onClick={(event) =>
        select(pointerType.current === "touch" ? "touch" : "pointer", event)
      }
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          select("keyboard");
        }
      }}
      className="group cursor-pointer outline-none"
    >
      <path
        d={wedgePath(TARGET_INNER, TARGET_OUTER, SLOT_DEG)}
        fill="transparent"
        strokeWidth={1.5}
        strokeLinejoin="round"
        className="group-focus-visible:stroke-ring"
      />
    </g>
  );
}
