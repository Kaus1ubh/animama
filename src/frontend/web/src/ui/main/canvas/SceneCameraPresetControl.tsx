"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/ui/components/button";
import {
  SCENE_CAMERA_PRESETS,
  type SceneCameraPreset,
} from "./sceneCameraPresets";

/** Cycle the live camera presets without exposing advanced numeric controls. */
export function SceneCameraPresetControl({
  preset,
  onApplyPreset,
}: {
  preset: SceneCameraPreset | null;
  onApplyPreset: (preset: SceneCameraPreset) => void;
}) {
  const index = SCENE_CAMERA_PRESETS.findIndex(
    (option) => option.value === preset,
  );
  const cycle = (direction: -1 | 1) => {
    const nextIndex =
      index < 0
        ? direction === 1
          ? 0
          : SCENE_CAMERA_PRESETS.length - 1
        : (index + direction + SCENE_CAMERA_PRESETS.length) %
          SCENE_CAMERA_PRESETS.length;
    onApplyPreset(SCENE_CAMERA_PRESETS[nextIndex].value);
  };

  return (
    <section
      aria-label="Camera"
      className="border-border/60 space-y-2 border-t pt-3"
    >
      <h3 className="text-sm font-medium">Camera</h3>
      <div className="grid min-w-0 grid-cols-[1fr_2fr_1fr] items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          className="hover:bg-muted/70 dark:hover:bg-muted/70 hover:text-foreground h-10 w-full bg-transparent"
          aria-label="Previous camera preset"
          onClick={() => cycle(-1)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span aria-live="polite" className="min-w-0 text-center text-sm">
          {SCENE_CAMERA_PRESETS[index]?.label ?? "Custom"}
        </span>
        <Button
          type="button"
          variant="ghost"
          className="hover:bg-muted/70 dark:hover:bg-muted/70 hover:text-foreground h-10 w-full bg-transparent"
          aria-label="Next camera preset"
          onClick={() => cycle(1)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </section>
  );
}
