"use client";

import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

import {
  EMOTION_GROUP_MEMBERS,
  EMOTION_GROUPS,
  buildEmotionRuntimeState,
  formatEmotionGroupLabel,
  formatTrackedEmotionLabel,
  normalizeEmotionStateMap,
  type EmotionGroup,
  type EmotionGroupSummary,
  type EmotionRuntimeState,
  type EmotionStateMap,
  type ResolvedEmotionGroup,
  type TrackedEmotion,
} from "@/lib/emotion";
import { cn } from "@/lib/utils";

type EmotionalStateProps = {
  emotionalState?: EmotionStateMap | EmotionRuntimeState | unknown;
  className?: string;
  variant?: "default" | "compact" | "showcase" | "inline";
  sourceLabel?: string | null;
};

type EmotionRadarDatum = {
  group: EmotionGroup;
  label: string;
  shortLabel: string;
  value: number;
  intensity: number;
  primaryEmotion: string | null;
  emotions: Array<{
    emotion: TrackedEmotion;
    label: string;
    value: number;
  }>;
};

type EmotionTooltipPayload = {
  payload?: EmotionRadarDatum;
};

type EmotionTooltipProps = {
  active?: boolean;
  payload?: EmotionTooltipPayload[];
};

const GROUP_ACCENTS: Record<
  ResolvedEmotionGroup,
  {
    stroke: string;
    fill: string;
    text: string;
    badge: string;
    dot: string;
  }
> = {
  neutral: {
    stroke: "rgb(148 163 184)",
    fill: "rgba(148, 163, 184, 0.22)",
    text: "text-slate-700 dark:text-slate-200",
    badge:
      "border-slate-400/30 bg-slate-500/10 text-slate-700 dark:text-slate-100",
    dot: "bg-slate-300",
  },
  affection: {
    stroke: "rgb(34 211 238)",
    fill: "rgba(34, 211, 238, 0.22)",
    text: "text-cyan-700 dark:text-cyan-100",
    badge: "border-cyan-400/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-100",
    dot: "bg-cyan-300",
  },
  esteem: {
    stroke: "rgb(45 212 191)",
    fill: "rgba(45, 212, 191, 0.22)",
    text: "text-teal-700 dark:text-teal-100",
    badge: "border-teal-400/30 bg-teal-500/10 text-teal-700 dark:text-teal-100",
    dot: "bg-teal-300",
  },
  delight: {
    stroke: "rgb(251 191 36)",
    fill: "rgba(251, 191, 36, 0.24)",
    text: "text-amber-700 dark:text-amber-100",
    badge:
      "border-amber-400/30 bg-amber-500/10 text-amber-700 dark:text-amber-100",
    dot: "bg-amber-300",
  },
  drive: {
    stroke: "rgb(250 204 21)",
    fill: "rgba(250, 204, 21, 0.22)",
    text: "text-yellow-700 dark:text-yellow-100",
    badge:
      "border-yellow-400/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-100",
    dot: "bg-yellow-300",
  },
  alarm: {
    stroke: "rgb(217 70 239)",
    fill: "rgba(217, 70, 239, 0.22)",
    text: "text-fuchsia-700 dark:text-fuchsia-100",
    badge:
      "border-fuchsia-400/30 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-100",
    dot: "bg-fuchsia-300",
  },
  rejection: {
    stroke: "rgb(244 63 94)",
    fill: "rgba(244, 63, 94, 0.22)",
    text: "text-rose-700 dark:text-rose-100",
    badge: "border-rose-400/30 bg-rose-500/10 text-rose-700 dark:text-rose-100",
    dot: "bg-rose-300",
  },
  revulsion: {
    stroke: "rgb(132 204 22)",
    fill: "rgba(132, 204, 22, 0.22)",
    text: "text-lime-700 dark:text-lime-100",
    badge: "border-lime-400/30 bg-lime-500/10 text-lime-700 dark:text-lime-100",
    dot: "bg-lime-300",
  },
  gloom: {
    stroke: "rgb(96 165 250)",
    fill: "rgba(96, 165, 250, 0.22)",
    text: "text-blue-700 dark:text-blue-100",
    badge: "border-blue-400/30 bg-blue-500/10 text-blue-700 dark:text-blue-100",
    dot: "bg-blue-300",
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toEmotionRuntimeState(
  value: EmotionalStateProps["emotionalState"],
): EmotionRuntimeState {
  if (isRecord(value) && isRecord(value.values)) {
    return buildEmotionRuntimeState(normalizeEmotionStateMap(value.values));
  }
  return buildEmotionRuntimeState(normalizeEmotionStateMap(value));
}

function toRadarData(runtime: EmotionRuntimeState): EmotionRadarDatum[] {
  const rankedGroupsById = new Map<EmotionGroup, EmotionGroupSummary>(
    runtime.rankedGroups.map((group) => [group.group, group]),
  );

  return EMOTION_GROUPS.map((group) => {
    const summary = rankedGroupsById.get(group);
    const emotions = [...EMOTION_GROUP_MEMBERS[group]]
      .map((emotion) => ({
        emotion,
        label: formatTrackedEmotionLabel(emotion),
        value: runtime.values[emotion],
      }))
      .sort((a, b) => {
        if (b.value !== a.value) return b.value - a.value;
        return a.label.localeCompare(b.label);
      });
    const average =
      emotions.reduce((sum, emotion) => sum + emotion.value, 0) /
      emotions.length;
    const primaryEmotion = summary?.primaryEmotion ?? null;
    const label = formatEmotionGroupLabel(group);

    return {
      group,
      label,
      shortLabel: label.slice(0, 3),
      value: Number(average.toFixed(1)),
      intensity: summary?.intensity ?? 0,
      primaryEmotion: primaryEmotion
        ? formatTrackedEmotionLabel(primaryEmotion.emotion)
        : null,
      emotions,
    };
  });
}

function sortActiveRadarData(
  left: EmotionRadarDatum,
  right: EmotionRadarDatum,
): number {
  if (right.value !== left.value) return right.value - left.value;
  return left.label.localeCompare(right.label);
}

function EmotionRadarTooltip({ active, payload }: EmotionTooltipProps) {
  const datum = payload?.[0]?.payload;
  if (!active || !datum) return null;

  return (
    <div className="border-border/70 bg-popover/95 text-popover-foreground min-w-44 rounded-md border px-3 py-2 text-xs shadow-md backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <div className="font-medium">{datum.label}</div>
        <div className="text-muted-foreground font-mono">
          {datum.value.toFixed(1)}
        </div>
      </div>
      <div className="text-muted-foreground mt-1">
        {datum.primaryEmotion ?? "Neutral leaning"} · L{datum.intensity}
      </div>
      <div className="mt-2 space-y-1">
        {datum.emotions.map((emotion) => (
          <div
            key={emotion.emotion}
            className="grid grid-cols-[minmax(0,1fr)_auto] gap-3"
          >
            <span className="truncate">{emotion.label}</span>
            <span className="text-muted-foreground font-mono">
              {emotion.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function EmotionalState({
  emotionalState,
  className,
  variant = "default",
  sourceLabel = null,
}: EmotionalStateProps) {
  const runtime = toEmotionRuntimeState(emotionalState);
  const isInline = variant === "inline";
  const isShowcase = variant === "showcase";
  const isCompact = variant !== "default";
  const data = toRadarData(runtime);
  const activeData = data.filter((datum) => datum.value > 0);
  const topGroups = [...activeData].sort(sortActiveRadarData).slice(0, 4);
  const dominantGroup = runtime.dominantGroup;
  const dominantAccent = GROUP_ACCENTS[dominantGroup] ?? GROUP_ACCENTS.neutral;
  const dominantSummary = runtime.dominantGroupSummary;
  const dominantLabel = dominantSummary
    ? formatEmotionGroupLabel(dominantSummary.group)
    : "Neutral";
  const dominantPrimary = dominantSummary?.primaryEmotion
    ? formatTrackedEmotionLabel(dominantSummary.primaryEmotion.emotion)
    : "No active emotion";
  const chartHeight = isShowcase ? "h-24" : isCompact ? "h-52" : "h-72";
  const radarChart = (
    <ResponsiveContainer width="100%" height="100%">
      <RadarChart
        data={data}
        margin={
          isInline
            ? { top: 12, right: 28, bottom: 12, left: 28 }
            : isShowcase
              ? { top: 4, right: 18, bottom: 4, left: 18 }
              : isCompact
                ? { top: 12, right: 22, bottom: 12, left: 22 }
                : { top: 18, right: 34, bottom: 18, left: 34 }
        }
      >
        <PolarGrid
          gridType="polygon"
          radialLines
          stroke="var(--border)"
          strokeOpacity={0.55}
        />
        <PolarAngleAxis
          dataKey={isInline ? "label" : isCompact ? "shortLabel" : "label"}
          tick={{
            fill: "var(--muted-foreground)",
            fontSize: isInline ? 10 : isCompact ? 10 : 11,
          }}
          tickLine={false}
        />
        <PolarRadiusAxis
          angle={90}
          domain={[0, 30]}
          tick={false}
          axisLine={false}
          tickCount={4}
        />
        <Tooltip
          cursor={{ stroke: dominantAccent.stroke, strokeOpacity: 0.35 }}
          content={<EmotionRadarTooltip />}
        />
        <Radar
          name="Emotion group average"
          dataKey="value"
          stroke={dominantAccent.stroke}
          fill={dominantAccent.fill}
          fillOpacity={1}
          strokeWidth={2}
          dot={{
            r: isCompact ? 2 : 3,
            fill: dominantAccent.stroke,
            strokeWidth: 0,
          }}
          isAnimationActive={false}
        />
      </RadarChart>
    </ResponsiveContainer>
  );

  if (isInline) {
    return (
      <div
        role="img"
        aria-label={`Emotional state polar chart. Dominant group: ${dominantLabel}.`}
        className={cn("h-60 w-full", className)}
      >
        {radarChart}
      </div>
    );
  }

  return (
    <section
      className={cn(
        "border-border/70 bg-card/90 text-card-foreground rounded-lg border p-3 shadow-sm",
        isCompact ? "space-y-3" : "space-y-4",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div
            className={cn(
              "text-muted-foreground font-semibold tracking-wide uppercase",
              isCompact ? "text-[0.62rem]" : "text-xs",
            )}
          >
            Emotional State
          </div>
          {sourceLabel ? (
            <div className="text-muted-foreground/90 mt-1 truncate text-xs">
              {sourceLabel}
            </div>
          ) : null}
        </div>
        <div
          className={cn(
            "shrink-0 rounded-md border px-2 py-1 text-right",
            dominantAccent.badge,
          )}
        >
          <div className="text-[0.62rem] font-semibold tracking-wide uppercase">
            Dominant
          </div>
          <div className="mt-0.5 text-xs font-medium">{dominantLabel}</div>
        </div>
      </div>

      <div className={cn("w-full", chartHeight)}>{radarChart}</div>

      {!isShowcase ? (
        <>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <div className="min-w-0">
              <div className={cn("text-sm font-medium", dominantAccent.text)}>
                {dominantLabel}
              </div>
              <div className="text-muted-foreground mt-1 text-xs">
                {dominantPrimary}
                {dominantSummary ? ` · L${dominantSummary.intensity}` : ""}
              </div>
            </div>
            <div className="text-muted-foreground text-xs">
              Range 0-30 per group average
            </div>
          </div>

          {topGroups.length > 0 ? (
            <div className="grid gap-2">
              {topGroups.map((datum) => {
                const accent = GROUP_ACCENTS[datum.group];
                return (
                  <div
                    key={datum.group}
                    className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 text-xs"
                  >
                    <span
                      className={cn("h-2 w-2 rounded-full", accent.dot)}
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <div className="truncate font-medium">{datum.label}</div>
                      <div className="text-muted-foreground truncate">
                        {datum.primaryEmotion ?? "Neutral leaning"}
                      </div>
                    </div>
                    <div className="text-muted-foreground font-mono">
                      {datum.value.toFixed(1)}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="border-border/70 bg-muted/20 text-muted-foreground rounded-md border border-dashed px-3 py-4 text-center text-sm">
              No active emotion groups.
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
