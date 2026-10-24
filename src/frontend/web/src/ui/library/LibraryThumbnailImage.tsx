"use client";

import { type CSSProperties, type ReactNode, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * A Library tile image that the browser loads only near the viewport. The
 * family icon (`fallback`) stays until the image has drawn and `ready` holds,
 * and returns if the image fails, so a long Library never preloads every tile.
 */
export function LibraryThumbnailImage({
  src,
  fallback,
  className,
  style,
  ready = true,
  onLoad,
}: {
  src: string;
  fallback: ReactNode;
  className?: string;
  style?: CSSProperties;
  ready?: boolean;
  onLoad?: () => void;
}) {
  const [state, setState] = useState<"loading" | "loaded" | "failed">(
    "loading",
  );
  const shown = state === "loaded" && ready;
  return (
    <>
      {shown ? null : fallback}
      {state === "failed" ? null : (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          className={cn(
            "absolute inset-0 size-full",
            className,
            !shown && "opacity-0",
          )}
          style={style}
          onLoad={() => {
            setState("loaded");
            onLoad?.();
          }}
          onError={() => setState("failed")}
        />
      )}
    </>
  );
}
