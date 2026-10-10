import type { Client } from "@animama/runtime-contracts/sdk";
import type { QueryClient } from "@tanstack/react-query";
import { getI18n } from "react-i18next";
import type { PyModelAssetState } from "@animama/runtime-contracts/api-types";
import { listModelAssetsV1ModelAssetsGet } from "@animama/runtime-contracts/sdk";
import type { FeaturePackStatus } from "../../../shared/desktop-runtime";
import type { AnimamaDesktopBridge } from "@/platform/runtime-platform";
import { POCKET_VOICES } from "@/lib/speech/pocket/voice-catalog";
import {
  PARAKEET_ASSET_ID,
  PARAKEET_WEBGPU_ASSET_ID,
} from "@/lib/speech/client-parakeet/assets";
import { WordedError } from "@/lib/errors/apiError";
import { queryKeys } from "@/query/keys";

// Feature pack changes restart the backend, so they never overlap a model
// download in either direction.
export const ASSET_WORK_BLOCKS_PACK = "asset_work_blocks_pack";
export const PACK_WORK_BLOCKS_ASSET = "pack_work_blocks_asset";
export type DownloadGuardReason =
  | typeof ASSET_WORK_BLOCKS_PACK
  | typeof PACK_WORK_BLOCKS_ASSET;

/** Wording for why a download or a feature pack change must wait. */
export function downloadGuardText(reason: DownloadGuardReason): string {
  const t = getI18n().getFixedT(null, "app");
  return reason === ASSET_WORK_BLOCKS_PACK
    ? t("featurePacks.guards.downloadRunning")
    : t("featurePacks.guards.packChangeRunning");
}

/** A guard refusal, worded when thrown; `reason` stays stable for comparisons. */
export class DownloadGuardError extends WordedError {
  readonly reason: DownloadGuardReason;

  constructor(reason: DownloadGuardReason) {
    super(downloadGuardText(reason));
    this.name = "DownloadGuardError";
    this.reason = reason;
  }
}
export const modelAssetActionKey = (owner: string) =>
  [...queryKeys.modelAssets(owner), "change"] as const;
export const nativePackActionKey = (owner: string) =>
  [...queryKeys.desktopFeaturePacks(owner), "change"] as const;
export const assetAttemptKey = (owner: string) =>
  [...queryKeys.modelAssets(owner), "attempts"] as const;
export const assetAttemptStorageKey = (owner: string) =>
  `animama:model-download-attempts:${owner}`;

export function packIsBusy(pack: FeaturePackStatus): boolean {
  return (
    pack.state === "downloading" ||
    pack.state === "verifying" ||
    pack.state === "installing"
  );
}
export type NativePackSnapshot = {
  available: boolean;
  packs: FeaturePackStatus[];
  transitioning: boolean;
};
/** Companion windows cannot call pack IPC; their racing requests reconcile after restart. */
export async function loadNativePackSnapshot(
  desktop: AnimamaDesktopBridge | null,
  signal?: AbortSignal,
): Promise<NativePackSnapshot> {
  if (
    !desktop?.featurePacks ||
    !desktop.runtime ||
    desktop.windowRole !== "main"
  )
    return { available: false, packs: [], transitioning: false };
  const status = await desktop.runtime.status();
  signal?.throwIfAborted();
  if (status.state === "external")
    return { available: false, packs: [], transitioning: false };
  const packs = await desktop.featurePacks.list();
  signal?.throwIfAborted();
  return { available: true, packs, transitioning: status.state !== "ready" };
}
export async function loadModelAssets(
  apiClient: Client,
  client: QueryClient,
  owner: string,
  signal?: AbortSignal,
) {
  const { data } = await listModelAssetsV1ModelAssetsGet({
    client: apiClient,
    signal,
    throwOnError: true,
  });
  signal?.throwIfAborted();
  reconcileAssetAttempts(client, owner, data.assets);
  return data;
}

/** Existing mutation cache closes same-renderer request gaps while managers own ongoing work. */
export async function assertAssetInstallAllowed(
  client: QueryClient,
  owner: string,
  desktop: AnimamaDesktopBridge | null,
): Promise<void> {
  if (client.isMutating({ mutationKey: nativePackActionKey(owner) }))
    throw new DownloadGuardError(PACK_WORK_BLOCKS_ASSET);
  const snapshot = await loadNativePackSnapshot(desktop);
  client.setQueryData(queryKeys.desktopFeaturePacks(owner), snapshot);
  if (
    snapshot.transitioning ||
    snapshot.packs.some(packIsBusy) ||
    client.isMutating({ mutationKey: nativePackActionKey(owner) })
  )
    throw new DownloadGuardError(PACK_WORK_BLOCKS_ASSET);
}
export async function assertPackTransitionAllowed(
  apiClient: Client,
  client: QueryClient,
  owner: string,
  desktop: AnimamaDesktopBridge | null,
): Promise<void> {
  if (client.isMutating({ mutationKey: modelAssetActionKey(owner) }))
    throw new DownloadGuardError(ASSET_WORK_BLOCKS_PACK);
  // The calling native mutation counts as one; a second native request must not queue a later transition.
  if (client.isMutating({ mutationKey: nativePackActionKey(owner) }) > 1)
    throw new DownloadGuardError(PACK_WORK_BLOCKS_ASSET);
  const snapshot = await loadNativePackSnapshot(desktop);
  client.setQueryData(queryKeys.desktopFeaturePacks(owner), snapshot);
  if (!snapshot.available)
    throw new Error("Feature packs are unavailable in this window.");
  if (snapshot.transitioning || snapshot.packs.some(packIsBusy))
    throw new DownloadGuardError(PACK_WORK_BLOCKS_ASSET);
  const assets = await loadModelAssets(apiClient, client, owner);
  client.setQueryData(queryKeys.modelAssets(owner), assets);
  if (
    assets.assets.some((asset) => asset.status === "downloading") ||
    client.isMutating({ mutationKey: modelAssetActionKey(owner) })
  )
    throw new DownloadGuardError(ASSET_WORK_BLOCKS_PACK);
}

const knownAssetIds = new Set([
  ...POCKET_VOICES.flatMap((voice) => (voice.assetId ? [voice.assetId] : [])),
  "pocket-tts-voice-cloning-encoder",
  PARAKEET_ASSET_ID,
  PARAKEET_WEBGPU_ASSET_ID,
]);
/** A bounded hint for Retry, never installed state, progress, samples or credentials. */
function storedAssetAttempts(owner: string): string[] | undefined {
  try {
    const raw = window.localStorage.getItem(assetAttemptStorageKey(owner));
    if (!raw || raw.length > 8192) return [];
    const value = JSON.parse(raw) as {
      ids?: unknown;
      revision?: unknown;
    } | null;
    if (
      !value ||
      typeof value.revision !== "string" ||
      !/^[a-f0-9-]{36}$/u.test(value.revision)
    )
      return [];
    return Array.isArray(value.ids)
      ? [
          ...new Set(
            value.ids.filter(
              (id): id is string =>
                typeof id === "string" && knownAssetIds.has(id),
            ),
          ),
        ]
      : [];
  } catch {
    return undefined;
  }
}
export function readAssetAttempts(owner: string): string[] {
  return storedAssetAttempts(owner) ?? [];
}
function saveAssetAttempts(
  client: QueryClient,
  owner: string,
  attempts: string[],
) {
  client.setQueryData(assetAttemptKey(owner), attempts);
  try {
    // A new revision wakes other windows even when the ID set is unchanged
    // (including an empty set after removal). It carries no manager state.
    window.localStorage.setItem(
      assetAttemptStorageKey(owner),
      JSON.stringify({ ids: attempts, revision: crypto.randomUUID() }),
    );
  } catch {
    /* Storage may be unavailable; manager state still controls all actions. */
  }
}
/** Notify sibling windows after a request settles, including a held or failed POST. */
export function pulseAssetAttempts(client: QueryClient, owner: string): void {
  const current =
    storedAssetAttempts(owner) ??
    client.getQueryData<string[]>(assetAttemptKey(owner)) ??
    [];
  saveAssetAttempts(client, owner, current);
}
export function recordAssetAttempt(
  client: QueryClient,
  owner: string,
  id: string,
  attempted: boolean,
): void {
  if (!knownAssetIds.has(id)) return;
  const current =
    storedAssetAttempts(owner) ??
    client.getQueryData<string[]>(assetAttemptKey(owner)) ??
    [];
  saveAssetAttempts(
    client,
    owner,
    attempted
      ? [...new Set([...current, id])]
      : current.filter((item) => item !== id),
  );
}
export function reconcileAssetAttempts(
  client: QueryClient,
  owner: string,
  assets: PyModelAssetState[],
): void {
  const current =
    storedAssetAttempts(owner) ??
    client.getQueryData<string[]>(assetAttemptKey(owner)) ??
    [];
  const installed = new Set(
    assets
      .filter((asset) => asset.status === "installed")
      .map((asset) => asset.id),
  );
  if (current.some((id) => installed.has(id)))
    saveAssetAttempts(
      client,
      owner,
      current.filter((id) => !installed.has(id)),
    );
}
/**
 * The installed Parakeet sets, as a stable key. Runtime capabilities derive
 * offline speech from them, so a change means capabilities are stale.
 */
export function installedSpeechSets(
  assets: PyModelAssetState[] | undefined,
): string | undefined {
  if (!assets) return undefined;
  return [PARAKEET_ASSET_ID, PARAKEET_WEBGPU_ASSET_ID]
    .filter((id) =>
      assets.some((asset) => asset.id === id && asset.status === "installed"),
    )
    .join(",");
}
export function retryAssetIds(
  attempts: readonly string[],
  assets: PyModelAssetState[] | undefined,
): ReadonlySet<string> {
  return new Set(
    (assets ?? [])
      .filter(
        (asset) =>
          attempts.includes(asset.id) &&
          (asset.status === "not_installed" || asset.status === "failed"),
      )
      .map((asset) => asset.id),
  );
}
