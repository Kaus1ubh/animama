"use client";

import { Maximize, Minimize, PictureInPicture2, Settings } from "lucide-react";
import { motion } from "motion/react";

import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/ui/components/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/ui/components/tabs";

export type CanvasMode = "avatar-chat" | "avatar" | "chat";

type CanvasControlsProps = {
  backgroundMode?: DesktopPipBackgroundMode;
  className?: string;
  isFullscreen?: boolean;
  isPipSupported?: boolean;
  onBackgroundModeChange?: (mode: DesktopPipBackgroundMode) => void;
  onMaximize?: () => void;
  onMinimize?: () => void;
  onPictureInPicture?: () => void;
  onSettings?: () => void;
  mode?: CanvasMode;
  onModeChange?: (mode: CanvasMode) => void;
  showBackgroundModeControl?: boolean;
};

export function CanvasControls({
  backgroundMode = "transparent",
  className,
  isFullscreen = false,
  isPipSupported = false,
  onBackgroundModeChange,
  onMaximize,
  onMinimize,
  onPictureInPicture,
  onSettings,
  mode = "avatar-chat",
  onModeChange,
  showBackgroundModeControl = false,
}: CanvasControlsProps) {
  const handleFullscreenClick = isFullscreen ? onMinimize : onMaximize;
  const pipDisabled = !isPipSupported;
  const pipTitle = pipDisabled
    ? "Picture-in-picture isn't supported in this browser"
    : "Open picture-in-picture";
  return (
    <div
      className={cn(
        "border-border/60 bg-background/60 pointer-events-auto flex items-center gap-1 rounded-full border p-1 shadow-sm backdrop-blur-md",
        className,
      )}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Open canvas settings"
            onClick={onSettings}
            className="text-foreground/80 hover:bg-muted/70 hover:text-foreground inline-flex h-9 w-9 items-center justify-center rounded-full transition"
          >
            <Settings className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="end"
          sideOffset={12}
          className="w-56 p-3"
        >
          <DropdownMenuLabel className="text-muted-foreground dark:text-muted-foreground text-xs font-medium">
            Mode
          </DropdownMenuLabel>
          <Tabs
            value={mode}
            onValueChange={(value) => onModeChange?.(value as CanvasMode)}
          >
            <TabsList className="border-border/60 bg-muted/60 inline-flex w-full items-center rounded-lg border p-1">
              {(
                [
                  { value: "avatar-chat", label: "Avatar + Chat" },
                  { value: "avatar", label: "Avatar only" },
                  { value: "chat", label: "Chat only" },
                ] as const
              ).map((item) => {
                const isSelected = mode === item.value;
                return (
                  <TabsTrigger
                    key={item.value}
                    value={item.value}
                    className="data-[state=active]:text-foreground relative flex-1 rounded-md px-2 py-1 text-xs font-medium"
                  >
                    {isSelected ? (
                      <motion.div
                        layoutId="canvas-mode-segmented-bg"
                        className="bg-background absolute inset-0 rounded-md shadow-sm"
                        transition={{
                          type: "spring",
                          stiffness: 500,
                          damping: 30,
                        }}
                      />
                    ) : null}
                    <span className="relative z-10">{item.label}</span>
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>
          {showBackgroundModeControl ? (
            <>
              <DropdownMenuLabel className="text-muted-foreground dark:text-muted-foreground mt-3 text-xs font-medium">
                PiP Background
              </DropdownMenuLabel>
              <Tabs
                value={backgroundMode}
                onValueChange={(value) =>
                  onBackgroundModeChange?.(value as DesktopPipBackgroundMode)
                }
              >
                <TabsList className="border-border/60 bg-muted/60 inline-flex w-full items-center rounded-lg border p-1">
                  {(
                    [
                      { value: "transparent", label: "Transparent" },
                      { value: "scene", label: "Scene" },
                    ] as const
                  ).map((item) => {
                    const isSelected = backgroundMode === item.value;
                    return (
                      <TabsTrigger
                        key={item.value}
                        value={item.value}
                        className="data-[state=active]:text-foreground relative flex-1 rounded-md px-2 py-1 text-xs font-medium"
                      >
                        {isSelected ? (
                          <motion.div
                            layoutId="pip-background-segmented-bg"
                            className="bg-background absolute inset-0 rounded-md shadow-sm"
                            transition={{
                              type: "spring",
                              stiffness: 500,
                              damping: 30,
                            }}
                          />
                        ) : null}
                        <span className="relative z-10">{item.label}</span>
                      </TabsTrigger>
                    );
                  })}
                </TabsList>
              </Tabs>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="inline-flex" title={pipTitle}>
        <button
          type="button"
          aria-label="Toggle picture-in-picture"
          onClick={onPictureInPicture}
          disabled={pipDisabled}
          aria-disabled={pipDisabled}
          className="text-foreground/80 hover:bg-muted/70 hover:text-foreground inline-flex h-9 w-9 items-center justify-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
        >
          <PictureInPicture2 className="h-4 w-4" />
        </button>
      </span>
      <button
        type="button"
        aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        onClick={handleFullscreenClick}
        className="text-foreground/80 hover:bg-muted/70 hover:text-foreground inline-flex h-9 w-9 items-center justify-center rounded-full transition"
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
