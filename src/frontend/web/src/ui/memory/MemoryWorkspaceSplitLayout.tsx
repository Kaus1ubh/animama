"use client";

import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { useMemo, useRef, useState } from "react";

import { useElementSize } from "@/hooks/useElementSize";
import { createLogger } from "@/lib/logger";
import {
  MEMORY_WORKSPACE_HANDLE_WIDTH_PX,
  MEMORY_WORKSPACE_KEYBOARD_STEP_PX,
  MEMORY_WORKSPACE_LAYOUT_STORAGE_KEY,
  parseMemoryWorkspacePanePreference,
  resizeMemoryWorkspacePanePreference,
  resolveMemoryWorkspacePaneLayout,
  serializeMemoryWorkspacePanePreference,
  type MemoryWorkspaceDivider,
  type MemoryWorkspacePaneLayout,
  type MemoryWorkspacePanePreference,
} from "@/lib/memory-entries/workspace-pane-layout";
import { cn } from "@/lib/utils";

const logger = createLogger("MemoryWorkspaceSplitLayout");

type MemoryWorkspaceSplitLayoutProps = {
  explorer: ReactNode;
  work: ReactNode;
  preview: ReactNode;
  explorerCollapsed: boolean;
};

type DragState = {
  divider: MemoryWorkspaceDivider;
  pointerId: number;
  startX: number;
  containerWidth: number;
  layout: MemoryWorkspacePaneLayout;
  preference: MemoryWorkspacePanePreference | null;
  nextPreference: MemoryWorkspacePanePreference | null;
};

function loadPreference() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(
      MEMORY_WORKSPACE_LAYOUT_STORAGE_KEY,
    );
    const preference = parseMemoryWorkspacePanePreference(raw);
    if (raw && !preference) {
      logger.warn("Storage", "Ignoring invalid memory workspace layout", {
        key: MEMORY_WORKSPACE_LAYOUT_STORAGE_KEY,
      });
    }
    return preference;
  } catch (error) {
    logger.warn("Storage", "Failed to load memory workspace layout", {
      error,
      key: MEMORY_WORKSPACE_LAYOUT_STORAGE_KEY,
    });
    return null;
  }
}

function persistPreference(preference: MemoryWorkspacePanePreference | null) {
  if (typeof window === "undefined") return;
  try {
    if (preference) {
      window.localStorage.setItem(
        MEMORY_WORKSPACE_LAYOUT_STORAGE_KEY,
        serializeMemoryWorkspacePanePreference(preference),
      );
    } else {
      window.localStorage.removeItem(MEMORY_WORKSPACE_LAYOUT_STORAGE_KEY);
    }
  } catch (error) {
    logger.warn("Storage", "Failed to save memory workspace layout", {
      error,
      key: MEMORY_WORKSPACE_LAYOUT_STORAGE_KEY,
    });
  }
}

type ResizeHandleProps = {
  divider: MemoryWorkspaceDivider;
  label: string;
  disabled?: boolean;
  dragging: boolean;
  value: number;
  minimum: number;
  maximum: number;
  onPointerDown: (
    divider: MemoryWorkspaceDivider,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onLostPointerCapture: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onKeyDown: (
    divider: MemoryWorkspaceDivider,
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) => void;
  onReset: () => void;
};

function ResizeHandle({
  divider,
  label,
  disabled = false,
  dragging,
  value,
  minimum,
  maximum,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onLostPointerCapture,
  onKeyDown,
  onReset,
}: ResizeHandleProps) {
  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={Math.round(minimum)}
      aria-valuemax={Math.round(maximum)}
      aria-valuenow={Math.round(value)}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      title={`${label}. Use Left and Right Arrow keys to resize. Double-click to reset.`}
      onPointerDown={(event) => onPointerDown(divider, event)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onLostPointerCapture}
      onKeyDown={(event) => onKeyDown(divider, event)}
      onDoubleClick={onReset}
      className={cn(
        "group relative hidden h-full touch-none justify-center outline-none select-none lg:flex",
        disabled
          ? "cursor-default"
          : "focus-visible:bg-accent/70 cursor-col-resize",
      )}
    >
      <span
        className={cn(
          "bg-border/40 h-full w-px transition-[width,background-color]",
          !disabled &&
            "group-hover:bg-primary/50 group-focus-visible:bg-primary/60 group-hover:w-0.5 group-focus-visible:w-0.5",
          dragging && "bg-primary w-1",
        )}
      />
    </div>
  );
}

/** Owns constrained, persisted desktop tracks without affecting mobile panes. */
export function MemoryWorkspaceSplitLayout({
  explorer,
  work,
  preview,
  explorerCollapsed,
}: MemoryWorkspaceSplitLayoutProps) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const { width: containerWidth } = useElementSize(container);
  const [preference, setPreference] =
    useState<MemoryWorkspacePanePreference | null>(loadPreference);
  const [dragging, setDragging] = useState<MemoryWorkspaceDivider | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const viewportWidth =
    container?.ownerDocument.defaultView?.innerWidth ?? containerWidth;
  const layout = useMemo(
    () =>
      resolveMemoryWorkspacePaneLayout({
        containerWidth,
        viewportWidth,
        preference,
        explorerCollapsed,
      }),
    [containerWidth, explorerCollapsed, preference, viewportWidth],
  );

  const gridTemplateColumns =
    containerWidth > 0
      ? `${layout.explorerWidth}px ${MEMORY_WORKSPACE_HANDLE_WIDTH_PX}px ${layout.workWidth}px ${MEMORY_WORKSPACE_HANDLE_WIDTH_PX}px ${layout.previewWidth}px`
      : explorerCollapsed
        ? `44px ${MEMORY_WORKSPACE_HANDLE_WIDTH_PX}px minmax(0, 1fr) ${MEMORY_WORKSPACE_HANDLE_WIDTH_PX}px minmax(0, 1fr)`
        : `clamp(11rem, 15vw, 15rem) ${MEMORY_WORKSPACE_HANDLE_WIDTH_PX}px minmax(0, 1fr) ${MEMORY_WORKSPACE_HANDLE_WIDTH_PX}px minmax(0, 1fr)`;

  const handlePointerDown = (
    divider: MemoryWorkspaceDivider,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (
      event.button !== 0 ||
      containerWidth <= 0 ||
      (divider === "explorer" && explorerCollapsed)
    ) {
      return;
    }
    event.preventDefault();
    dragRef.current = {
      divider,
      pointerId: event.pointerId,
      startX: event.clientX,
      containerWidth,
      layout,
      preference,
      nextPreference: null,
    };
    setDragging(divider);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaPx = event.clientX - drag.startX;
    if (deltaPx === 0) return;
    const nextPreference = resizeMemoryWorkspacePanePreference({
      divider: drag.divider,
      deltaPx,
      containerWidth: drag.containerWidth,
      layout: drag.layout,
      preference: drag.preference,
    });
    drag.nextPreference = nextPreference;
    setPreference(nextPreference);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(null);
    if (drag.nextPreference) persistPreference(drag.nextPreference);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handlePointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(null);
    setPreference(drag.preference);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleKeyDown = (
    divider: MemoryWorkspaceDivider,
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) => {
    if (
      (event.key !== "ArrowLeft" && event.key !== "ArrowRight") ||
      containerWidth <= 0 ||
      (divider === "explorer" && explorerCollapsed)
    ) {
      return;
    }
    event.preventDefault();
    const nextPreference = resizeMemoryWorkspacePanePreference({
      divider,
      deltaPx:
        event.key === "ArrowLeft"
          ? -MEMORY_WORKSPACE_KEYBOARD_STEP_PX
          : MEMORY_WORKSPACE_KEYBOARD_STEP_PX,
      containerWidth,
      layout,
      preference,
    });
    setPreference(nextPreference);
    persistPreference(nextPreference);
  };

  const handleReset = () => {
    dragRef.current = null;
    setDragging(null);
    setPreference(null);
    persistPreference(null);
  };

  return (
    <div
      ref={setContainer}
      className="flex min-h-0 flex-1 lg:grid"
      style={{ gridTemplateColumns }}
    >
      {explorer}
      <ResizeHandle
        divider="explorer"
        label="Resize Files and Work panes"
        disabled={explorerCollapsed}
        dragging={dragging === "explorer"}
        value={layout.explorerWidth}
        minimum={layout.explorerMin}
        maximum={layout.explorerMax}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onLostPointerCapture={handlePointerCancel}
        onKeyDown={handleKeyDown}
        onReset={handleReset}
      />
      {work}
      <ResizeHandle
        divider="work"
        label="Resize Work and Preview panes"
        dragging={dragging === "work"}
        value={layout.workWidth}
        minimum={layout.workMin}
        maximum={layout.workMax}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onLostPointerCapture={handlePointerCancel}
        onKeyDown={handleKeyDown}
        onReset={handleReset}
      />
      {preview}
    </div>
  );
}
