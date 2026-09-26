import { useLayoutEffect, useState, type RefObject } from "react";

const GUTTER = 16;
const GAP = 8;

type Box = Pick<DOMRect, "left" | "right" | "top" | "bottom">;

/**
 * Bottom offset for a crisis card of `cardWidth` in the chat panel's
 * bottom-right corner. The card sits in the true corner when it fits beside
 * the centered input region, and is lifted just above that region otherwise.
 */
export function crisisCardCornerBottom(
  panel: Box,
  inputRegion: Box,
  cardWidth: number,
): number {
  const cardLeft = panel.right - GUTTER - cardWidth;
  return cardLeft >= inputRegion.right + GAP
    ? GUTTER
    : panel.bottom - inputRegion.top + GAP;
}

/** Tracks {@link crisisCardCornerBottom} as the panel, input region or card resizes. */
export function useCrisisCardCornerBottom(
  panelRef: RefObject<HTMLElement | null>,
  inputRegionRef: RefObject<HTMLElement | null>,
  cardRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): number {
  const [bottom, setBottom] = useState(GUTTER);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const inputRegion = inputRegionRef.current;
    const card = cardRef.current;
    if (!enabled || !panel || !inputRegion || !card) return;
    const update = () =>
      setBottom(
        crisisCardCornerBottom(
          panel.getBoundingClientRect(),
          inputRegion.getBoundingClientRect(),
          card.getBoundingClientRect().width,
        ),
      );
    update();
    const observer = new ResizeObserver(update);
    observer.observe(panel);
    observer.observe(inputRegion);
    observer.observe(card);
    return () => observer.disconnect();
  }, [enabled, panelRef, inputRegionRef, cardRef]);
  return bottom;
}
