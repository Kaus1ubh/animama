"use client";

import { useTheme } from "next-themes";

import { runtimeImagePresentation } from "@/lib/runtime-content/animaRuntimeSnapshot";
import type { RuntimeCatalogEntry } from "@/lib/runtime-content/types";
import {
  resolveStageBackground,
  stageSceneChoice,
  type StageBackgroundVariant,
} from "@/lib/stage-background/stageBackground";
import { cn } from "@/lib/utils";
import { useRuntimeContentMediaUrl } from "@/query/hooks/useRuntimeContentMediaUrl";
import { RuntimeImageFrame } from "@/ui/components/runtime-image-frame";
import { useSettings } from "@/ui/settings/SettingsProvider";

/**
 * The image drawn behind an Anima's Avatar: its bound background image, else
 * the Anima's chosen app stage scene in the current theme, or nothing. Renders an
 * absolutely positioned, non-interactive layer; the caller owns stacking.
 */
export function StageBackgroundLayer({
  variant,
  boundImage,
  className,
}: {
  variant: StageBackgroundVariant;
  boundImage: RuntimeCatalogEntry | null;
  className?: string;
}) {
  const { effectivePreferences } = useSettings();
  const { resolvedTheme } = useTheme();
  const boundMedia = useRuntimeContentMediaUrl(boundImage);
  const background = resolveStageBackground({
    hasBoundImage: Boolean(boundImage),
    scene: stageSceneChoice(effectivePreferences),
    variant,
    theme: resolvedTheme === "dark" ? "dark" : "light",
  });

  if (background.kind === "none") return null;
  // A bound image keeps the plain theme background while its bytes load
  // instead of flashing the app image.
  if (background.kind === "bound" && !boundMedia.url) return null;

  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden",
        className,
      )}
    >
      {background.kind === "bound" && boundMedia.url ? (
        <RuntimeImageFrame
          alt=""
          src={boundMedia.url}
          presentation={runtimeImagePresentation(boundImage)}
          className="size-full select-none"
        />
      ) : background.kind === "app" ? (
        <img
          alt=""
          src={background.src}
          draggable={false}
          decoding="async"
          // Softened and slightly out of focus so the scene frames the Avatar
          // without competing; scaled up so the blur never shows a faded edge.
          // Owner-chosen images keep full strength.
          className="size-full scale-[1.02] object-cover opacity-80 blur-xs select-none"
        />
      ) : null}
    </div>
  );
}
