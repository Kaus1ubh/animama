import { useMemo, type CSSProperties } from "react";

import type {
  ResolvedSceneBackgroundLineItem,
  ResolvedSceneBackgroundMarqueeLayer,
  SceneBackgroundDirection,
  SceneBackgroundItemRotationMode,
} from "@/lib/scene-vfx/types";
import { cn } from "@/lib/utils";
import { useCanvasViewport } from "@/ui/main/canvas/CanvasViewportContext";

type SceneVFXMarqueeLayerProps = {
  className?: string;
  layer: ResolvedSceneBackgroundMarqueeLayer;
};

type Orientation = "horizontal" | "vertical";

type MarqueeLayout = {
  animateTracks: boolean;
  bandCount: number;
  bandMainSize: number;
  bandPositions: number[];
  sequenceLength: number;
  trackTravelPx: number;
  animationDurationSec: number;
  orientation: Orientation;
  rotatedSize: number | null;
  rotationDegrees: number | null;
  reverseAnimation: boolean;
};

type CellSequenceArgs = {
  items: ResolvedSceneBackgroundLineItem[];
  startIndex: number;
  sequenceLength: number;
};

function clampPositive(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, value);
}

function isStaticDirection(direction: SceneBackgroundDirection) {
  return direction === "static";
}

function isDiagonalDirection(direction: SceneBackgroundDirection) {
  return direction.startsWith("diagonal-");
}

function resolveOrientation(direction: SceneBackgroundDirection): Orientation {
  return direction === "up" || direction === "down" ? "vertical" : "horizontal";
}

function resolveRotationDegrees(
  direction: SceneBackgroundDirection,
): number | null {
  if (direction === "diagonal-down-left" || direction === "diagonal-up-right") {
    return -45;
  }
  if (direction === "diagonal-up-left" || direction === "diagonal-down-right") {
    return 45;
  }
  return null;
}

function resolveReverseAnimation(direction: SceneBackgroundDirection): boolean {
  if (isStaticDirection(direction)) {
    return false;
  }

  return (
    direction === "right" ||
    direction === "down" ||
    direction === "diagonal-up-right" ||
    direction === "diagonal-down-right"
  );
}

function resolveItemRotationDegrees(args: {
  direction: SceneBackgroundDirection;
  itemRotationMode: SceneBackgroundItemRotationMode;
  itemRotationOffsetDeg: number;
}): number {
  const wrapperRotationDegrees = resolveRotationDegrees(args.direction) ?? 0;
  const baseRotationDegrees =
    args.itemRotationMode === "upright" ? -wrapperRotationDegrees : 0;
  const offsetDegrees =
    typeof args.itemRotationOffsetDeg === "number" &&
    Number.isFinite(args.itemRotationOffsetDeg)
      ? args.itemRotationOffsetDeg
      : 0;
  return baseRotationDegrees + offsetDegrees;
}

function buildMarqueeSequence({
  items,
  startIndex,
  sequenceLength,
}: CellSequenceArgs): ResolvedSceneBackgroundLineItem[] {
  if (items.length === 0 || sequenceLength <= 0) {
    return [];
  }

  if (items.length === 1) {
    return Array.from({ length: sequenceLength }, () => items[0]);
  }

  return Array.from({ length: sequenceLength }, (_, index) => {
    const itemIndex = (startIndex + index) % items.length;
    return items[itemIndex];
  });
}

function buildBandPositions(args: {
  bandCount: number;
  bandSpan: number;
  gap: number;
}): number[] {
  return Array.from(
    { length: args.bandCount },
    (_, index) => index * (args.bandSpan + args.gap),
  );
}

function resolveMarqueeLayout(args: {
  direction: SceneBackgroundDirection;
  frameWidth: number;
  frameHeight: number;
  gap: number;
  itemSize: number;
  rowGap: number;
  speedPxPerSec: number;
}): MarqueeLayout {
  const staticDirection = isStaticDirection(args.direction);
  const orientation = resolveOrientation(args.direction);
  const diagonal = isDiagonalDirection(args.direction);
  const itemSize = Math.max(12, clampPositive(args.itemSize, 72));
  const gap = clampPositive(args.gap, 24);
  const rowGap = clampPositive(args.rowGap, 20);
  const speedPxPerSec = Math.max(20, clampPositive(args.speedPxPerSec, 160));
  const rotatedSize = diagonal
    ? Math.ceil(Math.hypot(args.frameWidth, args.frameHeight)) + itemSize * 4
    : null;
  const bandMainSize = diagonal
    ? rotatedSize!
    : orientation === "horizontal"
      ? args.frameWidth
      : args.frameHeight;
  const bandCrossSize = diagonal
    ? rotatedSize!
    : orientation === "horizontal"
      ? args.frameHeight
      : args.frameWidth;
  const sequenceLength = Math.max(
    4,
    Math.ceil((bandMainSize + gap) / (itemSize + gap)) + 3,
  );
  const trackLength = sequenceLength * itemSize + (sequenceLength - 1) * gap;
  const trackTravelPx = staticDirection ? 0 : trackLength + gap;
  const bandCount = Math.max(
    1,
    Math.ceil((bandCrossSize + rowGap) / (itemSize + rowGap)) + 1,
  );
  const animationDurationSec = staticDirection
    ? 0
    : trackTravelPx / speedPxPerSec;

  return {
    animateTracks: !staticDirection,
    bandCount,
    bandMainSize,
    bandPositions: buildBandPositions({
      bandCount,
      bandSpan: itemSize,
      gap: rowGap,
    }),
    sequenceLength,
    trackTravelPx,
    animationDurationSec,
    orientation,
    rotatedSize,
    rotationDegrees: resolveRotationDegrees(args.direction),
    reverseAnimation: resolveReverseAnimation(args.direction),
  };
}

function buildAnimatedTrackStyle(args: {
  animationDurationSec: number;
  orientation: Orientation;
  reverseAnimation: boolean;
  trackTravelPx: number;
}): CSSProperties {
  return {
    animationName: "scene-vfx-marquee-shift",
    animationDuration: `${Math.max(args.animationDurationSec, 0.1)}s`,
    animationIterationCount: "infinite",
    animationTimingFunction: "linear",
    animationDirection: args.reverseAnimation ? "reverse" : "normal",
    willChange: "transform",
    "--scene-vfx-marquee-translate-x":
      args.orientation === "horizontal" ? `${-args.trackTravelPx}px` : "0px",
    "--scene-vfx-marquee-translate-y":
      args.orientation === "vertical" ? `${-args.trackTravelPx}px` : "0px",
  } as CSSProperties;
}

function buildCellStyle(
  item: ResolvedSceneBackgroundLineItem,
  itemRotationDegrees: number,
): CSSProperties {
  return {
    backgroundImage: `url("${item.src}")`,
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
    backgroundSize: "contain",
    transform:
      itemRotationDegrees !== 0
        ? `rotate(${itemRotationDegrees}deg)`
        : undefined,
    transformOrigin: "center center",
  };
}

function MarqueeTrack({
  orientation,
  rowIndex,
  sequence,
  itemSize,
  gap,
  itemRotationDegrees,
}: {
  orientation: Orientation;
  rowIndex: number;
  sequence: ResolvedSceneBackgroundLineItem[];
  itemSize: number;
  gap: number;
  itemRotationDegrees: number;
}) {
  return (
    <div
      className={cn(
        "shrink-0",
        orientation === "horizontal" ? "flex flex-row" : "flex flex-col",
      )}
      style={{ gap: `${gap}px` }}
    >
      {sequence.map((item, index) => (
        <div
          key={`${rowIndex}:${item.id}:${index}`}
          aria-hidden="true"
          className="shrink-0 select-none"
          style={{
            width: `${itemSize}px`,
            height: `${itemSize}px`,
          }}
        >
          <div
            className="h-full w-full"
            data-scene-vfx-item-id={item.id}
            style={buildCellStyle(item, itemRotationDegrees)}
          />
        </div>
      ))}
    </div>
  );
}

export function SceneVFXMarqueeLayer({
  className,
  layer,
}: SceneVFXMarqueeLayerProps) {
  const canvasViewport = useCanvasViewport();
  const items = useMemo(() => layer.items.slice(0, 2), [layer.items]);
  const itemSize = Math.max(12, clampPositive(layer.itemSize, 72));
  const gap = clampPositive(layer.gap, 24);
  const itemRotationDegrees = useMemo(
    () =>
      resolveItemRotationDegrees({
        direction: layer.direction,
        itemRotationMode: layer.itemRotationMode,
        itemRotationOffsetDeg: layer.itemRotationOffsetDeg,
      }),
    [layer.direction, layer.itemRotationMode, layer.itemRotationOffsetDeg],
  );

  const layout = useMemo(
    () =>
      resolveMarqueeLayout({
        direction: layer.direction,
        frameWidth: canvasViewport.width,
        frameHeight: canvasViewport.height,
        gap,
        itemSize,
        rowGap: layer.rowGap,
        speedPxPerSec: layer.speedPxPerSec,
      }),
    [
      canvasViewport.height,
      canvasViewport.width,
      gap,
      itemSize,
      layer.direction,
      layer.rowGap,
      layer.speedPxPerSec,
    ],
  );
  const trackSequences = useMemo(() => {
    const even = buildMarqueeSequence({
      items,
      startIndex: 0,
      sequenceLength: layout.sequenceLength,
    });

    if (items.length <= 1) {
      return {
        even,
        odd: even,
      };
    }

    return {
      even,
      odd: buildMarqueeSequence({
        items,
        startIndex: 1,
        sequenceLength: layout.sequenceLength,
      }),
    };
  }, [items, layout.sequenceLength]);

  if (
    !canvasViewport.hasSize ||
    !layer.enabled ||
    items.length === 0 ||
    layer.opacity <= 0
  ) {
    return null;
  }

  const animatedTrackStyle = buildAnimatedTrackStyle({
    animationDurationSec: layout.animationDurationSec,
    orientation: layout.orientation,
    reverseAnimation: layout.reverseAnimation,
    trackTravelPx: layout.trackTravelPx,
  });

  const bandWrapperClassName =
    layout.orientation === "horizontal"
      ? "absolute left-0 overflow-hidden"
      : "absolute top-0 overflow-hidden";
  const bandWrapperStaticStyle =
    layout.orientation === "horizontal"
      ? {
          width: `${layout.bandMainSize}px`,
          height: `${itemSize}px`,
        }
      : {
          width: `${itemSize}px`,
          height: `${layout.bandMainSize}px`,
        };
  const animatedTrackClassName =
    layout.orientation === "horizontal" ? "flex flex-row" : "flex flex-col";

  const renderBands = () =>
    layout.bandPositions.map((position, rowIndex) => {
      const sequence =
        rowIndex % 2 === 0 ? trackSequences.even : trackSequences.odd;
      const bandStyle =
        layout.orientation === "horizontal"
          ? { ...bandWrapperStaticStyle, top: `${position}px` }
          : { ...bandWrapperStaticStyle, left: `${position}px` };

      return (
        <div
          key={`band:${rowIndex}`}
          aria-hidden="true"
          className={bandWrapperClassName}
          style={bandStyle}
        >
          <div
            className={animatedTrackClassName}
            data-scene-vfx-marquee-track={
              layout.animateTracks ? rowIndex : undefined
            }
            style={
              layout.animateTracks
                ? { ...animatedTrackStyle, gap: `${gap}px` }
                : { gap: `${gap}px` }
            }
          >
            <MarqueeTrack
              orientation={layout.orientation}
              rowIndex={rowIndex}
              sequence={sequence}
              itemSize={itemSize}
              gap={gap}
              itemRotationDegrees={itemRotationDegrees}
            />
            {layout.animateTracks ? (
              <MarqueeTrack
                orientation={layout.orientation}
                rowIndex={rowIndex}
                sequence={sequence}
                itemSize={itemSize}
                gap={gap}
                itemRotationDegrees={itemRotationDegrees}
              />
            ) : null}
          </div>
        </div>
      );
    });

  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden",
        className,
      )}
      data-scene-vfx-layer="marquee"
      style={{ opacity: layer.opacity }}
    >
      {layout.rotatedSize && layout.rotationDegrees !== null ? (
        <div
          className="absolute top-1/2 left-1/2 overflow-hidden"
          style={{
            width: `${layout.rotatedSize}px`,
            height: `${layout.rotatedSize}px`,
            transform: `translate3d(-50%, -50%, 0) rotate(${layout.rotationDegrees}deg)`,
            transformOrigin: "center center",
          }}
        >
          {renderBands()}
        </div>
      ) : (
        renderBands()
      )}
    </div>
  );
}
