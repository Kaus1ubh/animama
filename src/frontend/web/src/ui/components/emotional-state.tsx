"use client";

import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  type BaseTickContentProps,
} from "recharts";
import { useTranslation } from "react-i18next";
import { useFormatters } from "@animama/product-ui/i18n";
import { type EmotionGroup } from "@/lib/emotion";
import {
  buildEmotionPresentation,
  formatEmotionAverage,
  EMOTION_PALETTE,
} from "@/lib/emotion/presentation";
import { cn } from "@/lib/utils";
import { EmotionMascot } from "@/ui/components/emotion-mascot";

type EmotionalStateProps = {
  emotionalState?: unknown;
  className?: string;
  variant?: "default" | "compact" | "showcase" | "inline";
  sourceLabel?: string | null;
};
type EmotionGroupDatum = ReturnType<
  typeof buildEmotionPresentation
>["groups"][number];

type EmotionSelection = {
  group: EmotionGroup;
  input: "pointer" | "keyboard" | "touch";
} | null;
const EmotionSelectionContext = createContext<EmotionGroup | null>(null);
type SelectEmotion = (
  group: EmotionGroup,
  input: NonNullable<EmotionSelection>["input"],
) => void;

/** Selection styling updates independently from Recharts so keyboard focus survives. */
function EmotionRadarDot({
  cx,
  cy,
  payload,
}: {
  cx?: number;
  cy?: number;
  payload?: EmotionGroupDatum;
}) {
  const selectedGroup = useContext(EmotionSelectionContext);
  const active = selectedGroup === payload?.group;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={active ? 5.5 : 3.5}
      fill={EMOTION_PALETTE[payload?.group ?? "neutral"]}
      stroke={
        active
          ? EMOTION_PALETTE[payload?.group ?? "neutral"]
          : "var(--background)"
      }
      strokeWidth={active ? 3 : 1.5}
      strokeOpacity={active ? 0.3 : 1}
    />
  );
}

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
  const { t } = useTranslation("emotion");
  const presentation = buildEmotionPresentation(emotionalState, t);
  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-medium">
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-full"
          >
            <EmotionMascot
              src={presentation.feeling.mascot}
              className="size-9"
            />
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
      ) : null}
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
  onBlur,
  detailId,
}: Partial<BaseTickContentProps> & {
  groups: EmotionGroupDatum[];
  onSelect: SelectEmotion;
  onBlur: () => void;
  detailId: string;
}) {
  const { t } = useTranslation("emotion");
  const formatters = useFormatters();
  const group = groups[index];
  const selectedGroup = useContext(EmotionSelectionContext);
  const pointerType = useRef<string | null>(null);
  const select = (input: NonNullable<EmotionSelection>["input"]) =>
    onSelect(group.group, input);
  const active = selectedGroup === group.group;
  const anchor = textAnchor;
  const left = anchor === "end" ? -76 : anchor === "start" ? -6 : -41;
  return (
    <g
      transform={`translate(${x},${y})`}
      role="button"
      data-emotion-axis-label=""
      tabIndex={0}
      aria-label={t("radar.axis", {
        group: group.label,
        maximum: formatters.number(group.maximum),
        emotions: formatters.list(
          group.emotions.map((emotion) =>
            t("radar.axisEmotion", {
              emotion: emotion.label,
              value: formatters.number(emotion.value),
            }),
          ),
        ),
      })}
      aria-describedby={detailId}
      onMouseEnter={() => select("pointer")}
      onPointerDown={(event) => {
        pointerType.current = event.pointerType;
      }}
      onFocus={(event) => {
        if (event.currentTarget.matches(":focus-visible")) select("keyboard");
      }}
      onBlur={onBlur}
      onClick={() =>
        select(pointerType.current === "touch" ? "touch" : "pointer")
      }
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          select("keyboard");
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
        fill={active ? group.color : "var(--foreground)"}
        fontWeight={active ? 600 : 400}
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
  onBlur,
  onClearPointer,
  detailId,
}: {
  groups: EmotionGroupDatum[];
  color: string;
  onSelect: SelectEmotion;
  onBlur: () => void;
  onClearPointer: () => void;
  detailId: string;
}) {
  const { t } = useTranslation("emotion");
  return (
    <div
      className="emotion-radar h-80 w-full"
      role="group"
      aria-label={t("radar.label")}
    >
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart
          data={groups}
          outerRadius="76%"
          margin={{ top: 12, right: 38, bottom: 12, left: 38 }}
          onMouseMove={(state, event) => {
            // Axis labels sit outside the polar grid and own their hover selection.
            if (
              event.target instanceof Element &&
              event.target.closest("[data-emotion-axis-label]")
            )
              return;
            const group = groups.find(
              (candidate) => candidate.label === state.activeLabel,
            );
            if (state.isTooltipActive && group)
              onSelect(group.group, "pointer");
            else onClearPointer();
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
                onBlur={onBlur}
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
            name={t("radar.series")}
            stroke={color}
            fill={color}
            fillOpacity={0.1}
            strokeWidth={1.5}
            isAnimationActive={false}
            dot={(props: {
              cx?: number;
              cy?: number;
              payload?: EmotionGroupDatum;
            }) => <EmotionRadarDot key={props.payload?.group} {...props} />}
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
  const { t } = useTranslation("emotion");
  const formatters = useFormatters();
  // `t` changes with the UI Locale, so a language switch rebuilds the labels.
  const presentation = useMemo(
    () => buildEmotionPresentation(emotionalState, t),
    [emotionalState, t],
  );
  const [selection, setSelection] = useState<EmotionSelection>(null);
  const select = useCallback<SelectEmotion>(
    (group, input) => setSelection({ group, input }),
    [],
  );
  const clearFocus = useCallback(() => setSelection(null), []);
  const clearPointer = useCallback(
    () =>
      setSelection((current) =>
        current?.input === "pointer" ? null : current,
      ),
    [],
  );
  const interactionRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selection?.input !== "touch") return;
    const clearOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !interactionRef.current?.contains(event.target)
      )
        setSelection(null);
    };
    document.addEventListener("pointerdown", clearOutside);
    return () => document.removeEventListener("pointerdown", clearOutside);
  }, [selection?.input]);
  const detailId = useId();
  const selected = presentation.groups.find(
    (group) => group.group === selection?.group,
  );
  return (
    <section
      className={cn("space-y-3", className)}
      aria-label={t("details.label")}
    >
      {showSummary ? <EmotionSummary emotionalState={emotionalState} /> : null}
      <div
        ref={interactionRef}
        onPointerLeave={(event) => {
          if (event.pointerType !== "touch")
            setSelection((current) =>
              current?.input === "keyboard" ? current : null,
            );
        }}
      >
        <EmotionSelectionContext.Provider value={selection?.group ?? null}>
          <EmotionRadar
            groups={presentation.groups}
            color={presentation.color}
            onSelect={select}
            onBlur={clearFocus}
            onClearPointer={clearPointer}
            detailId={detailId}
          />
        </EmotionSelectionContext.Provider>
        {/* A reserved caption never overlaps the radar or shifts it on hover. */}
        <div
          id={detailId}
          className="min-h-14 px-1 pb-1 text-sm"
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
                  {formatEmotionAverage(selected.maximum, formatters)}
                </span>
              </p>
              <dl className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {selected.emotions.map((emotion) => (
                  <div key={emotion.emotion} className="flex gap-1.5">
                    <dt>{emotion.label}</dt>
                    <dd className="tabular-nums">
                      {formatters.number(emotion.value)}
                    </dd>
                  </div>
                ))}
              </dl>
            </>
          ) : null}
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
          "[&_.emotion-radar]:h-60",
        variant === "inline" && "[&_.emotion-radar]:h-60",
        className,
      )}
      sourceLabel={sourceLabel}
    />
  );
}
