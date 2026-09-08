import type { RuntimeCatalogEntry } from "@/lib/runtime-content/types";
import type { PreparedContentPreview } from "./preparation";
import type { ContentPreviewLoadStatus, ContentPreviewTarget } from "./types";

export type PreparedAnimaStagePreview = PreparedContentPreview;

export type AnimaStagePreviewState = {
  target: ContentPreviewTarget | null;
  prepared: PreparedAnimaStagePreview | null;
  status: ContentPreviewLoadStatus;
  error: string | null;
  playRequest: number;
  loop: boolean;
};

export type AnimaStagePreviewEvent =
  | { type: "select"; target: ContentPreviewTarget }
  | {
      type: "prepared";
      prepared: PreparedAnimaStagePreview;
      autoplay: boolean;
    }
  | { type: "replay" }
  | { type: "set_loop"; loop: boolean }
  | {
      type: "status";
      status: ContentPreviewLoadStatus;
      error?: string;
    }
  | { type: "stop" };

export const INITIAL_ANIMA_STAGE_PREVIEW_STATE: AnimaStagePreviewState = {
  target: null,
  prepared: null,
  status: "idle",
  error: null,
  playRequest: 0,
  loop: false,
};

/** Every supported Anima target remains on the existing management canvas. */
export function isAnimaStagePreviewTarget(
  target: ContentPreviewTarget,
): boolean {
  return Boolean(target.animaContext);
}

/** Compare immutable runtime sources without trusting preview revision prefixes. */
export function runtimeEntriesShareSource(
  left: RuntimeCatalogEntry,
  right: RuntimeCatalogEntry,
): boolean {
  return (
    left.content_revision === right.content_revision ||
    JSON.stringify(left.source) === JSON.stringify(right.source)
  );
}

/** Select a temporary model only when it differs and its current load has not failed. */
export function selectAnimaStageAvatarEntry(input: {
  saved: RuntimeCatalogEntry | null;
  prepared: PreparedAnimaStagePreview | null;
  failed?: { key: string; playRequest: number } | null;
  playRequest: number;
}): { entry: RuntimeCatalogEntry | null; temporary: boolean } {
  const preview =
    input.prepared?.target.kind === "avatar_model"
      ? input.prepared.entry
      : null;
  if (
    !preview ||
    (input.saved && runtimeEntriesShareSource(preview, input.saved)) ||
    (input.failed?.key === preview.content_revision &&
      input.failed.playRequest === input.playRequest)
  ) {
    return { entry: input.saved, temporary: false };
  }
  return { entry: preview, temporary: true };
}

/** Pure route-local state transitions for the management-canvas preview. */
export function reduceAnimaStagePreview(
  state: AnimaStagePreviewState,
  event: AnimaStagePreviewEvent,
): AnimaStagePreviewState {
  switch (event.type) {
    case "select":
      return {
        target: event.target,
        prepared: null,
        status: "loading",
        error: null,
        playRequest: state.playRequest,
        loop: false,
      };
    case "prepared":
      if (state.target?.key !== event.prepared.target.key) return state;
      if (state.prepared?.entryKey === event.prepared.entryKey) return state;
      return {
        ...state,
        prepared: event.prepared,
        status: event.autoplay ? "loading" : "ready",
        error: null,
        playRequest: event.autoplay ? state.playRequest + 1 : state.playRequest,
      };
    case "replay":
      return state.target
        ? {
            ...state,
            status: "loading",
            error: null,
            playRequest: state.playRequest + 1,
          }
        : state;
    case "set_loop":
      return state.target ? { ...state, loop: event.loop } : state;
    case "status":
      return state.target
        ? {
            ...state,
            status: event.status,
            error:
              event.status === "error"
                ? (event.error ?? "Preview unavailable.")
                : null,
          }
        : state;
    case "stop":
      return {
        ...INITIAL_ANIMA_STAGE_PREVIEW_STATE,
        playRequest: state.playRequest,
      };
  }
}
