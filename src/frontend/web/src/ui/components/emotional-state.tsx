"use client";

import { memo, useId, useMemo, useState, type ReactNode } from "react";
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  type BaseTickContentProps,
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

/** A focusable axis label doubles as the touch target for that group's details. */
function EmotionAxisLabel({
  x = 0,
  y = 0,
  textAnchor = "middle",
  index = 0,
  groups,
  onSelect,
  detailId,
}: Partial<BaseTickContentProps> & {
  groups: EmotionGroupDatum[];
  onSelect: (group: EmotionGroup) => void;
  detailId: string;
}) {
  const group = groups[index];
  const select = () => onSelect(group.group);
  const anchor = textAnchor;
  const left = anchor === "end" ? -76 : anchor === "start" ? -6 : -41;
  return (
    <g
      transform={`translate(${x},${y})`}
      role="button"
      tabIndex={0}
      aria-label={`${group.label}: ${group.maximum}. ${group.emotions.map((emotion) => `${emotion.label} ${emotion.value}`).join(", ")}`}
      aria-describedby={detailId}
      onMouseEnter={select}
      onFocus={select}
      onClick={select}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          select();
        }
      }}
      className="group cursor-pointer outline-none"
    >
      <rect
        x={left}
        y={-16}
        width={82}
        height={32}
        rx={6}
        fill="transparent"
        className="group-focus-visible:stroke-ring"
        strokeWidth={2}
      />
      <text
        textAnchor={anchor}
        dominantBaseline="central"
        fill="var(--foreground)"
        fontSize={11}
        className="group-hover:font-semibold group-focus:font-semibold"
      >
        {group.label}
      </text>
    </g>
  );
}

/** Keep SVG axis nodes mounted while the separately rendered hover caption changes. */
const EmotionRadar = memo(function EmotionRadar({
  groups,
  color,
  onSelect,
  detailId,
}: {
  groups: EmotionGroupDatum[];
  color: string;
  onSelect: (group: EmotionGroup) => void;
  detailId: string;
}) {
  return (
    <div
      className="emotion-radar h-72 w-full"
      role="group"
      aria-label="Emotion spectrum: eight groups, each showing its strongest emotion"
    >
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart
          data={groups}
          outerRadius="65%"
          margin={{ top: 18, right: 28, bottom: 18, left: 28 }}
          onMouseMove={(state) => {
            const group = groups.find(
              (candidate) => candidate.label === state.activeLabel,
            );
            if (group) onSelect(group.group);
          }}
        >
          <PolarGrid
            gridType="circle"
            radialLines
            stroke="var(--border)"
            strokeOpacity={0.5}
          />
          <PolarAngleAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={
              <EmotionAxisLabel
                groups={groups}
                onSelect={onSelect}
                detailId={detailId}
              />
            }
          />
          <PolarRadiusAxis
            domain={[0, 30]}
            ticks={[0, 10, 20, 30]}
            tick={false}
            axisLine={false}
          />
          <Radar
            dataKey="maximum"
            name="Strongest emotion"
            stroke={color}
            fill={color}
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
                onMouseEnter={() => {
                  if (props.payload) onSelect(props.payload.group);
                }}
              />
            )}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
});

/** A fixed-scale radar with interaction details reserved outside the plot. */
export function EmotionDetails({
  emotionalState,
  className,
  showSummary = true,
}: Omit<EmotionalStateProps, "variant"> & { showSummary?: boolean }) {
  const presentation = useMemo(
    () => buildEmotionPresentation(emotionalState),
    [emotionalState],
  );
  const [selectedGroup, setSelectedGroup] = useState<EmotionGroup | null>(null);
  const detailId = useId();
  const selected = presentation.groups.find(
    (group) => group.group === selectedGroup,
  );
  const neutral = presentation.dominantGroup === "neutral";
  return (
    <section
      className={cn("space-y-3", className)}
      aria-label="Emotional state"
    >
      {showSummary ? <EmotionSummary emotionalState={emotionalState} /> : null}
      {neutral ? (
        !showSummary ? (
          <p className="text-muted-foreground py-3 text-sm">
            No active emotions.
          </p>
        ) : null
      ) : (
        <>
          <EmotionRadar
            groups={presentation.groups}
            color={presentation.color}
            onSelect={setSelectedGroup}
            detailId={detailId}
          />
          {/* A reserved caption never overlaps the radar or shifts it on hover. */}
          <div
            id={detailId}
            className="min-h-20 px-1 text-sm"
            aria-live="polite"
          >
            {selected ? (
              <>
                <p className="mb-2 flex items-center gap-2 font-medium">
                  <span
                    aria-hidden="true"
                    className="size-2 rounded-full"
                    style={{ backgroundColor: selected.color }}
                  />
                  {selected.label}{" "}
                  <span className="text-muted-foreground tabular-nums">
                    {formatEmotionAverage(selected.maximum)}
                  </span>
                </p>
                <dl className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  {selected.emotions.map((emotion) => (
                    <div key={emotion.emotion} className="flex gap-1.5">
                      <dt>{emotion.label}</dt>
                      <dd className="tabular-nums">{emotion.value}</dd>
                    </div>
                  ))}
                </dl>
              </>
            ) : (
              <p className="text-muted-foreground text-xs">
                Hover or select an emotion to explore it.
              </p>
            )}
          </div>
        </>
      )}
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
          "[&_.emotion-radar]:h-60",
        variant === "inline" && "[&_.emotion-radar]:h-60",
        className,
      )}
      sourceLabel={sourceLabel}
    />
  );
}
