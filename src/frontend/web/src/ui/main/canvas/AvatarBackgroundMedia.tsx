import type { CSSProperties } from "react";

import type { AvatarBackgroundOption } from "@/lib/avatar/backgroundOptions";
import {
  createDefaultAvatarBackgroundCrop,
  getAvatarBackgroundLayout,
  type AvatarBackgroundCrop,
} from "@/lib/avatar/backgroundCrop";
import { cn } from "@/lib/utils";
import { AppImage } from "@/platform/image/AppImage";

type AvatarBackgroundMediaProps = {
  option: AvatarBackgroundOption;
  crop?: AvatarBackgroundCrop | null;
  frameWidth: number;
  frameHeight: number;
  offsetX?: number;
  offsetY?: number;
  className?: string;
  style?: CSSProperties;
};

export function AvatarBackgroundMedia({
  option,
  crop,
  frameWidth,
  frameHeight,
  offsetX = 0,
  offsetY = 0,
  className,
  style,
}: AvatarBackgroundMediaProps) {
  const resolvedCrop =
    crop && crop.backgroundId === option.id
      ? crop
      : createDefaultAvatarBackgroundCrop(option.id);
  const layout = getAvatarBackgroundLayout({
    option,
    crop: resolvedCrop,
    frameWidth,
    frameHeight,
  });
  if (!layout) return null;

  return (
    <AppImage
      alt=""
      aria-hidden="true"
      src={option.imageSrc}
      width={option.width}
      height={option.height}
      unoptimized
      className={cn(
        "pointer-events-none absolute top-0 left-0 max-w-none select-none",
        className,
      )}
      style={{
        width: `${layout.width}px`,
        height: `${layout.height}px`,
        transform: `translate3d(${offsetX + layout.left}px, ${offsetY + layout.top}px, 0)`,
        ...style,
      }}
    />
  );
}
