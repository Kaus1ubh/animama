"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import {
  getMemoryEntryByPathV1MemoryEntriesByPathGet,
  getMemoryEntryV1MemoryEntriesEntryIdGet,
  getMemoryEntryVersionV1MemoryEntriesEntryIdVersionsVersionGet,
  listMemoryEntriesV1MemoryEntriesGet,
  listMemoryEntryVersionsV1MemoryEntriesEntryIdVersionsGet,
} from "@animama/runtime-contracts/sdk";
import type {
  PyMemoryEntryListResponse,
  PyMemoryEntryResponse,
  PyMemoryEntryVersionDetail,
  PyMemoryEntryVersionListResponse,
} from "@/lib/content/catalogTypes";
import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";

export type UseMemoryEntriesOptions = {
  animaId?: string | null;
  parentId?: string | null;
  recursive?: boolean;
  enabled?: boolean;
};

export function useMemoryEntries(opts?: UseMemoryEntriesOptions) {
  const userId = useRuntimeOwnerId();
  const userKey = userId ?? "__anon__";
  const enabled = (opts?.enabled ?? true) && Boolean(userId);

  return useQuery<PyMemoryEntryListResponse>({
    queryKey: queryKeys.memoryEntries.list(userKey, {
      animaId: opts?.animaId ?? null,
      parentId: opts?.parentId ?? null,
      recursive: opts?.recursive ?? false,
    }),
    enabled,
    queryFn: async () => {
      const { data } = await listMemoryEntriesV1MemoryEntriesGet({
        query: {
          anima_id: opts?.animaId ?? undefined,
          parent_id: opts?.parentId ?? undefined,
          recursive: opts?.recursive ?? false,
        },
        responseValidator: undefined,
        throwOnError: true,
      });
      return data;
    },
  });
}

export type UseMemoryEntryOptions = {
  enabled?: boolean;
};

export function useMemoryEntry(
  entryId: string | null | undefined,
  opts?: UseMemoryEntryOptions,
) {
  const userId = useRuntimeOwnerId();
  const userKey = userId ?? "__anon__";
  const keyId = entryId ?? "__none__";
  const enabled =
    (opts?.enabled ?? true) && Boolean(userId) && Boolean(entryId);

  return useQuery<PyMemoryEntryResponse | null>({
    queryKey: queryKeys.memoryEntries.detail(userKey, keyId),
    enabled,
    queryFn: async () => {
      if (!entryId) return null;
      const { data } = await getMemoryEntryV1MemoryEntriesEntryIdGet({
        path: { entry_id: entryId },
        responseValidator: undefined,
        throwOnError: true,
      });
      return data;
    },
  });
}

export type UseMemoryEntryByPathOptions = {
  animaId?: string | null;
  path: string | null | undefined;
  type?: "file" | "directory";
  enabled?: boolean;
};

export function useMemoryEntryByPath(opts: UseMemoryEntryByPathOptions) {
  const userId = useRuntimeOwnerId();
  const userKey = userId ?? "__anon__";
  const path = opts.path?.trim() ?? "";
  const enabled = (opts.enabled ?? true) && Boolean(userId) && Boolean(path);

  return useQuery<PyMemoryEntryResponse | null>({
    queryKey: queryKeys.memoryEntries.byPath(userKey, {
      animaId: opts.animaId ?? null,
      path: path || "__none__",
      type: opts.type ?? "file",
    }),
    enabled,
    queryFn: async () => {
      if (!path) return null;
      const { data } = await getMemoryEntryByPathV1MemoryEntriesByPathGet({
        query: {
          anima_id: opts.animaId ?? undefined,
          path,
          type: opts.type ?? "file",
        },
        responseValidator: undefined,
        throwOnError: true,
      });
      return data;
    },
  });
}

export type UseMemoryEntryVersionsOptions = {
  enabled?: boolean;
  limit?: number;
};

/** Loads newest-first version pages using the backend version cursor. */
export function useMemoryEntryVersions(
  entryId: string | null | undefined,
  opts?: UseMemoryEntryVersionsOptions,
) {
  const userId = useRuntimeOwnerId();
  const userKey = userId ?? "__anon__";
  const keyId = entryId ?? "__none__";
  const enabled =
    (opts?.enabled ?? true) && Boolean(userId) && Boolean(entryId);

  return useInfiniteQuery<PyMemoryEntryVersionListResponse>({
    queryKey: queryKeys.memoryEntries.versions(userKey, keyId),
    enabled,
    initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam }) => {
      if (!entryId) {
        return { entry_id: keyId, versions: [] };
      }
      const { data } =
        await listMemoryEntryVersionsV1MemoryEntriesEntryIdVersionsGet({
          path: { entry_id: entryId },
          query: {
            before_version: pageParam as number | undefined,
            limit: opts?.limit ?? 50,
          },
          responseValidator: undefined,
          throwOnError: true,
        });
      return data;
    },
    getNextPageParam: (lastPage) => lastPage.next_before_version ?? undefined,
  });
}

export type UseMemoryEntryVersionOptions = {
  enabled?: boolean;
};

/** Loads the immutable Version N snapshot and its Version N-1 diff. */
export function useMemoryEntryVersion(
  entryId: string | null | undefined,
  version: number | null | undefined,
  opts?: UseMemoryEntryVersionOptions,
) {
  const userId = useRuntimeOwnerId();
  const userKey = userId ?? "__anon__";
  const keyId = entryId ?? "__none__";
  const keyVersion = version ?? 0;
  const enabled =
    (opts?.enabled ?? true) &&
    Boolean(userId) &&
    Boolean(entryId) &&
    keyVersion >= 1;

  return useQuery<PyMemoryEntryVersionDetail | null>({
    queryKey: queryKeys.memoryEntries.versionDetail(userKey, keyId, keyVersion),
    enabled,
    queryFn: async () => {
      if (!entryId || keyVersion < 1) return null;
      const { data } =
        await getMemoryEntryVersionV1MemoryEntriesEntryIdVersionsVersionGet({
          path: { entry_id: entryId, version: keyVersion },
          responseValidator: undefined,
          throwOnError: true,
        });
      return data;
    },
  });
}
