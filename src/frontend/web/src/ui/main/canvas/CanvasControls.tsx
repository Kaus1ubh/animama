"use client";

import { Maximize, Minimize, PictureInPicture2, Settings } from "lucide-react";
import { useId, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/ui/components/popover";
import { AudioVolumePanel, BgmTransportRow } from "@/ui/sound/SoundControls";

export type CanvasMode = "avatar-chat" | "avatar" | "chat";

type CanvasControlsProps = {
  backgroundMode?: DesktopPipBackgroundMode;
  cameraControls?: ReactNode;
  className?: string;
  isFullscreen?: boolean;
  isPipSupported?: boolean;
  onBackgroundModeChange?: (mode: DesktopPipBackgroundMode) => void;
  onMaximize?: () => void;
  onMinimize?: () => void;
  onPictureInPicture?: () => void;
  mode?: CanvasMode;
  onModeChange?: (mode: CanvasMode) => void;
  portalContainer?: HTMLElement | null;
  showBackgroundModeControl?: boolean;
};

const ICON_BUTTON_CLASS =
  "text-foreground/80 hover:bg-muted/70 hover:text-foreground focus-visible:ring-ring inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-transparent transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent";

/** Native radio groups keep mode labels bounded and support arrow-key selection. */
function ModeSelector<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange?: (value: T) => void;
}) {
  const name = useId();
  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="text-muted-foreground text-xs font-medium">
        {label}
      </legend>
      <div className="bg-muted/60 grid auto-cols-fr grid-flow-col gap-1 rounded-lg p-1">
        {options.map((option) => (
          <label key={option.value} className="relative min-w-0 cursor-pointer">
            <input
              className="peer sr-only"
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange?.(option.value)}
            />
            <span className="peer-checked:bg-background peer-checked:text-foreground peer-focus-visible:ring-ring text-muted-foreground flex h-full min-h-9 items-center justify-center rounded-md px-2 py-1.5 text-center text-xs font-medium break-words peer-checked:shadow-sm peer-focus-visible:ring-2">
              {option.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** A single settings surface leaves the canvas free of persistent control panels. */
export function CanvasControls({
  backgroundMode = "transparent",
  cameraControls,
  className,
  isFullscreen = false,
  isPipSupported = false,
  onBackgroundModeChange,
  onMaximize,
  onMinimize,
  onPictureInPicture,
  mode = "avatar-chat",
  onModeChange,
  portalContainer,
  showBackgroundModeControl = false,
}: CanvasControlsProps) {
  const pipTitle = isPipSupported
    ? "Open picture-in-picture"
    : "Picture-in-picture isn't supported in this browser";

  return (
    <div
      className={cn("pointer-events-auto flex items-center gap-1", className)}
    >
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Open canvas settings"
            title="Canvas settings"
            className={ICON_BUTTON_CLASS}
          >
            <Settings className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          aria-label="Canvas settings"
          side="bottom"
          align="end"
          sideOffset={10}
          collisionPadding={8}
          portalContainer={portalContainer}
          className="border-border/70 bg-background/95 supports-[backdrop-filter]:bg-background/90 max-h-(--radix-popover-content-available-height) w-[22rem] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-2xl p-4 shadow-lg backdrop-blur-md"
        >
          <div className="space-y-4">
            <h2 className="text-sm font-semibold">Canvas settings</h2>
            <ModeSelector
              label="Mode"
              value={mode}
              onChange={onModeChange}
              options={[
                { value: "avatar-chat", label: "Avatar + Chat" },
                { value: "avatar", label: "Avatar only" },
                { value: "chat", label: "Chat only" },
              ]}
            />
            {showBackgroundModeControl ? (
              <ModeSelector
                label="PiP background"
                value={backgroundMode}
                onChange={onBackgroundModeChange}
                options={[
                  { value: "transparent", label: "Transparent" },
                  { value: "scene", label: "Scene" },
                ]}
              />
            ) : null}
            {cameraControls}
            <section
              aria-label="Audio"
              className="border-border/60 space-y-3 border-t pt-3"
            >
              <h3 className="text-sm font-medium">Audio</h3>
              <AudioVolumePanel />
              <BgmTransportRow
                className="flex-wrap gap-2 [&>div:first-child]:min-w-16"
                portalContainer={portalContainer}
              />
            </section>
          </div>
        </PopoverContent>
      </Popover>
      <span className="inline-flex" title={pipTitle}>
        <button
          type="button"
          aria-label="Toggle picture-in-picture"
          onClick={onPictureInPicture}
          disabled={!isPipSupported}
          className={ICON_BUTTON_CLASS}
        >
          <PictureInPicture2 className="h-4 w-4" />
        </button>
      </span>
      <button
        type="button"
        aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        onClick={isFullscreen ? onMinimize : onMaximize}
        className={ICON_BUTTON_CLASS}
      >
        {isFullscreen ? (
          <Minimize className="h-4 w-4" />
        ) : (
          <Maximize className="h-4 w-4" />
        )}
      </button>
    </div>
  );
}
