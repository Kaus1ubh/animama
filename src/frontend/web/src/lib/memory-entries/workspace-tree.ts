import type { PyMemoryEntryHeader } from "@/lib/content/catalogTypes";
import {
  ANIMAS_WORKSPACE_LABEL,
  animaFolderFiles,
  isReservedUserMemoryEntry,
  type MemoryAnimaFolder,
} from "@/lib/memory-entries/anima-folders";
import { groupEpisodeEntries } from "@/lib/memory-entries/episode-groups";
import { isEpisodeLogEntry } from "@/lib/memory-entries/protection";

export type MemoryWorkspaceTreeNode =
  | {
      kind: "directory";
      id: string;
      label: string;
      entry: PyMemoryEntryHeader;
      children: MemoryWorkspaceTreeNode[];
    }
  | {
      kind: "file";
      id: string;
      label: string;
      entry: PyMemoryEntryHeader;
      /** Owner-facing path when it differs from the stored scope path. */
      displayPath?: string;
      children: [];
    }
  | {
      kind: "anima-root";
      id: "virtual:animas";
      label: typeof ANIMAS_WORKSPACE_LABEL;
      children: MemoryWorkspaceTreeNode[];
    }
  | {
      kind: "anima-directory";
      id: string;
      label: string;
      animaId: string;
      /** The identity needs explicit repair; it has no child row. */
      identityMissing: boolean;
      /** `MEMORIES.md` is missing and can be recreated from its template. */
      memoriesMissing: boolean;
      children: MemoryWorkspaceTreeNode[];
    }
  | {
      kind: "episode-root";
      id: "virtual:episodes";
      label: "Episodes";
      children: MemoryWorkspaceTreeNode[];
    }
  | {
      kind: "episode-month";
      id: string;
      label: string;
      children: MemoryWorkspaceTreeNode[];
    }
  | {
      kind: "episode-file";
      id: string;
      label: string;
      entry: PyMemoryEntryHeader;
      children: [];
    };

const EPISODE_ROOT_ID = "virtual:episodes" as const;
const ANIMA_ROOT_ID = "virtual:animas" as const;

function compareEntries(left: PyMemoryEntryHeader, right: PyMemoryEntryHeader) {
  if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
  return (
    left.name.localeCompare(right.name, undefined, {
      numeric: true,
      sensitivity: "base",
    }) || left.path.localeCompare(right.path)
  );
}

/** User-scope entries that belong in the physical explorer hierarchy. */
function isPhysicalUserEntry(entry: PyMemoryEntryHeader) {
  return !entry.anima_id && !isEpisodeLogEntry(entry);
}

function physicalTree(entries: PyMemoryEntryHeader[]) {
  const ordinaryEntries = entries.filter(isPhysicalUserEntry);
  const byId = new Map(ordinaryEntries.map((entry) => [entry.id, entry]));
  const childrenByParentId = new Map<string | null, PyMemoryEntryHeader[]>();

  for (const entry of ordinaryEntries) {
    const parentId =
      entry.parent_id && byId.has(entry.parent_id) ? entry.parent_id : null;
    const siblings = childrenByParentId.get(parentId) ?? [];
    siblings.push(entry);
    childrenByParentId.set(parentId, siblings);
  }
  for (const siblings of childrenByParentId.values()) {
    siblings.sort(compareEntries);
  }

  const visited = new Set<string>();
  const build = (
    entry: PyMemoryEntryHeader,
    ancestors: Set<string>,
  ): MemoryWorkspaceTreeNode => {
    visited.add(entry.id);
    if (entry.type === "file") {
      return {
        kind: "file",
        id: entry.id,
        label: entry.name,
        entry,
        children: [],
      };
    }
    if (ancestors.has(entry.id)) {
      return {
        kind: "directory",
        id: entry.id,
        label: entry.name,
        entry,
        children: [],
      };
    }
    const nextAncestors = new Set(ancestors).add(entry.id);
    return {
      kind: "directory",
      id: entry.id,
      label: entry.name,
      entry,
      children: (childrenByParentId.get(entry.id) ?? []).map((child) =>
        build(child, nextAncestors),
      ),
    };
  };

  const roots = (childrenByParentId.get(null) ?? []).map((entry) =>
    build(entry, new Set()),
  );
  for (const entry of [...ordinaryEntries].sort(compareEntries)) {
    if (!visited.has(entry.id)) roots.push(build(entry, new Set()));
  }
  return roots;
}

function episodeTree(
  entries: PyMemoryEntryHeader[],
  locale?: string,
): MemoryWorkspaceTreeNode {
  const groups = groupEpisodeEntries(entries, "", locale);
  return {
    kind: "episode-root",
    id: EPISODE_ROOT_ID,
    label: "Episodes",
    children: groups.map((group) => ({
      kind: "episode-month",
      id: `virtual:episodes:${group.key}`,
      label: group.label,
      children: group.items.map((item) => ({
        kind: "episode-file",
        id: item.entry.id,
        label: item.displayName,
        entry: item.entry,
        children: [],
      })),
    })),
  };
}

function animaTree(folders: MemoryAnimaFolder[]): MemoryWorkspaceTreeNode {
  return {
    kind: "anima-root",
    id: ANIMA_ROOT_ID,
    label: ANIMAS_WORKSPACE_LABEL,
    children: folders.map((folder) => ({
      kind: "anima-directory",
      id: `${ANIMA_ROOT_ID}:${folder.animaId}`,
      label: folder.label,
      animaId: folder.animaId,
      identityMissing: !folder.identity.entry,
      memoriesMissing: !folder.memories.entry,
      children: animaFolderFiles(folder).flatMap(
        ({ entry, path }): MemoryWorkspaceTreeNode[] =>
          entry
            ? [
                {
                  kind: "file",
                  id: entry.id,
                  label: entry.name,
                  entry,
                  displayPath: path,
                  children: [],
                },
              ]
            : [],
      ),
    })),
  };
}

/**
 * Builds the virtual Animas root (one folder per owned Anima holding its
 * `IDENTITY.md` and `MEMORIES.md`), the chronological virtual Episodes root,
 * then physical user memory.
 */
export function buildMemoryWorkspaceTree(
  entries: PyMemoryEntryHeader[],
  locale?: string,
  animaFolders: MemoryAnimaFolder[] = [],
) {
  const roots = physicalTree(entries);
  const episodes = episodeTree(entries, locale);
  const directories = roots.filter((node) => node.kind === "directory");
  const files = roots.filter((node) => node.kind !== "directory");
  return [animaTree(animaFolders), episodes, ...directories, ...files];
}

function nodeSearchText(node: MemoryWorkspaceTreeNode) {
  if (!("entry" in node)) return `${node.label} ${node.id}`;
  const entry = node.entry;
  const displayPath = node.kind === "file" ? node.displayPath : undefined;
  return [
    node.label,
    entry.name,
    displayPath ?? entry.path,
    entry.description,
    entry.kind,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");
}

/** Filters nodes recursively while retaining every ancestor of a match. */
export function filterMemoryWorkspaceTree(
  nodes: MemoryWorkspaceTreeNode[],
  query: string,
): MemoryWorkspaceTreeNode[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return nodes;

  return nodes.flatMap((node) => {
    const children = filterMemoryWorkspaceTree(node.children, query);
    const matches = nodeSearchText(node).toLocaleLowerCase().includes(needle);
    if (!matches && children.length === 0) return [];
    return [{ ...node, children } as MemoryWorkspaceTreeNode];
  });
}

/** Returns every expandable node ID so filtered matches can be revealed. */
export function expandableMemoryWorkspaceNodeIds(
  nodes: MemoryWorkspaceTreeNode[],
) {
  const result: string[] = [];
  const visit = (node: MemoryWorkspaceTreeNode) => {
    if (node.children.length > 0) result.push(node.id);
    for (const child of node.children) visit(child);
  };
  for (const node of nodes) visit(node);
  return result;
}

export function defaultMemoryWorkspaceExpandedIds(
  nodes: MemoryWorkspaceTreeNode[],
) {
  const animas = nodes.find((node) => node.kind === "anima-root");
  const episodes = nodes.find((node) => node.kind === "episode-root");
  return new Set([
    ...(animas ? [animas.id] : []),
    ...(episodes
      ? [
          episodes.id,
          ...(episodes.children[0] ? [episodes.children[0].id] : []),
        ]
      : []),
  ]);
}

export function memoryWorkspaceAncestorIds(
  nodes: MemoryWorkspaceTreeNode[],
  entryId: string | null | undefined,
) {
  if (!entryId) return [];
  const visit = (
    node: MemoryWorkspaceTreeNode,
    ancestors: string[],
  ): string[] | null => {
    if (node.id === entryId) return ancestors;
    const nextAncestors =
      node.children.length > 0 ? [...ancestors, node.id] : ancestors;
    for (const child of node.children) {
      const found = visit(child, nextAncestors);
      if (found) return found;
    }
    return null;
  };
  for (const node of nodes) {
    const found = visit(node, []);
    if (found) return found;
  }
  return [];
}

export function findMemoryWorkspaceNode(
  nodes: MemoryWorkspaceTreeNode[],
  nodeId: string | null | undefined,
): MemoryWorkspaceTreeNode | null {
  if (!nodeId) return null;
  for (const node of nodes) {
    if (node.id === nodeId) return node;
    const child = findMemoryWorkspaceNode(node.children, nodeId);
    if (child) return child;
  }
  return null;
}

export function initialMemoryWorkspaceFileId(entries: PyMemoryEntryHeader[]) {
  const ordinaryFiles = entries
    .filter((entry) => entry.type === "file" && isPhysicalUserEntry(entry))
    .sort((left, right) => left.path.localeCompare(right.path));
  const profile = ordinaryFiles.find(
    (entry) => entry.path.toLowerCase() === "profile.md",
  );
  if (profile) return profile.id;
  if (ordinaryFiles[0]) return ordinaryFiles[0].id;
  return groupEpisodeEntries(entries)[0]?.items[0]?.entry.id ?? null;
}

export function resolveMemoryWorkspaceFileId(
  entries: PyMemoryEntryHeader[],
  selectedEntryId: string | null | undefined,
) {
  if (
    selectedEntryId &&
    entries.some(
      (entry) => entry.id === selectedEntryId && entry.type === "file",
    )
  ) {
    return selectedEntryId;
  }
  return initialMemoryWorkspaceFileId(entries);
}

export type MemoryCreationTarget = {
  parentId: string | null;
  disabled: boolean;
};

/** Resolves toolbar creation to a physical directory or ordinary file parent. */
export function memoryCreationTarget(
  node: MemoryWorkspaceTreeNode | null,
): MemoryCreationTarget {
  if (!node) return { parentId: null, disabled: false };
  // A pre-existing reserved `animas` entry cannot gain children.
  if ("entry" in node && isReservedUserMemoryEntry(node.entry)) {
    return { parentId: null, disabled: true };
  }
  if (node.kind === "directory") {
    return { parentId: node.entry.id, disabled: false };
  }
  // Anima files live in their own scopes; their folders hold nothing else.
  if (node.kind === "file" && !node.entry.anima_id) {
    return { parentId: node.entry.parent_id ?? null, disabled: false };
  }
  return { parentId: null, disabled: true };
}
