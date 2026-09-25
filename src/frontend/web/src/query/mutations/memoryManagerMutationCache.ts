import type { QueryClient } from "@tanstack/react-query";

import type {
  PyMemoryManagerApproval,
  PyMemoryManagerRunResponse,
} from "@/lib/content/catalogTypes";
import { animaIdForManagerPath } from "@/lib/memory-entries/anima-folders";
import { invalidateAnimaDefinition } from "@/query/animaDefinitionInvalidation";
import { queryKeys } from "@/query/keys";

/** Publishes one authoritative manager snapshot to its ID and current-run caches. */
export function publishMemoryManagerSnapshot(
  queryClient: QueryClient,
  userKey: string,
  snapshot: PyMemoryManagerRunResponse,
) {
  queryClient.setQueryData(
    queryKeys.memoryManager.run(userKey, snapshot.run.id),
    snapshot,
  );
  queryClient.setQueryData(
    queryKeys.memoryManager.current(userKey),
    snapshot.run.status === "active" ||
      snapshot.run.status === "waiting_approval"
      ? snapshot
      : null,
  );
}

/** Replaces one authoritative approval in both manager snapshot caches. */
export function publishMemoryManagerApproval(
  queryClient: QueryClient,
  userKey: string,
  approval: PyMemoryManagerApproval,
) {
  const update = (current: PyMemoryManagerRunResponse | null | undefined) => {
    if (!current || current.run.id !== approval.run_id) return current;
    return {
      ...current,
      approvals: (current.approvals ?? []).map((item) =>
        item.id === approval.id ? approval : item,
      ),
    };
  };
  queryClient.setQueryData(
    queryKeys.memoryManager.run(userKey, approval.run_id),
    update,
  );
  queryClient.setQueryData(queryKeys.memoryManager.current(userKey), update);
}

/**
 * Approved identity changes advance their Anima's definition revision, so
 * refresh each affected Anima's definition views and identity caches.
 */
export async function invalidateApprovedIdentityDefinitions(
  queryClient: QueryClient,
  userKey: string,
  approvals: PyMemoryManagerApproval[],
) {
  const animaIds = new Set(
    approvals.flatMap((approval) => {
      const animaId =
        approval.status === "approved"
          ? animaIdForManagerPath(approval.preview.path)
          : null;
      return animaId ? [animaId] : [];
    }),
  );
  await Promise.all(
    [...animaIds].map((animaId) =>
      invalidateAnimaDefinition(queryClient, userKey, animaId),
    ),
  );
}
