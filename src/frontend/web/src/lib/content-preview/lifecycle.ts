export type ContentPreviewRendererOwner = "dock" | "management" | "creator";
export type ContentPreviewRendererResource = "canvas" | "avatar" | "catalog";
export type ContentPreviewLifecycleEvent =
  | "session_create"
  | "preview_open"
  | "avatar_load"
  | "avatar_reuse"
  | "source_resolve_success"
  | "source_resolve_failure"
  | "first_playable_frame"
  | "target_replacement"
  | "hidden_warm"
  | "eviction"
  | "webgl_loss"
  | "final_disposal";

export type ContentPreviewLifecycleDetails = {
  kind?: string;
  slot?: string;
  sourceType?: string;
  reason?: "timeout" | "explicit" | "route_handoff" | "unmount";
};

export type ContentPreviewLifecycleSnapshot = Record<
  ContentPreviewRendererOwner,
  Record<ContentPreviewRendererResource, number>
> & {
  totalCanvases: number;
  totalAvatars: number;
  totalCatalogs: number;
};

const counts = {
  dock: { canvas: 0, avatar: 0, catalog: 0 },
  management: { canvas: 0, avatar: 0, catalog: 0 },
  creator: { canvas: 0, avatar: 0, catalog: 0 },
};

type LifecycleGlobal = typeof globalThis & {
  __ANIMAMA_CONTENT_PREVIEW_LIFECYCLE__?: ContentPreviewLifecycleSnapshot;
};

/** Expose anonymous development counters for validating exclusive ownership. */
export function contentPreviewLifecycleSnapshot(): ContentPreviewLifecycleSnapshot {
  return {
    dock: { ...counts.dock },
    management: { ...counts.management },
    creator: { ...counts.creator },
    totalCanvases:
      counts.dock.canvas + counts.management.canvas + counts.creator.canvas,
    totalAvatars:
      counts.dock.avatar + counts.management.avatar + counts.creator.avatar,
    totalCatalogs:
      counts.dock.catalog + counts.management.catalog + counts.creator.catalog,
  };
}

function publishSnapshot(): void {
  if (!import.meta.env.DEV) return;
  (globalThis as LifecycleGlobal).__ANIMAMA_CONTENT_PREVIEW_LIFECYCLE__ =
    contentPreviewLifecycleSnapshot();
}

/** Log only bounded lifecycle facts; private identities and URLs are excluded. */
export function logContentPreviewLifecycle(
  event: ContentPreviewLifecycleEvent,
  owner: ContentPreviewRendererOwner,
  details: ContentPreviewLifecycleDetails = {},
): void {
  if (!import.meta.env.DEV) return;
  console.debug("[content-preview] lifecycle", { event, owner, ...details });
}

/** Count one mounted renderer resource and return an idempotent disposer. */
export function acquireContentPreviewResource(
  owner: ContentPreviewRendererOwner,
  resource: ContentPreviewRendererResource,
): () => void {
  if (!import.meta.env.DEV) return () => undefined;
  counts[owner][resource] += 1;
  publishSnapshot();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    counts[owner][resource] = Math.max(0, counts[owner][resource] - 1);
    publishSnapshot();
  };
}

/** Reset counters between unit tests without exposing runtime identifiers. */
export function resetContentPreviewLifecycleForTests(): void {
  counts.dock = { canvas: 0, avatar: 0, catalog: 0 };
  counts.management = { canvas: 0, avatar: 0, catalog: 0 };
  counts.creator = { canvas: 0, avatar: 0, catalog: 0 };
  publishSnapshot();
}

publishSnapshot();
