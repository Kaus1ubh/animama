"use client";

import { useProductApiClient } from "@animama/product-ui";

import {
  DndContext,
  DragOverlay,
  MouseSensor,
  useDraggable,
  useSensor,
  useSensors,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { insertActionEditorSavedPose } from "./actionEditorSavedPose";
import { cn } from "@/lib/utils";
import { usePoseCreatorStore } from "@/stores/pose-creator-store";
import { findPoseCreatorClipKeyframeAtTime } from "@/ui/pose-creator/poseCreatorClipAuthoring";
import {
  selectHydratedCatalogEvent,
  type PendingCatalogSelection,
} from "./catalogDropSelection";
import { useActionEditorWorkspace } from "./ActionEditorWorkspaceContext";
import {
  catalogDragName,
  catalogDropLane,
  resolveTimelineDropTime,
  type CatalogDragItem,
  type TimelineDropPreview,
  type TimelinePoint,
} from "./timelineCatalogDrop";

type DropTarget = {
  track: RefObject<HTMLDivElement | null>;
  viewport?: RefObject<HTMLDivElement | null>;
  section: RefObject<HTMLElement | null>;
  expanded: boolean;
  onExpandedChange?: (value: boolean) => void;
};
type DragAccess = {
  enabled: boolean;
  register: (target: DropTarget) => () => void;
};
const DragAccessContext = createContext<DragAccess | null>(null);
const DropPreviewContext = createContext<TimelineDropPreview | null>(null);

/** Transient drag state is isolated here, never in the document or undo history. */
export function ActionCatalogDragProvider({
  children,
}: {
  children: ReactNode;
}) {
  const apiClient = useProductApiClient();

  const workspace = useActionEditorWorkspace();
  const liveWorkspace = useRef(workspace);
  liveWorkspace.current = workspace;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const enabled =
    (workspace.mode === "clip" || workspace.mode === "reaction") &&
    workspace.document.implementation === "anima_clip";
  const [active, setActive] = useState<CatalogDragItem | null>(null);
  const [preview, setPreview] = useState<TimelineDropPreview | null>(null);
  const target = useRef<DropTarget | null>(null);
  const drag = useRef<{
    item: CatalogDragItem;
    origin: TimelinePoint;
    point: TimelinePoint;
  } | null>(null);
  const frame = useRef<number | null>(null);
  const expandTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoExpanded = useRef<DropTarget["onExpandedChange"]>(undefined);
  const [pendingSelection, setPendingSelection] =
    useState<PendingCatalogSelection | null>(null);
  const events = usePoseCreatorStore((state) => state.clipDraft.events);
  // Mouse-only activation preserves touch scrolling and the mobile plus workflow.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
  );

  const clearExpansionTimer = useCallback(() => {
    if (expandTimer.current !== null) clearTimeout(expandTimer.current);
    expandTimer.current = null;
  }, []);

  const resolvePreview = useCallback((): TimelineDropPreview | null => {
    const current = drag.current;
    const dropTarget = target.current;
    if (!current || !dropTarget?.expanded || !dropTarget.track.current)
      return null;
    const viewport = dropTarget.viewport?.current?.getBoundingClientRect();
    if (
      viewport &&
      (current.point.x < viewport.left ||
        current.point.x > viewport.right ||
        current.point.y < viewport.top ||
        current.point.y > viewport.bottom)
    )
      return null;
    const state = usePoseCreatorStore.getState();
    const time = resolveTimelineDropTime(
      current.point,
      dropTarget.track.current.getBoundingClientRect(),
      state.clipDraft.duration,
      state.clipSnapEnabled,
      state.clipSnapIntervalSec,
    );
    if (time === null) return null;
    return {
      time,
      lane: catalogDropLane(current.item),
      replacesPose:
        current.item.kind === "pose" &&
        Boolean(
          findPoseCreatorClipKeyframeAtTime(state.clipDraft.keyframes, time),
        ),
    };
  }, []);

  const updatePreview = useCallback(() => {
    const current = drag.current;
    const dropTarget = target.current;
    if (!current || !dropTarget) return;
    const rect = dropTarget.section.current?.getBoundingClientRect();
    const overCollapsed =
      !dropTarget.expanded &&
      rect &&
      rect.width > 0 &&
      current.point.x >= rect.left &&
      current.point.x <= rect.right &&
      current.point.y >= rect.top &&
      current.point.y <= rect.bottom;
    if (overCollapsed && dropTarget.onExpandedChange) {
      if (expandTimer.current === null) {
        expandTimer.current = setTimeout(() => {
          expandTimer.current = null;
          autoExpanded.current = dropTarget.onExpandedChange;
          dropTarget.onExpandedChange?.(true);
        }, 300);
      }
    } else clearExpansionTimer();
    const next = resolvePreview();
    setPreview((previous) =>
      previous?.time === next?.time &&
      previous?.lane === next?.lane &&
      previous?.replacesPose === next?.replacesPose
        ? previous
        : next,
    );
  }, [clearExpansionTimer, resolvePreview]);

  const schedulePreview = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      updatePreview();
    });
  }, [updatePreview]);

  const register = useCallback(
    (value: DropTarget) => {
      target.current = value;
      schedulePreview();
      const observer = new ResizeObserver(schedulePreview);
      if (value.track.current) observer.observe(value.track.current);
      if (value.section.current) observer.observe(value.section.current);
      return () => {
        observer.disconnect();
        if (target.current === value) target.current = null;
      };
    },
    [schedulePreview],
  );

  const finish = useCallback(
    (committed: boolean) => {
      clearExpansionTimer();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      if (!committed) autoExpanded.current?.(false);
      autoExpanded.current = undefined;
      drag.current = null;
      setActive(null);
      setPreview(null);
    },
    [clearExpansionTimer],
  );

  const cancelDrag = useCallback(() => {
    finish(false);
  }, [finish]);

  useEffect(() => {
    cancelDrag();
    setPendingSelection(null);
  }, [enabled, workspace.timelineSession, cancelDrag]);

  useEffect(() => {
    window.addEventListener("blur", cancelDrag);
    window.addEventListener("resize", schedulePreview);
    window.addEventListener("scroll", schedulePreview, true);
    return () => {
      window.removeEventListener("blur", cancelDrag);
      window.removeEventListener("resize", schedulePreview);
      window.removeEventListener("scroll", schedulePreview, true);
      clearExpansionTimer();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [clearExpansionTimer, cancelDrag, schedulePreview]);

  useEffect(() => {
    if (
      selectHydratedCatalogEvent(
        pendingSelection,
        workspace.timelineSession,
        enabled,
      )
    ) {
      setPendingSelection(null);
    }
  }, [events, pendingSelection, workspace.timelineSession, enabled]);

  const handleStart = ({ active: dragged, activatorEvent }: DragStartEvent) => {
    const item = dragged.data.current?.catalogItem as
      | CatalogDragItem
      | undefined;
    if (
      !enabled ||
      !item ||
      (item.kind === "pose" && workspace.document.intent !== "gesture") ||
      !(activatorEvent instanceof MouseEvent)
    )
      return;
    const point = { x: activatorEvent.clientX, y: activatorEvent.clientY };
    drag.current = { item, origin: point, point };
    setActive(item);
    schedulePreview();
  };
  const updatePoint = ({ delta }: DragMoveEvent) => {
    if (!drag.current) return;
    drag.current.point = {
      x: drag.current.origin.x + delta.x,
      y: drag.current.origin.y + delta.y,
    };
  };
  const access = useMemo(() => ({ enabled, register }), [enabled, register]);

  return (
    <DndContext
      sensors={sensors}
      autoScroll={false}
      onDragStart={handleStart}
      onDragMove={(event) => {
        updatePoint(event);
        schedulePreview();
      }}
      onDragCancel={() => finish(false)}
      onDragEnd={(event) => {
        updatePoint(event);
        const next = resolvePreview();
        const item = drag.current?.item;
        let committed = false;
        if (enabled && next && item) {
          if (item.kind === "pose") {
            const session = workspace.timelineSession;
            const restoreCollapse = autoExpanded.current;
            // End the pointer gesture immediately; only successful insertion retains expansion.
            finish(true);
            void insertActionEditorSavedPose(apiClient, item.pose, {
              timeSec: next.time,
              isCurrent: () =>
                alive.current &&
                liveWorkspace.current.timelineSession === session &&
                liveWorkspace.current.document.intent === "gesture" &&
                liveWorkspace.current.mode === "clip",
            }).then((inserted) => {
              if (
                !inserted &&
                alive.current &&
                liveWorkspace.current.timelineSession === session
              )
                restoreCollapse?.(false);
            });
            return;
          } else {
            const id = workspace.addComponent(item.item, item.contentType, {
              timeSec: next.time,
            });
            if (id) {
              usePoseCreatorStore.getState().pauseClipPreview();
              setPendingSelection({ id, session: workspace.timelineSession });
              committed = true;
            }
          }
        }
        finish(committed);
      }}
      accessibility={{
        announcements: {
          onDragStart: () =>
            "Dragging catalog item. Drop on the timeline or press Escape to cancel.",
          onDragOver: () => undefined,
          onDragEnd: () => "Drag finished.",
          onDragCancel: () => "Drag cancelled.",
        },
      }}
    >
      <DragAccessContext.Provider value={access}>
        <DropPreviewContext.Provider value={preview}>
          {children}
        </DropPreviewContext.Provider>
      </DragAccessContext.Provider>
      {typeof document !== "undefined"
        ? createPortal(
            <DragOverlay dropAnimation={null} style={{ pointerEvents: "none" }}>
              {active ? (
                <div className="bg-background border-primary/50 max-w-48 truncate rounded-lg border px-3 py-2 text-xs opacity-85 shadow-lg">
                  {catalogDragName(active)}
                </div>
              ) : null}
            </DragOverlay>,
            document.body,
          )
        : null}
    </DndContext>
  );
}

/** Only icon/name are drag handles; plus remains a separate keyboard-accessible action. */
export function CatalogDragHandle({
  item,
  disabled,
  children,
}: {
  item: CatalogDragItem;
  disabled?: boolean;
  children: ReactNode;
}) {
  const access = useContext(DragAccessContext);
  const instanceId = useId();
  const enabled = Boolean(access?.enabled && !disabled);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id:
      item.kind === "pose"
        ? `pose:${item.pose.item_id}:${instanceId}`
        : `effect:${item.contentType}:${item.item.item_id}:${instanceId}`,
    data: { catalogItem: item },
    disabled: !enabled,
  });
  return (
    <div
      ref={setNodeRef}
      {...(enabled ? attributes : {})}
      {...(enabled ? listeners : {})}
      tabIndex={-1}
      aria-label={
        enabled ? `Drag ${catalogDragName(item)} to timeline` : undefined
      }
      className={cn(
        "flex min-w-0 flex-1 items-center gap-2",
        enabled && "cursor-grab select-none active:cursor-grabbing",
        isDragging && "opacity-40",
      )}
    >
      {children}
    </div>
  );
}

export function useCatalogTimelineDrop(target: DropTarget, enabled: boolean) {
  const access = useContext(DragAccessContext);
  const preview = useContext(DropPreviewContext);
  const { track, viewport, section, expanded, onExpandedChange } = target;
  useEffect(() => {
    if (!enabled || !access?.enabled) return;
    return access.register({
      track,
      viewport,
      section,
      expanded,
      onExpandedChange,
    });
  }, [access, enabled, track, viewport, section, expanded, onExpandedChange]);
  return enabled ? preview : null;
}
