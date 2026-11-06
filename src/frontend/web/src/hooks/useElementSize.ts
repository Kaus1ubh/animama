import { useEffect, useState } from "react";

export type ElementSize = {
  width: number;
  height: number;
};

const EMPTY_SIZE: ElementSize = {
  width: 0,
  height: 0,
};

export function useElementSize<T extends HTMLElement>(
  element: T | null,
  reobserveKey?: unknown,
): ElementSize {
  const [size, setSize] = useState<ElementSize>(EMPTY_SIZE);

  useEffect(() => {
    if (!element) return;

    const ownerWindow = element.ownerDocument.defaultView;
    if (!ownerWindow) return;

    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      setSize((current) => {
        if (current.width === rect.width && current.height === rect.height) {
          return current;
        }
        return {
          width: rect.width,
          height: rect.height,
        };
      });
    };

    updateSize();

    if (typeof ownerWindow.ResizeObserver === "undefined") {
      ownerWindow.addEventListener("resize", updateSize);
      return () => {
        ownerWindow.removeEventListener("resize", updateSize);
      };
    }

    const observer = new ownerWindow.ResizeObserver(() => {
      updateSize();
    });
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [element, reobserveKey]);

  return size;
}
