import type { Client } from "@animama/runtime-contracts/sdk";
import {
  leaseModelAssetV1ModelAssetsAssetIdLeasePost,
  releaseModelAssetLeaseV1ModelAssetsAssetIdLeasesLeaseIdDelete,
} from "@animama/runtime-contracts/sdk";

import { createLogger } from "@/lib/logger";

const logger = createLogger("ModelAssetLease");

/** Renewal interval; the backend expires a lease 30 s after its last renewal. */
export const MODEL_ASSET_LEASE_RENEW_MS = 10_000;

export type ModelAssetLeaseApi = {
  acquire(assetId: string, leaseId: string): Promise<unknown>;
  release(assetId: string, leaseId: string): Promise<unknown>;
};

export function createModelAssetLeaseApi(client: Client): ModelAssetLeaseApi {
  return {
    acquire: (assetId, leaseId) =>
      leaseModelAssetV1ModelAssetsAssetIdLeasePost({
        client,
        path: { asset_id: assetId },
        body: { lease_id: leaseId },
        throwOnError: true,
      }),
    release: (assetId, leaseId) =>
      releaseModelAssetLeaseV1ModelAssetsAssetIdLeasesLeaseIdDelete({
        client,
        path: { asset_id: assetId, lease_id: leaseId },
        throwOnError: true,
      }),
  };
}

export type ModelAssetLease = {
  readonly assetId: string;
  /**
   * Stop renewing and release the lease. Resolves once the backend answered
   * (or the request failed); never rejects. Later calls resolve at once.
   */
  release(): Promise<void>;
};

/** Refusals that renewing cannot fix: the set is gone. */
const FINAL_REFUSALS = new Set([
  "model_asset_not_installed",
  "model_asset_not_found",
]);

/**
 * Hold a use lease on an installed model asset, so the backend refuses to
 * remove it while this page has it loaded. Resolves once the first acquire
 * settles, so the set is leased before its files load.
 *
 * Lease failures are logged, never thrown: an unleased model keeps working
 * and is only removable. Renewal continues after transient failures, so the
 * lease recovers once the backend accepts it again, but stops for good once
 * the set is no longer installed.
 */
export async function holdModelAssetLease(
  assetId: string,
  {
    api,
    renewMs = MODEL_ASSET_LEASE_RENEW_MS,
  }: { api: ModelAssetLeaseApi; renewMs?: number },
): Promise<ModelAssetLease> {
  const leaseId = crypto.randomUUID();
  let timer: ReturnType<typeof setInterval> | null = null;
  const stop = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  // Set once the backend reports the set gone: nothing remains to protect.
  let gone = false;
  // The latest renewal; it never rejects. Release waits for it so a renewal
  // that lands after the DELETE cannot re-create the lease.
  let inFlight: Promise<void> = Promise.resolve();
  const renew = () => (inFlight = attemptRenewal());
  const attemptRenewal = async () => {
    try {
      await api.acquire(assetId, leaseId);
    } catch (error) {
      const code = refusalCode(error);
      if (code !== null && FINAL_REFUSALS.has(code)) {
        gone = true;
        stop();
        logger.info("Lease", "Model asset lease ended: set not installed", {
          assetId,
          code,
        });
        return;
      }
      logger.warn("Lease", "Model asset lease was not accepted", {
        assetId,
        code,
      });
    }
  };
  await renew();
  if (!gone) timer = setInterval(() => void renew(), renewMs);
  let released: Promise<void> | null = null;
  return {
    assetId,
    release() {
      if (released) return released;
      stop();
      // A failed acquire may still have reached the backend, so release
      // unless the set is gone.
      released = inFlight.then(() =>
        gone
          ? undefined
          : api.release(assetId, leaseId).then(
              () => undefined,
              (error: unknown) => {
                // The lease expires on its own; nothing else depends on this call.
                logger.warn("Lease", "Model asset lease release failed", {
                  assetId,
                  code: refusalCode(error),
                });
              },
            ),
      );
      return released;
    },
  };
}

/** The API's stable refusal code, never a message that could carry details. */
function refusalCode(error: unknown): string | null {
  const detail =
    error && typeof error === "object" && "detail" in error
      ? (error as { detail?: { code?: unknown } }).detail
      : undefined;
  return typeof detail?.code === "string" ? detail.code : null;
}
