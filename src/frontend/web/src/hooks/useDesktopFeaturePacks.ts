import { useCallback, useEffect } from "react";
import {
  useIsMutating,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import type {
  FeaturePackId,
  FeaturePackStatus,
} from "../../../shared/desktop-runtime";
import { useRuntimePlatform } from "@/platform/RuntimePlatformProvider";
import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
import { useModelAssets } from "@/query/hooks/useModelAssets";
import { queryKeys } from "@/query/keys";
import {
  ASSET_WORK_BLOCKS_PACK,
  PACK_WORK_BLOCKS_ASSET,
  assertPackTransitionAllowed,
  loadNativePackSnapshot,
  modelAssetActionKey,
  nativePackActionKey,
  packIsBusy,
  type NativePackSnapshot,
} from "@/query/model-download-coordination";

const EMPTY_PACKS: FeaturePackStatus[] = [];
type PackAction = {
  operation: "install" | "remove" | "cancel";
  id: FeaturePackId;
};
const FAILURE =
  "The pack change could not finish. Review its status below, then retry.";

/** One owner-scoped manager snapshot survives view navigation; native IPC remains main-only. */
export function useDesktopFeaturePacks() {
  const platform = useRuntimePlatform();
  const desktop = platform.kind === "desktop" ? platform.desktopBridge : null;
  const ownerId = useRuntimeOwnerId();
  const owner = ownerId ?? "__anon__";
  const client = useQueryClient();
  const key = queryKeys.desktopFeaturePacks(owner);
  const enabled = Boolean(
    ownerId &&
    desktop?.featurePacks &&
    desktop.runtime &&
    desktop.windowRole === "main",
  );
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => loadNativePackSnapshot(desktop, signal),
    enabled,
    refetchOnMount: "always",
  });
  const available = enabled && Boolean(query.data?.available);
  const assets = useModelAssets({ enabled: available });
  const assetRequests = useIsMutating({
    mutationKey: modelAssetActionKey(owner),
  });
  const requests = useMutationState({
    filters: { mutationKey: nativePackActionKey(owner), status: "pending" },
    select: (mutation) => mutation.state.variables as PackAction,
  });

  useEffect(() => {
    if (!enabled || !desktop?.featurePacks || !desktop.runtime) return;
    const progress = desktop.featurePacks.onProgress((status) => {
      // An older list reply must not overwrite newer native progress.
      void client.cancelQueries({
        queryKey: queryKeys.desktopFeaturePacks(owner),
        exact: true,
      });
      client.setQueryData<NativePackSnapshot>(
        queryKeys.desktopFeaturePacks(owner),
        (current) => ({
          available: true,
          transitioning: current?.transitioning ?? false,
          packs: [
            ...(current?.packs ?? []).filter((pack) => pack.id !== status.id),
            status,
          ],
        }),
      );
    });
    const runtime = desktop.runtime.onStatus((status) => {
      client.setQueryData<NativePackSnapshot>(
        queryKeys.desktopFeaturePacks(owner),
        (current) =>
          current
            ? {
                ...current,
                available: status.state !== "external",
                transitioning:
                  status.state !== "ready" && status.state !== "external",
              }
            : current,
      );
      if (status.state === "ready") {
        void client.invalidateQueries({
          queryKey: queryKeys.desktopFeaturePacks(owner),
          exact: true,
        });
        void client.invalidateQueries({
          queryKey: queryKeys.modelAssets(owner),
          exact: true,
        });
      }
    });
    return () => {
      progress();
      runtime();
    };
  }, [client, desktop, enabled, owner]);

  const action = useMutation<void, Error, PackAction>({
    mutationKey: nativePackActionKey(owner),
    mutationFn: async ({ operation, id }) => {
      if (!ownerId || !available || !desktop?.featurePacks)
        throw new Error(FAILURE);
      try {
        if (operation !== "cancel")
          await assertPackTransitionAllowed(client, owner, desktop);
        await desktop.featurePacks[operation](id);
      } catch (cause) {
        // Native exception text can contain paths; expose only our own bounded guard messages.
        const message = cause instanceof Error ? cause.message : "";
        throw new Error(
          [ASSET_WORK_BLOCKS_PACK, PACK_WORK_BLOCKS_ASSET].includes(message)
            ? message
            : FAILURE,
        );
      }
    },
    onSettled: () => {
      void client.invalidateQueries({
        queryKey: queryKeys.desktopFeaturePacks(owner),
        exact: true,
      });
      void client.invalidateQueries({
        queryKey: queryKeys.modelAssets(owner),
        exact: true,
      });
    },
  });
  const mutate = action.mutateAsync;
  const run = useCallback(
    async (operation: PackAction["operation"], id: FeaturePackId) => {
      try {
        await mutate({ operation, id });
      } catch {
        /* The initiating control reads the bounded mutation error. */
      }
    },
    [mutate],
  );
  const packs = query.data?.packs ?? EMPTY_PACKS;
  const active = packs.find(packIsBusy);
  const pending =
    requests.find((request) => request.operation !== "cancel")?.id ??
    active?.id ??
    null;
  const busy =
    (enabled && query.isPending) ||
    requests.length > 0 ||
    Boolean(active) ||
    Boolean(query.data?.transitioning);
  const blockedReason =
    assetRequests > 0 ||
    assets.data?.assets.some((asset) => asset.status === "downloading")
      ? ASSET_WORK_BLOCKS_PACK
      : null;
  return {
    available,
    packs,
    pending,
    busy,
    blockedReason,
    run,
    error:
      action.error?.message ??
      (query.error
        ? "Feature packs are unavailable. Check runtime recovery and retry."
        : null),
  };
}
