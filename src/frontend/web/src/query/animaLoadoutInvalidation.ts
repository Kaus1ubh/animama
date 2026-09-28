import type { QueryClient } from "@tanstack/react-query";
import type {
  PyAnimaLoadout,
  PyAnimaRuntime,
} from "@animama/runtime-contracts/api-types";

import { queryKeys } from "@/query/keys";
import { invalidateAnimaDefinition } from "./animaDefinitionInvalidation";

/** Invalidate both mutable Loadout state and its immutable runtime projection. */
export async function invalidateAnimaLoadoutAndRuntime(
  queryClient: QueryClient,
  userId: string,
  animaId: string,
): Promise<void> {
  await Promise.all([
    invalidateAnimaDefinition(queryClient, userId, animaId),
    queryClient.invalidateQueries({
      queryKey: queryKeys.animaLoadouts.runtime(userId, animaId),
    }),
  ]);
}

/** Rename expires cached consumers while leaving already mounted runtime snapshots intact. */
export async function invalidateVoiceCloneConsumers(
  queryClient: QueryClient,
  owner: string,
  itemId: string,
): Promise<void> {
  const affected = new Set<string>();
  for (const [key, loadout] of queryClient.getQueriesData<PyAnimaLoadout>({
    queryKey: queryKeys.animaLoadouts.details(owner),
  })) {
    if (
      loadout?.voice_source?.catalog_item_id === itemId &&
      typeof key[2] === "string"
    ) {
      affected.add(key[2]);
    }
  }
  // A chat can cache runtime without ever opening its Loadout screen.
  for (const [key, runtime] of queryClient.getQueriesData<PyAnimaRuntime>({
    queryKey: queryKeys.animaLoadouts.runtimes(owner),
  })) {
    if (
      runtime?.voice?.source.item_id === itemId &&
      typeof key[2] === "string"
    ) {
      affected.add(key[2]);
    }
  }
  await Promise.all(
    [...affected].map((animaId) =>
      invalidateAnimaLoadoutAndRuntime(queryClient, owner, animaId),
    ),
  );
}
