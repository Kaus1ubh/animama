"use client";

import { useTheme } from "next-themes";

import { runtimeImagePresentation } from "@/lib/runtime-content/animaRuntimeSnapshot";
import type { RuntimeCatalogEntry } from "@/lib/runtime-content/types";
import {
  isStageBackgroundDisabled,
  resolveStageBackground,
  type StageBackgroundVariant,
} from "@/lib/stage-background/stageBackground";
import { cn } from "@/lib/utils";
import { useRuntimeContentMediaUrl } from "@/query/hooks/useRuntimeContentMediaUrl";
import { RuntimeImageFrame } from "@/ui/components/runtime-image-frame";
import { useSettings } from "@/ui/settings/SettingsProvider";

/**
 * The image drawn behind an Anima's Avatar: its bound background image, else
 * the themed app stage image unless the Anima turned it off. Renders an
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
    disabled: isStageBackgroundDisabled(effectivePreferences),
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
          // Softened so the app image frames the Avatar without competing;
          // the theme background shows through. Owner-chosen images keep full strength.
          className="size-full object-cover opacity-55 select-none"
        />
      ) : null}
    </div>
  );
}
