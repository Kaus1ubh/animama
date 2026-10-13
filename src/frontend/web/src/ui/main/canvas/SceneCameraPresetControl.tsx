"use client";

import { ChevronDown } from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import {
  SCENE_CAMERA_PRESETS,
  type SceneCameraPreset,
} from "./sceneCameraPresets";

/** Display name of a camera preset. */
function presetLabel(t: TFunction<"chat">, preset: SceneCameraPreset) {
  switch (preset) {
    case "full-body":
      return t("canvas.camera.presets.fullBody");
    case "full-body-close":
      return t("canvas.camera.presets.fullBodyClose");
    case "portrait":
      return t("canvas.camera.presets.portrait");
    case "portrait-close":
      return t("canvas.camera.presets.portraitClose");
  }
}

/** Select a live camera preset; the native menu also works inside fullscreen. */
export function SceneCameraPresetControl({
  preset,
  onApplyPreset,
}: {
  preset: SceneCameraPreset | null;
  onApplyPreset: (preset: SceneCameraPreset) => void;
}) {
  const { t } = useTranslation("chat");
  return (
    <section
      aria-label={t("canvas.camera.title")}
      className="border-border/60 space-y-2 border-t pt-3"
    >
      <h3 className="text-sm font-medium">{t("canvas.camera.title")}</h3>
      <div className="relative">
        <select
          aria-label={t("canvas.camera.preset")}
          className="border-input bg-background focus-visible:ring-ring h-10 w-full appearance-none rounded-md border pr-10 pl-3 text-sm outline-none focus-visible:ring-2"
          value={preset ?? "custom"}
          onChange={(event) => {
            const selected = SCENE_CAMERA_PRESETS.find(
              (option) => option === event.target.value,
            );
            if (selected) onApplyPreset(selected);
          }}
        >
          {preset === null ? (
            <option value="custom" disabled>
              {t("canvas.camera.custom")}
            </option>
          ) : null}
          {SCENE_CAMERA_PRESETS.map((value) => (
            <option key={value} value={value}>
              {presetLabel(t, value)}
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
