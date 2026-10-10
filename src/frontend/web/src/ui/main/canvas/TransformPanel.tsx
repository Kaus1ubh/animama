"use client";

import { MathUtils } from "three";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/ui/components/card";
import { Field, FieldLabel } from "@/ui/components/field";
import { Input } from "@/ui/components/input";
import { Slider } from "@/ui/components/slider";
import { Switch } from "@/ui/components/switch";
import { cn } from "@/lib/utils";
import type {
  AvatarTransform,
  TransformAxis,
  TransformMode,
} from "./transform-state";

type TransformPanelProps = {
  className?: string;
  compact?: boolean;
  mode: TransformMode;
  transform: AvatarTransform;
  uniformScaleLocked: boolean;
  onPositionChange: (axis: TransformAxis, value: number) => void;
  onRotationChangeDegrees: (axis: TransformAxis, value: number) => void;
  onScaleChange: (axis: TransformAxis, value: number) => void;
  onUniformScaleLockedChange: (checked: boolean) => void;
  showShortcut?: boolean;
};

type AxisControlProps = {
  axis: TransformAxis;
  compact?: boolean;
  inputAriaLabel: string;
  max: number;
  min: number;
  normalize?: (value: number) => number;
  onValueChange: (value: number) => void;
  precision: number;
  step: number;
  value: number;
};

type NumericInputProps = {
  ariaLabel: string;
  compact?: boolean;
  normalize?: (value: number) => number;
  onValueChange: (value: number) => void;
  precision: number;
  value: number;
};

const AXES: TransformAxis[] = ["x", "y", "z"];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatNumber(value: number, precision: number): string {
  return String(Number(value.toFixed(precision)));
}

function NumericInput({
  ariaLabel,
  compact = false,
  normalize,
  onValueChange,
  precision,
  value,
}: NumericInputProps) {
  const [draft, setDraft] = useState(() => formatNumber(value, precision));
  const [isFocused, setIsFocused] = useState(false);
  const displayValue = isFocused ? draft : formatNumber(value, precision);

  const commit = () => {
    const parsed = Number.parseFloat(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(formatNumber(value, precision));
      return;
    }

    const nextValue = normalize ? normalize(parsed) : parsed;
    onValueChange(nextValue);
    setDraft(formatNumber(nextValue, precision));
  };

  return (
    <Input
      aria-label={ariaLabel}
      className={cn(
        "h-8 px-2 text-right font-mono text-xs tabular-nums",
        compact && "text-2xs h-6 px-1",
      )}
      inputMode="decimal"
      type="text"
      value={displayValue}
      onBlur={() => {
        setIsFocused(false);
        commit();
      }}
      onChange={(event) => {
        const nextDraft = event.target.value;
        setDraft(nextDraft);

        if (
          nextDraft === "" ||
          nextDraft === "-" ||
          nextDraft === "." ||
          nextDraft === "-."
        ) {
          return;
        }

        const parsed = Number.parseFloat(nextDraft);
        if (!Number.isFinite(parsed)) return;
        onValueChange(normalize ? normalize(parsed) : parsed);
      }}
      onFocus={() => {
        setDraft(formatNumber(value, precision));
        setIsFocused(true);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function AxisControl({
  axis,
  compact = false,
  inputAriaLabel,
  max,
  min,
  normalize,
  onValueChange,
  precision,
  step,
  value,
}: AxisControlProps) {
  const sliderValue = clamp(value, min, max);

  return (
    <div
      className={cn(
        "grid grid-cols-[1rem_minmax(0,1fr)_4.75rem] items-center gap-3",
        compact && "grid-cols-[0.65rem_minmax(0,1fr)_3rem] gap-1",
      )}
    >
      <FieldLabel className="text-muted-foreground text-2xs font-semibold uppercase">
        {axis}
      </FieldLabel>
      <Slider
        max={max}
        min={min}
        step={step}
        value={[sliderValue]}
        onValueChange={([nextValue]) => {
          if (typeof nextValue !== "number") return;
          onValueChange(normalize ? normalize(nextValue) : nextValue);
        }}
      />
      <NumericInput
        ariaLabel={inputAriaLabel}
        compact={compact}
        normalize={normalize}
        onValueChange={onValueChange}
        precision={precision}
        value={value}
      />
    </div>
  );
}

export function TransformPanel({
  className,
  compact = false,
  mode,
  transform,
  uniformScaleLocked,
  onPositionChange,
  onRotationChangeDegrees,
  onScaleChange,
  onUniformScaleLockedChange,
  showShortcut = true,
}: TransformPanelProps) {
  const { t } = useTranslation("chat");
  const title =
    mode === "translate"
      ? t("canvas.transform.titles.translate")
      : mode === "rotate"
        ? t("canvas.transform.titles.rotate")
        : t("canvas.transform.titles.scale");
  const shortcut = mode === "translate" ? "G" : mode === "rotate" ? "R" : "S";

  return (
    <div
      className={cn(
        "pointer-events-auto absolute top-3 right-3 z-20 w-[22rem] max-w-[calc(100vw-1rem)]",
        className,
      )}
    >
      <Card className="border-border/80 bg-background/90 supports-[backdrop-filter]:bg-background/75 shadow-lg backdrop-blur">
        <CardHeader
          className={cn(
            "space-y-1 px-3 py-2",
            compact && "space-y-0 px-2 py-1",
          )}
        >
          <CardTitle className={cn("text-sm", compact && "text-xs")}>
            {title}
          </CardTitle>
          {showShortcut ? (
            <CardDescription className="text-xs">
              {t("canvas.transform.shortcut", { key: shortcut })}
            </CardDescription>
          ) : null}
        </CardHeader>
        <CardContent
          className={cn(
            "space-y-3 px-3 pt-1 pb-3 text-xs",
            compact && "space-y-1.5 px-2 pt-0.5 pb-2",
          )}
        >
          {mode === "translate"
            ? AXES.map((axis) => (
                <AxisControl
                  key={axis}
                  axis={axis}
                  compact={compact}
                  inputAriaLabel={t("canvas.transform.position", {
                    axis: axis.toUpperCase(),
                  })}
                  max={5}
                  min={-5}
                  onValueChange={(value) => onPositionChange(axis, value)}
                  precision={2}
                  step={0.01}
                  value={transform.position[axis]}
                />
              ))
            : null}
          {mode === "rotate"
            ? AXES.map((axis) => (
                <AxisControl
                  key={axis}
                  axis={axis}
                  compact={compact}
                  inputAriaLabel={t("canvas.transform.rotation", {
                    axis: axis.toUpperCase(),
                  })}
                  max={180}
                  min={-180}
                  onValueChange={(value) =>
                    onRotationChangeDegrees(axis, value)
                  }
                  precision={1}
                  step={1}
                  value={MathUtils.radToDeg(transform.rotation[axis])}
                />
              ))
            : null}
          {mode === "scale" ? (
            <>
              <Field orientation="horizontal">
                <div className="space-y-0.5">
                  <FieldLabel className="text-xs">
                    {t("canvas.transform.uniformScale")}
                  </FieldLabel>
                  <p className="text-muted-foreground text-2xs">
                    {t("canvas.transform.uniformScaleDescription")}
                  </p>
                </div>
                <Switch
                  checked={uniformScaleLocked}
                  onCheckedChange={onUniformScaleLockedChange}
                />
              </Field>
              {AXES.map((axis) => (
                <AxisControl
                  key={axis}
                  axis={axis}
                  compact={compact}
                  inputAriaLabel={t("canvas.transform.scale", {
                    axis: axis.toUpperCase(),
                  })}
                  max={3}
                  min={0.1}
                  normalize={(value) => Math.max(0.001, value)}
                  onValueChange={(value) => onScaleChange(axis, value)}
                  precision={2}
                  step={0.01}
                  value={transform.scale[axis]}
                />
              ))}
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
