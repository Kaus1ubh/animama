"use client";

import { useId, useState, type ReactNode } from "react";
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { type EmotionGroup } from "@/lib/emotion";
import {
  buildEmotionPresentation,
  formatEmotionAverage,
  EMOTION_PALETTE,
} from "@/lib/emotion/presentation";
import { cn } from "@/lib/utils";

type EmotionalStateProps = {
  emotionalState?: unknown;
  className?: string;
  variant?: "default" | "compact" | "showcase" | "inline";
  sourceLabel?: string | null;
};
type EmotionGroupDatum = ReturnType<
  typeof buildEmotionPresentation
>["groups"][number];

/** Plain-language mood summary shared by the Anima header and detail surfaces. */
export function EmotionSummary({
  emotionalState,
  className,
  headerAction,
}: {
  emotionalState?: unknown;
  className?: string;
  headerAction?: ReactNode;
}) {
  const presentation = buildEmotionPresentation(emotionalState);
  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-medium">
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-xl"
            style={{ backgroundColor: `${presentation.color}1A` }}
          >
            {presentation.feeling.emoji}
          </span>
          {presentation.feeling.label}
        </p>
        {headerAction}
      </div>
      {presentation.topGroups.length ? (
        <div className="space-y-2.5">
          {presentation.topGroups.map((group) => (
            <div
              key={group.group}
              className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-3 text-sm"
            >
              <span className="text-muted-foreground">{group.label}</span>
              <span
                aria-hidden="true"
                className="bg-muted/60 h-1.5 overflow-hidden rounded-full"
              >
                <span
                  className="block h-full rounded-full"
                  style={{
                    backgroundColor: group.color,
                    width: `${(group.average / 30) * 100}%`,
                  }}
                />
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">No active emotions.</p>
      )}
    </div>
  );
}

function GroupDetail({ group }: { group: EmotionGroupDatum }) {
  return (
    <div className="text-sm">
      <div className="mb-3 flex items-center justify-between gap-4 font-medium">
        <span>{group.label}</span>
        <span className="tabular-nums">
          {formatEmotionAverage(group.average)}
        </span>
      </div>
      <dl className="space-y-2">
        {group.emotions.map((emotion) => (
          <div
            key={emotion.emotion}
            className="text-muted-foreground flex items-center justify-between gap-6"
          >
            <dt>{emotion.label}</dt>
            <dd className="tabular-nums">
              {formatEmotionAverage(emotion.value)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Fixed-scale radar with the same constituent details available by mouse or keyboard. */
export function EmotionDetails({
  emotionalState,
  className,
  sourceLabel,
  showSummary = true,
}: Omit<EmotionalStateProps, "variant"> & { showSummary?: boolean }) {
  const presentation = buildEmotionPresentation(emotionalState);
  const [selectedGroup, setSelectedGroup] = useState<EmotionGroup | null>(null);
  const detailId = useId();
  const activeGroup = selectedGroup ?? presentation.dominantGroup;
  const selected =
    presentation.groups.find((group) => group.group === activeGroup) ??
    presentation.groups[0];
  return (
    <section
      className={cn("space-y-5", className)}
      aria-label="Emotional state"
    >
      {showSummary ? <EmotionSummary emotionalState={emotionalState} /> : null}
      {sourceLabel ? (
        <p className="text-muted-foreground text-xs">{sourceLabel}</p>
      ) : null}
      {presentation.dominantGroup === "neutral" ? null : (
        <div
          className="h-64 w-full sm:h-72"
          role="img"
          aria-label={`Emotion group averages, from 0 to 30. ${presentation.feeling.label}. Values are available in the legend below.`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart
              data={presentation.groups}
              outerRadius="72%"
              margin={{ top: 12, right: 24, bottom: 12, left: 24 }}
            >
              <PolarGrid
                gridType="circle"
                radialLines
                stroke="var(--border)"
                strokeOpacity={0.5}
              />
              <PolarAngleAxis
                dataKey="label"
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                tickLine={false}
              />
              <PolarRadiusAxis
                domain={[0, 30]}
                ticks={[0, 10, 20, 30]}
                tick={false}
                axisLine={false}
              />
              <Tooltip
                content={({ active, payload }) => {
                  const group = payload?.[0]?.payload as
                    | EmotionGroupDatum
                    | undefined;
                  return active && group ? (
                    <div className="border-border bg-popover text-popover-foreground min-w-48 rounded-xl border p-4 shadow-lg">
                      <GroupDetail group={group} />
                    </div>
                  ) : null;
                }}
              />
              <Radar
                dataKey="average"
                name="Group average"
                stroke={presentation.color}
                fill={presentation.color}
                fillOpacity={0.1}
                strokeWidth={1.5}
                isAnimationActive={false}
                dot={(props: {
                  cx?: number;
                  cy?: number;
                  payload?: EmotionGroupDatum;
                }) => (
                  <circle
                    key={props.payload?.group}
                    cx={props.cx}
                    cy={props.cy}
                    r={3.5}
                    fill={EMOTION_PALETTE[props.payload?.group ?? "neutral"]}
                    stroke="var(--background)"
                    strokeWidth={1.5}
                  />
                )}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className="text-muted-foreground text-xs">
        Group averages · scale 0–30
      </p>
      <div className="grid gap-4">
        <div
          className="grid grid-cols-2 content-start gap-1"
          aria-label="Emotion group details"
        >
          {presentation.groups.map((group) => (
            <button
              key={group.group}
              type="button"
              aria-describedby={
                activeGroup === group.group ? detailId : undefined
              }
              onMouseEnter={() => setSelectedGroup(group.group)}
              onFocus={() => setSelectedGroup(group.group)}
              onClick={() => setSelectedGroup(group.group)}
              className={cn(
                "focus-visible:ring-ring flex min-h-10 items-center gap-2 rounded-lg px-2 text-left text-xs outline-none focus-visible:ring-2",
                activeGroup === group.group ? "bg-muted" : "hover:bg-muted/60",
              )}
            >
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: group.color }}
              />
              <span className="min-w-0 flex-1">{group.label}</span>
              <span className="text-muted-foreground tabular-nums">
                {formatEmotionAverage(group.average)}
              </span>
            </button>
          ))}
        </div>
        <div
          id={detailId}
          className="border-border bg-muted/20 rounded-xl border p-4"
        >
          <GroupDetail group={selected} />
        </div>
      </div>
    </section>
  );
}

/** Retain the existing consumer API while keeping summaries free of chart diagnostics. */
export function EmotionalState({
  emotionalState,
  className,
  variant = "default",
  sourceLabel = null,
}: EmotionalStateProps) {
  return (
    <EmotionDetails
      emotionalState={emotionalState}
      className={cn(
        (variant === "compact" || variant === "showcase") &&
          "[&_[role=img]]:h-52",
        variant === "inline" && "[&_[role=img]]:h-60",
        className,
      )}
      sourceLabel={sourceLabel}
    />
  );
}
