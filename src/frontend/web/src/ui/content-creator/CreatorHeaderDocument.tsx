import { useLayoutEffect, useRef, type ReactNode } from "react";

/** Center on the content viewport without crossing the document's grid track. */
export function creatorDocumentOffset(
  viewportCenter: number,
  trackLeft: number,
  trackWidth: number,
  documentWidth: number,
): number {
  const room = Math.max(0, (trackWidth - documentWidth) / 2);
  const desired = viewportCenter - (trackLeft + trackWidth / 2);
  return Math.max(-room, Math.min(room, desired));
}

/** Retain the responsive grid as a collision boundary for a centered title. */
export function CreatorHeaderDocument({
  children,
  className,
  widthClassName,
}: {
  children: ReactNode;
  className: string;
  widthClassName: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const documentRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const track = trackRef.current;
    const document = documentRef.current;
    const header = track?.closest("header");
    if (!track || !document || !header) return;
    const update = () => {
      const bounds = header.getBoundingClientRect();
      const style = getComputedStyle(header);
      const center =
        (bounds.left +
          parseFloat(style.paddingLeft) +
          bounds.right -
          parseFloat(style.paddingRight)) /
        2;
      const available = track.getBoundingClientRect();
      const offset = creatorDocumentOffset(
        center,
        available.left,
        available.width,
        document.offsetWidth,
      );
      document.style.transform = `translateX(${offset}px)`;
    };
    const observer = new ResizeObserver(update);
    observer.observe(header);
    observer.observe(track);
    observer.observe(document);
    update();
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={trackRef} className={className}>
      <div ref={documentRef} className={widthClassName}>
        {children}
      </div>
    </div>
  );
}
