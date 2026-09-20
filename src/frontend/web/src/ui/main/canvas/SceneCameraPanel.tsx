"use client";

import { RotateCcw } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/ui/components/button";
import { FieldLabel } from "@/ui/components/field";
import { Input } from "@/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/select";
import { Slider } from "@/ui/components/slider";
import { SCENE_CAMERA_PRESETS } from "./sceneCameraPresets";
import type {
  SceneCameraBindings,
  SceneCameraPreset,
  SceneCameraSettings,
  SceneCameraYBoneBinding,
  SceneVector3,
} from "./sceneCameraPresets";

type SceneCameraPanelProps = {
  bindings: SceneCameraBindings;
  className?: string;
  settings: SceneCameraSettings;
  onApplyPreset?: (preset: SceneCameraPreset) => void;
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
      <FieldLabel className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
        {label}
      </FieldLabel>
      <div className="grid grid-cols-3 gap-2">
        {AXES.map((axis) => (
          <div key={axis} className="space-y-1">
            <FieldLabel className="text-muted-foreground text-[10px] font-semibold uppercase">
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
  onApplyPreset,
  onOrbitTargetYBoneChange,
  onFovChange,
  onPositionChange,
  onPositionYBoneChange,
  onReset,
  onTargetChange,
}: SceneCameraPanelProps) {
  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Scene Camera</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-xs"
          onClick={onReset}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset
        </Button>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <FieldLabel className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
            Presets
          </FieldLabel>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {SCENE_CAMERA_PRESETS.map(({ label, value }) => (
            <Button
              key={value}
              type="button"
              variant="outline"
              size="sm"
              className="h-auto min-h-8 px-2 py-1.5 text-left text-xs"
              onClick={() => onApplyPreset?.(value)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <FieldLabel className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
          Camera Y Source
        </FieldLabel>
        <Select
          value={bindings.positionYBone}
          onValueChange={(value) =>
            onPositionYBoneChange(value as SceneCameraYBoneBinding)
          }
        >
          <SelectTrigger
            aria-label="Camera Y source"
            className="w-full"
            size="sm"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="manual">Manual</SelectItem>
            <SelectItem value="hips">Hips</SelectItem>
            <SelectItem value="chest">Chest</SelectItem>
            <SelectItem value="head">Head</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <VectorControl
        disabledAxes={{ y: bindings.positionYBone !== "manual" }}
        label="Camera Position"
        onValueChange={onPositionChange}
        value={settings.position}
      />
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <FieldLabel className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
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
        <FieldLabel className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
          Orbit Target Y Source
        </FieldLabel>
        <Select
          value={bindings.orbitTargetYBone}
          onValueChange={(value) =>
            onOrbitTargetYBoneChange(value as SceneCameraYBoneBinding)
          }
        >
          <SelectTrigger
            aria-label="Orbit target Y source"
            className="w-full"
            size="sm"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="manual">Manual</SelectItem>
            <SelectItem value="hips">Hips</SelectItem>
            <SelectItem value="chest">Chest</SelectItem>
            <SelectItem value="head">Head</SelectItem>
          </SelectContent>
        </Select>
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
