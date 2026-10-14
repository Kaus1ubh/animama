import type { PyIdleStylePreview } from "@/lib/content/catalogTypes";
import type { AnimaRuntimeCatalogSnapshot } from "@/lib/runtime-content/types";
import type { ContentPreviewTarget } from "@/lib/content-preview/types";
import { actionPreviewTarget } from "@/lib/content-preview/actionPreviewTarget";
import { WordedError } from "@/lib/errors/apiError";
import { getI18n } from "react-i18next";

/** Reuse Gesture preview so idle clip/VRMA events retain their sound/effect closure. */
export function idleStylePreviewTarget(
  preview: PyIdleStylePreview,
  label: string,
  animaId?: string,
  animaRuntime?: AnimaRuntimeCatalogSnapshot,
): ContentPreviewTarget {
  const t = getI18n().getFixedT(null, "actionEditor");
  const playback = preview.idle_playback;
  if (
    !playback.eligible ||
    !playback.time_scale ||
    !playback.repetitions ||
    !playback.duration_seconds ||
    !playback.loop_type
  ) {
    throw new WordedError(t("preview.errors.idlePlaybackUnavailable"));
  }
  const target = actionPreviewTarget(
    preview,
    preview.selected_gesture_name || label,
  );
  return {
    ...target,
    key: `idle-style:${target.key}:${preview.selected_gesture_ref}`,
    versionLabel: t("preview.versions.idleStyleGesture"),
    idlePlayback: {
      timeScale: playback.time_scale,
      repetitions: playback.repetitions,
      loopType: playback.loop_type,
      durationSeconds: playback.duration_seconds,
    },
    ...(animaId && animaRuntime
      ? { animaContext: { animaId, runtime: animaRuntime } }
      : {}),
  };
}
