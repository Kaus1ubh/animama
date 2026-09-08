"use client";

import { createContext, useContext, type ReactNode } from "react";

export type CanvasViewport = {
  width: number;
  height: number;
  aspectRatio: number;
  hasSize: boolean;
};

const DEFAULT_CANVAS_VIEWPORT: CanvasViewport = {
  width: 0,
  height: 0,
  aspectRatio: 16 / 9,
  hasSize: false,
};

const CanvasViewportContext = createContext<CanvasViewport>(
  DEFAULT_CANVAS_VIEWPORT,
);

export function CanvasViewportProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: CanvasViewport;
}) {
  return (
    <CanvasViewportContext.Provider value={value}>
      {children}
    </CanvasViewportContext.Provider>
  );
}

export function useCanvasViewport(): CanvasViewport {
  return useContext(CanvasViewportContext);
}
