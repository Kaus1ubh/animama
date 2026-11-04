import { ImageUp, LoaderCircle } from "lucide-react";
import {
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useTranslation } from "react-i18next";

import { useElementSize } from "@/hooks/useElementSize";
import {
  applyRuntimeImageDrag,
  applyRuntimeImageLayoutDrag,
  getRuntimeImageLayout,
  runtimeImageStyle,
  type RuntimeImagePresentation,
} from "@/lib/runtime-content/imagePresentation";
import { cn } from "@/lib/utils";

export type RuntimeImageFrameProps = {
  src: string;
  alt: string;
  presentation: RuntimeImagePresentation;
  className?: string;
  imageClassName?: string;
  editable?: boolean;
  onPresentationChange?: (value: RuntimeImagePresentation) => void;
};

/** Render or directly manipulate one normalized runtime image crop. */
export function RuntimeImageFrame({
  src,
  alt,
  presentation,
  className,
  imageClassName,
  editable = false,
  onPresentationChange,
}: RuntimeImageFrameProps) {
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(
    null,
  );

  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!editable || event.button !== 0) return;
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!editable || !drag || drag.pointerId !== event.pointerId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const deltaX = event.clientX - drag.x;
    const deltaY = event.clientY - drag.y;
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    onPresentationChange?.(
      applyRuntimeImageDrag({
        presentation,
        frameWidth: bounds.width,
        frameHeight: bounds.height,
        deltaX,
        deltaY,
      }),
    );
  };
  const pointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div
      className={cn(
        "relative overflow-hidden",
        editable && "cursor-move touch-none select-none",
        className,
      )}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerUp}
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        className={cn("size-full", imageClassName)}
        style={runtimeImageStyle(presentation)}
      />
    </div>
  );
}

type CropFrame = {
  height: number;
  left: number;
  top: number;
  width: number;
};

function centeredCropFrame(
  stageWidth: number,
  stageHeight: number,
  aspectRatio: number,
): CropFrame {
  const padding = Math.min(28, Math.max(16, stageWidth * 0.045));
  const availableWidth = Math.max(0, stageWidth - padding * 2);
  const availableHeight = Math.max(0, stageHeight - padding * 2);
  if (availableWidth === 0 || availableHeight === 0) {
    return { width: 0, height: 0, left: 0, top: 0 };
  }

  const width = Math.min(availableWidth, availableHeight * aspectRatio);
  const height = width / aspectRatio;
  return {
    width,
    height,
    left: (stageWidth - width) / 2,
    top: (stageHeight - height) / 2,
  };
}

export type RuntimeImageCropEditorProps = {
  alt: string;
  aspectRatio: number;
  circular?: boolean;
  className?: string;
  editable?: boolean;
  emptyLabel?: string;
  loading?: boolean;
  onPresentationChange: (value: RuntimeImagePresentation) => void;
  onUploadClick?: () => void;
  presentation: RuntimeImagePresentation;
  src?: string | null;
  uploadDisabled?: boolean;
  uploadLabel?: string;
};

/** Show an accurate crop with the excluded source pixels dimmed around it. */
export function RuntimeImageCropEditor({
  alt,
  aspectRatio,
  circular = false,
  className,
  editable = false,
  emptyLabel,
  loading = false,
  onPresentationChange,
  onUploadClick,
  presentation,
  src,
  uploadDisabled = false,
  uploadLabel,
}: RuntimeImageCropEditorProps) {
  const { t } = useTranslation("components");
  const [stageElement, setStageElement] = useState<HTMLDivElement | null>(null);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const stageSize = useElementSize(stageElement);
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(
    null,
  );
  const frame = useMemo(
    () => centeredCropFrame(stageSize.width, stageSize.height, aspectRatio),
    [aspectRatio, stageSize.height, stageSize.width],
  );
  const layout = useMemo(
    () =>
      getRuntimeImageLayout({
        presentation,
        frameWidth: frame.width,
        frameHeight: frame.height,
        imageWidth: imageSize.width,
        imageHeight: imageSize.height,
      }),
    [
      frame.height,
      frame.width,
      imageSize.height,
      imageSize.width,
      presentation,
    ],
  );

  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!editable || !layout || event.button !== 0) return;
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!editable || !drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.x;
    const deltaY = event.clientY - drag.y;
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    onPresentationChange(
      applyRuntimeImageLayoutDrag({
        presentation,
        frameWidth: frame.width,
        frameHeight: frame.height,
        imageWidth: imageSize.width,
        imageHeight: imageSize.height,
        deltaX,
        deltaY,
      }),
    );
  };
  const pointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div
      ref={setStageElement}
      className={cn(
        "bg-background relative aspect-[4/3] w-full overflow-hidden rounded-2xl",
        editable && layout && "cursor-grab touch-none active:cursor-grabbing",
        className,
      )}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerUp}
    >
      {src ? (
        <img
          key={src}
          src={src}
          alt={alt}
          draggable={false}
          onLoad={(event) =>
            setImageSize({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            })
          }
          className={cn(
            "pointer-events-none absolute top-0 left-0 max-w-none transition-opacity select-none",
            layout ? "opacity-100" : "opacity-0",
          )}
          style={
            layout
              ? {
                  width: `${layout.width}px`,
                  height: `${layout.height}px`,
                  transform: `translate3d(${frame.left + layout.left}px, ${frame.top + layout.top}px, 0)`,
                }
              : undefined
          }
        />
      ) : null}

      {!src && !loading ? (
        <div className="text-muted-foreground absolute inset-0 flex items-center justify-center pt-16">
          <span className="text-sm">{emptyLabel ?? t("imageCrop.empty")}</span>
        </div>
      ) : null}

      {(loading || (src && !layout)) && (
        <div className="absolute inset-0 flex items-center justify-center">
          <LoaderCircle className="size-6 animate-spin text-white/60" />
        </div>
      )}

      <div
        className={cn(
          "pointer-events-none absolute border-[3px] border-sky-400/95 shadow-[0_0_0_9999px_rgba(0,0,0,0.34)]",
          circular && "rounded-full",
        )}
        style={{
          width: `${frame.width}px`,
          height: `${frame.height}px`,
          left: `${frame.left}px`,
          top: `${frame.top}px`,
        }}
      />

      {onUploadClick && !loading ? (
        <button
          type="button"
          aria-label={uploadLabel ?? t("imageCrop.upload")}
          disabled={uploadDisabled}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onUploadClick();
          }}
          className="focus-visible:ring-ring/50 absolute top-1/2 left-1/2 z-10 flex size-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-white/75 opacity-70 backdrop-blur-[1px] transition hover:scale-105 hover:bg-black/50 hover:text-white hover:opacity-100 focus-visible:ring-[3px] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-35"
        >
          <ImageUp className="size-15" />
        </button>
      ) : null}
    </div>
  );
}
