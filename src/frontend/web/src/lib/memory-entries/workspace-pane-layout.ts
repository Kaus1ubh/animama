import { isRecord } from "@/lib/records";

export const MEMORY_WORKSPACE_LAYOUT_STORAGE_KEY =
  "animama.memory-workspace.layout.v1";

export const MEMORY_WORKSPACE_LAYOUT_VERSION = 1;
export const MEMORY_WORKSPACE_HANDLE_WIDTH_PX = 6;
export const MEMORY_WORKSPACE_EXPLORER_COLLAPSED_PX = 44;
export const MEMORY_WORKSPACE_EXPLORER_MIN_PX = 176;
export const MEMORY_WORKSPACE_EXPLORER_MAX_PX = 448;
export const MEMORY_WORKSPACE_PANE_MIN_PX = 288;
export const MEMORY_WORKSPACE_KEYBOARD_STEP_PX = 16;

const DEFAULT_EXPLORER_MAX_PX = 240;
const MIN_EXPLORER_RATIO = 0.01;
const MAX_EXPLORER_RATIO = 0.8;
const MIN_WORK_SHARE = 0.1;
const MAX_WORK_SHARE = 0.9;

export type MemoryWorkspacePanePreference = {
  explorerRatio: number;
  workShare: number;
};

export type MemoryWorkspacePaneLayout = {
  explorerWidth: number;
  workWidth: number;
  previewWidth: number;
  explorerMin: number;
  explorerMax: number;
  workMin: number;
  workMax: number;
};

export type MemoryWorkspaceDivider = "explorer" | "work";

type ResolveMemoryWorkspacePaneLayoutArgs = {
  containerWidth: number;
  viewportWidth?: number;
  preference: MemoryWorkspacePanePreference | null;
  explorerCollapsed: boolean;
};

type ResizeMemoryWorkspacePanePreferenceArgs = {
  divider: MemoryWorkspaceDivider;
  deltaPx: number;
  containerWidth: number;
  layout: MemoryWorkspacePaneLayout;
  preference: MemoryWorkspacePanePreference | null;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteNonNegative(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function validPreference(
  value: unknown,
): value is MemoryWorkspacePanePreference {
  if (!isRecord(value)) return false;
  return (
    typeof value.explorerRatio === "number" &&
    Number.isFinite(value.explorerRatio) &&
    value.explorerRatio >= MIN_EXPLORER_RATIO &&
    value.explorerRatio <= MAX_EXPLORER_RATIO &&
    typeof value.workShare === "number" &&
    Number.isFinite(value.workShare) &&
    value.workShare >= MIN_WORK_SHARE &&
    value.workShare <= MAX_WORK_SHARE
  );
}

/** Parses a versioned pane preference without reading browser storage. */
export function parseMemoryWorkspacePanePreference(raw: string | null) {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !isRecord(value) ||
      value.version !== MEMORY_WORKSPACE_LAYOUT_VERSION ||
      !validPreference(value)
    ) {
      return null;
    }
    return {
      explorerRatio: value.explorerRatio,
      workShare: value.workShare,
    };
  } catch {
    return null;
  }
}

/** Serializes only normalized, versioned pane preferences. */
export function serializeMemoryWorkspacePanePreference(
  preference: MemoryWorkspacePanePreference,
) {
  return JSON.stringify({
    version: MEMORY_WORKSPACE_LAYOUT_VERSION,
    explorerRatio: preference.explorerRatio,
    workShare: preference.workShare,
  });
}

/** Resolves persisted proportions into constrained desktop pixel tracks. */
export function resolveMemoryWorkspacePaneLayout({
  containerWidth,
  viewportWidth = containerWidth,
  preference,
  explorerCollapsed,
}: ResolveMemoryWorkspacePaneLayoutArgs): MemoryWorkspacePaneLayout {
  const width = finiteNonNegative(containerWidth);
  const handleSpace = Math.min(width, MEMORY_WORKSPACE_HANDLE_WIDTH_PX * 2);
  const paneSpace = Math.max(0, width - handleSpace);
  const hasFullMinimums =
    paneSpace >=
    MEMORY_WORKSPACE_EXPLORER_MIN_PX + MEMORY_WORKSPACE_PANE_MIN_PX * 2;

  let explorerMin = 0;
  let explorerMax = paneSpace;
  let explorerWidth = Math.min(
    MEMORY_WORKSPACE_EXPLORER_COLLAPSED_PX,
    paneSpace,
  );

  if (!explorerCollapsed) {
    explorerMin = hasFullMinimums ? MEMORY_WORKSPACE_EXPLORER_MIN_PX : 0;
    explorerMax = hasFullMinimums
      ? Math.min(
          MEMORY_WORKSPACE_EXPLORER_MAX_PX,
          paneSpace - MEMORY_WORKSPACE_PANE_MIN_PX * 2,
        )
      : paneSpace / 3;
    const defaultExplorerWidth = clamp(
      finiteNonNegative(viewportWidth) * 0.15,
      MEMORY_WORKSPACE_EXPLORER_MIN_PX,
      DEFAULT_EXPLORER_MAX_PX,
    );
    const requestedExplorerWidth = preference
      ? preference.explorerRatio * width
      : defaultExplorerWidth;
    explorerWidth = clamp(requestedExplorerWidth, explorerMin, explorerMax);
  } else {
    explorerMin = explorerWidth;
    explorerMax = explorerWidth;
  }

  const remaining = Math.max(0, paneSpace - explorerWidth);
  const hasContentMinimums = remaining >= MEMORY_WORKSPACE_PANE_MIN_PX * 2;
  const workMin = hasContentMinimums ? MEMORY_WORKSPACE_PANE_MIN_PX : 0;
  const workMax = hasContentMinimums
    ? remaining - MEMORY_WORKSPACE_PANE_MIN_PX
    : remaining;
  const workShare = preference?.workShare ?? 0.5;
  const workWidth = clamp(remaining * workShare, workMin, workMax);

  return {
    explorerWidth,
    workWidth,
    previewWidth: Math.max(0, remaining - workWidth),
    explorerMin,
    explorerMax,
    workMin,
    workMax,
  };
}

/** Converts one separator movement into a normalized preference. */
export function resizeMemoryWorkspacePanePreference({
  divider,
  deltaPx,
  containerWidth,
  layout,
  preference,
}: ResizeMemoryWorkspacePanePreferenceArgs): MemoryWorkspacePanePreference {
  const width = finiteNonNegative(containerWidth);
  const contentWidth = layout.workWidth + layout.previewWidth;
  const effectivePreference: MemoryWorkspacePanePreference = preference ?? {
    explorerRatio: width > 0 ? layout.explorerWidth / width : 0.15,
    workShare: contentWidth > 0 ? layout.workWidth / contentWidth : 0.5,
  };

  if (divider === "explorer") {
    const nextExplorerWidth = clamp(
      layout.explorerWidth + deltaPx,
      layout.explorerMin,
      layout.explorerMax,
    );
    return {
      explorerRatio: clamp(
        width > 0
          ? nextExplorerWidth / width
          : effectivePreference.explorerRatio,
        MIN_EXPLORER_RATIO,
        MAX_EXPLORER_RATIO,
      ),
      workShare: effectivePreference.workShare,
    };
  }

  const nextWorkWidth = clamp(
    layout.workWidth + deltaPx,
    layout.workMin,
    layout.workMax,
  );
  return {
    explorerRatio: effectivePreference.explorerRatio,
    workShare: clamp(
      contentWidth > 0
        ? nextWorkWidth / contentWidth
        : effectivePreference.workShare,
      MIN_WORK_SHARE,
      MAX_WORK_SHARE,
    ),
  };
}
