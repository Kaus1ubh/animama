"use client";

import { ChevronDown, RotateCcw } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/ui/components/button";
import { FieldLabel } from "@/ui/components/field";
import { Input } from "@/ui/components/input";
import { Slider } from "@/ui/components/slider";
import type {
  SceneCameraBindings,
  SceneCameraSettings,
  SceneCameraYBoneBinding,
  SceneVector3,
} from "./sceneCameraPresets";

type SceneCameraPanelProps = {
  bindings: SceneCameraBindings;
  className?: string;
  settings: SceneCameraSettings;
  onOrbitTargetYBoneChange: (value: SceneCameraYBoneBinding) => void;
  onFovChange: (value: number) => void;
  onPositionChange: (axis: keyof SceneVector3, value: number) => void;
  onPositionYBoneChange: (value: SceneCameraYBoneBinding) => void;
  onReset: () => void;
  onTargetChange: (axis: keyof SceneVector3, value: number) => void;
};

type NumericInputProps = {
  ariaLabel: string;
  disabled?: boolean;
  onValueChange: (value: number) => void;
  precision: number;
  value: number;
};

const AXES: Array<keyof SceneVector3> = ["x", "y", "z"];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatNumber(value: number, precision: number): string {
  return String(Number(value.toFixed(precision)));
}

function NumericInput({
  ariaLabel,
  disabled = false,
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

    if (parsed !== value) onValueChange(parsed);
    setDraft(formatNumber(parsed, precision));
  };

  return (
    <Input
      aria-label={ariaLabel}
      className="h-8 px-2 text-right font-mono text-xs tabular-nums"
      disabled={disabled}
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
        if (parsed !== value) onValueChange(parsed);
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

function VectorControl({
  disabledAxes,
  label,
  onValueChange,
  value,
}: {
  disabledAxes?: Partial<Record<keyof SceneVector3, boolean>>;
  label: string;
  onValueChange: (axis: keyof SceneVector3, nextValue: number) => void;
  value: SceneVector3;
}) {
  return (
    <div className="space-y-2">
      <FieldLabel className="text-muted-foreground text-2xs font-medium tracking-wide uppercase">
        {label}
      </FieldLabel>
      <div className="grid grid-cols-3 gap-2">
        {AXES.map((axis) => (
          <div key={axis} className="space-y-1">
            <FieldLabel className="text-muted-foreground text-2xs font-semibold uppercase">
              {axis}
            </FieldLabel>
            <NumericInput
              ariaLabel={`${label} ${axis.toUpperCase()}`}
              disabled={disabledAxes?.[axis] === true}
              onValueChange={(nextValue) => onValueChange(axis, nextValue)}
              precision={2}
              value={value[axis]}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SceneCameraPanel({
  className,
  settings,
  bindings,
  onOrbitTargetYBoneChange,
  onFovChange,
  onPositionChange,
  onPositionYBoneChange,
  onReset,
  onTargetChange,
}: SceneCameraPanelProps) {
  return (
    <div className={cn("space-y-3", className)}>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <FieldLabel className="text-muted-foreground text-2xs font-medium tracking-wide uppercase">
            Camera Y Source
          </FieldLabel>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={onReset}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </Button>
        </div>
        <div className="relative">
          <select
            aria-label="Camera Y source"
            className="border-input bg-background focus-visible:ring-ring h-8 w-full appearance-none rounded-md border pr-10 pl-3 text-xs outline-none focus-visible:ring-2"
            value={bindings.positionYBone}
            onChange={(event) =>
              onPositionYBoneChange(
                event.target.value as SceneCameraYBoneBinding,
              )
            }
          >
            <option value="manual">Manual</option>
            <option value="hips">Hips</option>
            <option value="chest">Chest</option>
            <option value="head">Head</option>
          </select>
          <ChevronDown
            aria-hidden="true"
            className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2"
          />
        </div>
      </div>
      <VectorControl
        disabledAxes={{ y: bindings.positionYBone !== "manual" }}
        label="Camera Position"
        onValueChange={onPositionChange}
        value={settings.position}
      />
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <FieldLabel className="text-muted-foreground text-2xs font-medium tracking-wide uppercase">
            Field Of View
          </FieldLabel>
          <NumericInput
            ariaLabel="Camera field of view"
            onValueChange={(nextValue) => onFovChange(clamp(nextValue, 10, 90))}
            precision={1}
            value={settings.fov}
          />
        </div>
        <Slider
          min={10}
          max={90}
          step={0.5}
          value={[settings.fov]}
          onValueChange={([nextValue]) => {
            if (typeof nextValue !== "number") return;
            onFovChange(nextValue);
          }}
        />
      </div>
      <div className="space-y-2">
        <FieldLabel className="text-muted-foreground text-2xs font-medium tracking-wide uppercase">
          Orbit Target Y Source
        </FieldLabel>
        <div className="relative">
          <select
            aria-label="Orbit target Y source"
            className="border-input bg-background focus-visible:ring-ring h-8 w-full appearance-none rounded-md border pr-10 pl-3 text-xs outline-none focus-visible:ring-2"
            value={bindings.orbitTargetYBone}
            onChange={(event) =>
              onOrbitTargetYBoneChange(
                event.target.value as SceneCameraYBoneBinding,
              )
            }
          >
            <option value="manual">Manual</option>
            <option value="hips">Hips</option>
            <option value="chest">Chest</option>
            <option value="head">Head</option>
          </select>
          <ChevronDown
            aria-hidden="true"
            className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2"
          />
        </div>
      </div>
      <VectorControl
        disabledAxes={{ y: bindings.orbitTargetYBone !== "manual" }}
        label="Orbit Target"
        onValueChange={onTargetChange}
        value={settings.orbitTarget}
      />
    </div>
  );
}
