export type MemoryLibraryTab = "memory" | "uploads";
export type MemoryWorkspaceMode = "manual" | "manager";

export type MemoryLibrarySearch = {
  tab: MemoryLibraryTab;
  mode: MemoryWorkspaceMode;
  entryId?: string;
  path?: string;
  managerRunId?: string;
};

export type MemoryLibrarySearchUpdate = {
  tab?: MemoryLibraryTab | null;
  mode?: MemoryWorkspaceMode | null;
  entryId?: string | null;
  path?: string | null;
  managerRunId?: string | null;
};

export type RawMemorySearch = {
  tab?: unknown;
  mode?: unknown;
  entryId?: unknown;
  path?: unknown;
  directory?: unknown;
  managerOpen?: unknown;
  managerRunId?: unknown;
  managerTask?: unknown;
};

function normalizeOptionalSearchParam(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "null" || trimmed === "undefined") {
    return undefined;
  }
  return trimmed;
}

/** Validates canonical state and maps legacy library/modal URLs into it. */
export function normalizeMemorySearch(
  search: RawMemorySearch,
): MemoryLibrarySearch {
  const rawTab = normalizeOptionalSearchParam(search.tab);
  const tab: MemoryLibraryTab = rawTab === "uploads" ? "uploads" : "memory";
  const entryId = normalizeOptionalSearchParam(search.entryId);
  const path = normalizeOptionalSearchParam(search.path);
  const managerRunId = normalizeOptionalSearchParam(search.managerRunId);
  const rawMode = normalizeOptionalSearchParam(search.mode);
  const legacyManagerOpen =
    normalizeOptionalSearchParam(search.managerOpen) === "true";
  const legacyManagerRequested =
    rawTab === "episodes" || legacyManagerOpen || Boolean(managerRunId);
  const mode: MemoryWorkspaceMode =
    rawMode === "manual" || rawMode === "manager"
      ? rawMode
      : legacyManagerRequested
        ? "manager"
        : "manual";

  return {
    tab,
    mode,
    ...(entryId ? { entryId } : {}),
    ...(path ? { path } : {}),
    ...(managerRunId ? { managerRunId } : {}),
  };
}

/** Sends generated episode selections to the manager while preserving ordinary file mode. */
export function modeForMemoryEntrySelection(
  currentMode: MemoryWorkspaceMode,
  generatedEpisode: boolean,
): MemoryWorkspaceMode {
  return currentMode === "manual" && generatedEpisode ? "manager" : currentMode;
}

/** Preserves valid workspace state from a full-reload URL. */
export function memorySearchFromUrl(url: URL): MemoryLibrarySearch {
  return normalizeMemorySearch({
    tab: url.searchParams.get("tab"),
    mode: url.searchParams.get("mode"),
    entryId: url.searchParams.get("entryId"),
    path: url.searchParams.get("path"),
    directory: url.searchParams.get("directory"),
    managerOpen: url.searchParams.get("managerOpen"),
    managerRunId: url.searchParams.get("managerRunId"),
    managerTask: url.searchParams.get("managerTask"),
  });
}

type WorkspaceLocation = {
  pathname: string;
  search?: unknown;
};

function workspaceTab(location: WorkspaceLocation) {
  if (!location.search || typeof location.search !== "object") return undefined;
  return "tab" in location.search ? location.search.tab : undefined;
}

/** Blocks only transitions that leave a dirty Memory workspace. */
export function shouldBlockMemoryWorkspaceExit(
  current: WorkspaceLocation,
  next: WorkspaceLocation,
) {
  if (next.pathname !== "/memories") return true;
  return (
    workspaceTab(current) !== "uploads" && workspaceTab(next) === "uploads"
  );
}
