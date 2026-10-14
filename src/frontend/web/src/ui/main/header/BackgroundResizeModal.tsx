"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { ArrowLeft, Minus, Plus, RotateCcw } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { useFormatters } from "@animama/product-ui/i18n";

import type { AvatarBackgroundOption } from "@/lib/avatar/backgroundOptions";
import {
  applyAvatarBackgroundDrag,
  clampAvatarBackgroundZoom,
  createDefaultAvatarBackgroundCrop,
  MAX_AVATAR_BACKGROUND_ZOOM,
  normalizeAvatarBackgroundCrop,
  type AvatarBackgroundCrop,
} from "@/lib/avatar/backgroundCrop";
import { useElementSize } from "@/hooks/useElementSize";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/components/button";
import { DialogOverlay } from "@/ui/components/dialog";
import { Slider } from "@/ui/components/slider";
import { AvatarBackgroundMedia } from "@/ui/main/canvas/AvatarBackgroundMedia";
import { useCanvasViewport } from "@/ui/main/canvas/CanvasViewportContext";

type BackgroundResizeModalProps = {
  disabled?: boolean;
  initialCrop?: AvatarBackgroundCrop | null;
  onApply: (crop: AvatarBackgroundCrop) => Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  option: AvatarBackgroundOption | null;
};

type FrameRect = {
  width: number;
  height: number;
  left: number;
  top: number;
};

const STAGE_PADDING = 24;
const ZOOM_STEP = 0.1;

function getCenteredFrameRect(
  stageWidth: number,
  stageHeight: number,
  aspectRatio: number,
): FrameRect {
  const availableWidth = Math.max(stageWidth - STAGE_PADDING * 2, 0);
  const availableHeight = Math.max(stageHeight - STAGE_PADDING * 2, 0);
  if (availableWidth <= 0 || availableHeight <= 0) {
    return {
      width: 0,
      height: 0,
      left: 0,
      top: 0,
    };
  }

  if (availableWidth / availableHeight > aspectRatio) {
    const height = availableHeight;
    const width = height * aspectRatio;
    return {
      width,
      height,
      left: (stageWidth - width) / 2,
      top: (stageHeight - height) / 2,
    };
  }

  const width = availableWidth;
  const height = width / aspectRatio;
  return {
    width,
    height,
    left: (stageWidth - width) / 2,
    top: (stageHeight - height) / 2,
  };
}

function formatAspectRatio(aspectRatio: number): string {
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    return "16:9";
  }
  return `${aspectRatio.toFixed(2)}:1`;
}

export function BackgroundResizeModal({
  disabled = false,
  initialCrop,
  onApply,
  onOpenChange,
  open,
  option,
}: BackgroundResizeModalProps) {
  const { t } = useTranslation("chat");
  const formatters = useFormatters();
  const [draftCrop, setDraftCrop] = useState<AvatarBackgroundCrop | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [stageElement, setStageElement] = useState<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
  } | null>(null);
  const stageSize = useElementSize(stageElement);
  const canvasViewport = useCanvasViewport();
  const targetAspectRatio = canvasViewport.hasSize
    ? canvasViewport.aspectRatio
    : 16 / 9;
  const isBusy = disabled || isApplying;

  useEffect(() => {
    if (!open || !option) return;
    setDraftCrop(
      normalizeAvatarBackgroundCrop(
        option.id,
        initialCrop ?? createDefaultAvatarBackgroundCrop(option.id),
      ),
    );
  }, [initialCrop, open, option]);

  const frameRect = useMemo(
    () =>
      getCenteredFrameRect(
        stageSize.width,
        stageSize.height,
        targetAspectRatio,
      ),
    [stageSize.height, stageSize.width, targetAspectRatio],
  );

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (isBusy) return;
      onOpenChange(nextOpen);
    },
    [isBusy, onOpenChange],
  );

  const handleReset = useCallback(() => {
    if (!option || isBusy) return;
    setDraftCrop(createDefaultAvatarBackgroundCrop(option.id));
  }, [isBusy, option]);

  const handleZoomChange = useCallback((nextZoom: number) => {
    setDraftCrop((current) => {
      if (!current) return current;
      return {
        ...current,
        zoom: clampAvatarBackgroundZoom(nextZoom),
      };
    });
  }, []);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || isBusy || !draftCrop || !option) return;
      dragRef.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [draftCrop, isBusy, option],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (
        !drag ||
        drag.pointerId !== event.pointerId ||
        !draftCrop ||
        !option
      ) {
        return;
      }

      const deltaX = event.clientX - drag.x;
      const deltaY = event.clientY - drag.y;
      if (deltaX === 0 && deltaY === 0) return;

      dragRef.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      };

      setDraftCrop((current) => {
        if (!current) return current;
        return applyAvatarBackgroundDrag({
          option,
          crop: current,
          frameWidth: frameRect.width,
          frameHeight: frameRect.height,
          deltaX,
          deltaY,
        });
      });
    },
    [draftCrop, frameRect.height, frameRect.width, option],
  );

  const releasePointer = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
    },
    [],
  );

  const handleApply = useCallback(async () => {
    if (!draftCrop || !option || isBusy) return;

    setIsApplying(true);
    try {
      await onApply(draftCrop);
      onOpenChange(false);
    } catch {
      // The caller is responsible for surfacing the error.
    } finally {
      setIsApplying(false);
    }
  }, [draftCrop, isBusy, onApply, onOpenChange, option]);

  if (!option) return null;

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <DialogOverlay className="z-[60]" />
        <Dialog.Content
          className={cn(
            "fixed inset-3 z-[70] flex flex-col overflow-hidden rounded-3xl bg-black text-white shadow-2xl",
            "border border-white/10 md:inset-6",
          )}
        >
          <Dialog.Title className="sr-only">
            {t("background.title", { name: option.label })}
          </Dialog.Title>
          <Dialog.Description className="sr-only">
            {t("background.description")}
          </Dialog.Description>

          <div className="flex items-center gap-3 border-b border-white/10 px-4 py-4 md:px-6">
            <button
              type="button"
              onClick={() => handleOpenChange(false)}
              disabled={isBusy}
              className={cn(
                "inline-flex h-10 w-10 items-center justify-center rounded-full text-white transition",
                "hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:outline-none",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
              aria-label={t("background.back")}
            >
              <ArrowLeft className="h-5 w-5" />
            </button>

            <div className="min-w-0">
              <p className="text-lg font-semibold">{t("background.heading")}</p>
              <p className="text-sm text-white/70">{t("background.hint")}</p>
            </div>

            <Button
              type="button"
              onClick={handleApply}
              disabled={isBusy || !draftCrop}
              className="ml-auto rounded-full bg-white px-5 text-black hover:bg-white/90"
            >
              {isApplying ? t("background.applying") : t("background.apply")}
            </Button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col px-4 py-4 md:px-6">
            <div
              ref={setStageElement}
              className={cn(
                "relative flex-1 touch-none overflow-hidden rounded-2xl bg-[#050505]",
                draftCrop && !isBusy
                  ? "cursor-grab active:cursor-grabbing"
                  : "",
              )}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={releasePointer}
              onPointerCancel={releasePointer}
            >
              {draftCrop ? (
                <AvatarBackgroundMedia
                  option={option}
                  crop={draftCrop}
                  frameWidth={frameRect.width}
                  frameHeight={frameRect.height}
                  offsetX={frameRect.left}
                  offsetY={frameRect.top}
                />
              ) : null}

              <div
                className="pointer-events-none absolute border-[3px] border-sky-400/95 shadow-[0_0_0_9999px_rgba(0,0,0,0.58)]"
                style={{
                  width: `${frameRect.width}px`,
                  height: `${frameRect.height}px`,
                  left: `${frameRect.left}px`,
                  top: `${frameRect.top}px`,
                }}
              />

              <div className="pointer-events-none absolute right-4 bottom-4 rounded-full bg-black/55 px-3 py-1 text-xs text-white/80 backdrop-blur-sm">
                {canvasViewport.hasSize
                  ? t("background.canvasSize", {
                      width: Math.round(canvasViewport.width),
                      height: Math.round(canvasViewport.height),
                    })
                  : t("background.liveCanvas")}
                {" · "}
                {formatAspectRatio(targetAspectRatio)}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3 text-white">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() =>
                  handleZoomChange((draftCrop?.zoom ?? 1) - ZOOM_STEP)
                }
                disabled={isBusy}
                className="rounded-full text-white hover:bg-white/10 hover:text-white"
                aria-label={t("background.zoomOut")}
              >
                <Minus className="h-4 w-4" />
              </Button>

              <Slider
                min={1}
                max={MAX_AVATAR_BACKGROUND_ZOOM}
                step={0.01}
                value={[draftCrop?.zoom ?? 1]}
                onValueChange={([nextZoom]) => {
                  if (typeof nextZoom !== "number") return;
                  handleZoomChange(nextZoom);
                }}
                disabled={isBusy}
                className="min-w-[220px] flex-1"
              />

              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() =>
                  handleZoomChange((draftCrop?.zoom ?? 1) + ZOOM_STEP)
                }
                disabled={isBusy}
                className="rounded-full text-white hover:bg-white/10 hover:text-white"
                aria-label={t("background.zoomIn")}
              >
                <Plus className="h-4 w-4" />
              </Button>

              <div className="w-14 text-right text-sm font-medium text-white/80 tabular-nums">
                {formatters.number(draftCrop?.zoom ?? 1, {
                  style: "percent",
                  maximumFractionDigits: 0,
                })}
              </div>

              <Button
                type="button"
                variant="ghost"
                onClick={handleReset}
                disabled={isBusy}
                className="ml-auto rounded-full text-white hover:bg-white/10 hover:text-white"
              >
                <RotateCcw className="h-4 w-4" />
                {t("background.reset")}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
