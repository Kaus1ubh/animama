"use client";

import { ChevronDown } from "lucide-react";

import {
  SCENE_CAMERA_PRESETS,
  type SceneCameraPreset,
} from "./sceneCameraPresets";

/** Select a live camera preset; the native menu also works inside fullscreen. */
export function SceneCameraPresetControl({
  preset,
  onApplyPreset,
}: {
  preset: SceneCameraPreset | null;
  onApplyPreset: (preset: SceneCameraPreset) => void;
}) {
  return (
    <section
      aria-label="Camera"
      className="border-border/60 space-y-2 border-t pt-3"
    >
      <h3 className="text-sm font-medium">Camera</h3>
      <div className="relative">
        <select
          aria-label="Camera preset"
          className="border-input bg-background focus-visible:ring-ring h-10 w-full appearance-none rounded-md border pr-10 pl-3 text-sm outline-none focus-visible:ring-2"
          value={preset ?? "custom"}
          onChange={(event) => {
            const selected = SCENE_CAMERA_PRESETS.find(
              (option) => option.value === event.target.value,
            );
            if (selected) onApplyPreset(selected.value);
          }}
        >
          {preset === null ? (
            <option value="custom" disabled>
              Custom
            </option>
          ) : null}
          {SCENE_CAMERA_PRESETS.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2"
        />
      </div>
    </section>
  );
}
