import { type RefObject, useEffect, useState } from "react";

import type { Rgb } from "@/lib/avatar/enhanced-rendering/backdropGlow";
import {
  cssColorToRgb,
  sampleImageColor,
} from "@/lib/avatar/enhanced-rendering/sampleBackdrop";

/**
 * What the chat canvas is drawn over: nothing known (`null`, for example a
 * transparent window over the desktop), an image, or the element's own
 * background colour.
 */
export type Backdrop =
  | { kind: "image"; src: string }
  | { kind: "element" }
  | null;

type Sample = { key: string; color: Rgb | null };

function backdropKey(backdrop: Backdrop): string | null {
  if (!backdrop) return null;
  return backdrop.kind === "image" ? `image:${backdrop.src}` : "element";
}

function sameColor(a: Rgb | null, b: Rgb | null): boolean {
  return (
    a === b || (!!a && !!b && a.every((value, index) => value === b[index]))
  );
}

/**
 * Calls `onChange` after anything that can restyle an element's background:
 * the theme class or inline style on `<html>`, or a stylesheet added, removed
 * or rewritten in `<head>` (appearance colour overrides). The theme provider
 * sets its class in an effect that runs after its children's effects, so the
 * background is read again once the class has landed.
 */
function observeDocumentStyles(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style"],
  });
  observer.observe(document.head, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  return () => observer.disconnect();
}

/**
 * The backdrop's average colour, or null while it is unknown, loading or
 * unreadable. `elementRef` is the element whose background an `element`
 * backdrop reads; it is re-read whenever the document's styles change.
 */
export function useBackdropColor(
  backdrop: Backdrop,
  elementRef: RefObject<HTMLElement | null>,
): Rgb | null {
  const key = backdropKey(backdrop);
  const imageSrc = backdrop?.kind === "image" ? backdrop.src : null;
  const [sampled, setSampled] = useState<Sample | null>(null);

  useEffect(() => {
    if (key === null) return;
    let cancelled = false;
    const settle = (color: Rgb | null) => {
      if (cancelled) return;
      setSampled((previous) =>
        previous?.key === key && sameColor(previous.color, color)
          ? previous
          : { key, color },
      );
    };
    if (imageSrc) {
      void sampleImageColor(imageSrc).then(settle);
      return () => {
        cancelled = true;
      };
    }
    const readElement = () => {
      const element = elementRef.current;
      settle(
        element
          ? cssColorToRgb(getComputedStyle(element).backgroundColor)
          : null,
      );
    };
    readElement();
    const stopObserving = observeDocumentStyles(readElement);
    return () => {
      cancelled = true;
      stopObserving();
    };
  }, [key, imageSrc, elementRef]);

  return key !== null && sampled?.key === key ? sampled.color : null;
}
