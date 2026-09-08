import type { ContentPreviewTarget, ContentPreviewView } from "./types";

export type ContentPreviewPosition = { x: number; y: number };
export type ContentPreviewSize = { width: number; height: number };

export type ContentPreviewViewEvent =
  | "open"
  | "minimize"
  | "restore"
  | "toggle_expand"
  | "close"
  | "expire";

/** Pure Preview Dock presentation state machine used by the provider and tests. */
export function reduceContentPreviewView(
  view: ContentPreviewView,
  event: ContentPreviewViewEvent,
): ContentPreviewView {
  switch (event) {
    case "open":
      return view === "expanded" ? "expanded" : "docked";
    case "minimize":
      return "minimized";
    case "restore":
      return "docked";
    case "toggle_expand":
      return view === "expanded" ? "docked" : "expanded";
    case "close":
    case "expire":
      return "hidden";
  }
}

export function shouldArmContentPreviewIdleTimer(
  initialized: boolean,
  view: ContentPreviewView,
): boolean {
  return initialized && (view === "hidden" || view === "minimized");
}

export type ContentPreviewDockState = {
  target: ContentPreviewTarget | null;
  view: ContentPreviewView;
  initialized: boolean;
  managementOwnerId: string | null;
};

export type ContentPreviewDockEvent =
  | { type: "open"; target: ContentPreviewTarget }
  | { type: "view"; event: Exclude<ContentPreviewViewEvent, "open" | "expire"> }
  | { type: "expire" }
  | { type: "claim_management"; ownerId: string }
  | { type: "release_management"; ownerId: string };

export const INITIAL_CONTENT_PREVIEW_DOCK_STATE: ContentPreviewDockState = {
  target: null,
  view: "hidden",
  initialized: false,
  managementOwnerId: null,
};

/** Coordinate one exclusive Library Dock or management-stage renderer owner. */
export function reduceContentPreviewDockState(
  state: ContentPreviewDockState,
  event: ContentPreviewDockEvent,
): ContentPreviewDockState {
  switch (event.type) {
    case "open":
      if (state.managementOwnerId) return state;
      return {
        ...state,
        target: event.target,
        view: reduceContentPreviewView(state.view, "open"),
        initialized: true,
      };
    case "view":
      return {
        ...state,
        view: reduceContentPreviewView(state.view, event.event),
      };
    case "expire":
      return {
        ...state,
        target: null,
        view: "hidden",
        initialized: false,
      };
    case "claim_management":
      if (
        state.managementOwnerId === event.ownerId &&
        !state.initialized &&
        !state.target &&
        state.view === "hidden"
      ) {
        return state;
      }
      return {
        target: null,
        view: "hidden",
        initialized: false,
        managementOwnerId: event.ownerId,
      };
    case "release_management":
      return state.managementOwnerId === event.ownerId
        ? { ...state, managementOwnerId: null }
        : state;
  }
}

/** Keep a dragged preview surface reachable inside the current viewport. */
export function clampContentPreviewPosition(
  position: ContentPreviewPosition,
  panel: ContentPreviewSize,
  viewport: ContentPreviewSize,
  margin = 8,
): ContentPreviewPosition {
  const maxX = Math.max(margin, viewport.width - panel.width - margin);
  const maxY = Math.max(margin, viewport.height - panel.height - margin);
  return {
    x: Math.min(maxX, Math.max(margin, position.x)),
    y: Math.min(maxY, Math.max(margin, position.y)),
  };
}
