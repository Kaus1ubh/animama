import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MODEL_ASSET_LEASE_RENEW_MS,
  holdModelAssetLease,
  type ModelAssetLeaseApi,
} from "./lease";

function api() {
  return {
    acquire: vi.fn<ModelAssetLeaseApi["acquire"]>(async () => undefined),
    release: vi.fn<ModelAssetLeaseApi["release"]>(async () => undefined),
  };
}

describe("model asset use leases", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("acquires before resolving, renews every 10 s with the same id and releases once", async () => {
    const calls = api();
    const lease = await holdModelAssetLease("parakeet-stt", { api: calls });
    expect(calls.acquire).toHaveBeenCalledTimes(1);
    const [assetId, leaseId] = calls.acquire.mock.calls[0];
    expect(assetId).toBe("parakeet-stt");
    // The backend accepts 8–128 URL-safe characters.
    expect(leaseId).toMatch(/^[A-Za-z0-9_-]{8,128}$/u);

    await vi.advanceTimersByTimeAsync(MODEL_ASSET_LEASE_RENEW_MS * 3);
    expect(calls.acquire).toHaveBeenCalledTimes(4);
    expect(new Set(calls.acquire.mock.calls.map((call) => call[1]))).toEqual(
      new Set([leaseId]),
    );

    await expect(lease.release()).resolves.toBeUndefined();
    await lease.release();
    await vi.advanceTimersByTimeAsync(MODEL_ASSET_LEASE_RENEW_MS * 3);
    expect(calls.acquire).toHaveBeenCalledTimes(4);
    expect(calls.release).toHaveBeenCalledTimes(1);
    expect(calls.release).toHaveBeenCalledWith("parakeet-stt", leaseId);
  });

  it("waits for an in-flight renewal before releasing, so it cannot re-create the lease", async () => {
    const calls = api();
    const lease = await holdModelAssetLease("parakeet-stt", { api: calls });
    let finishRenewal: () => void = () => {};
    calls.acquire.mockImplementationOnce(
      () =>
        new Promise<undefined>(
          (resolve) => (finishRenewal = () => resolve(undefined)),
        ),
    );
    await vi.advanceTimersByTimeAsync(MODEL_ASSET_LEASE_RENEW_MS);
    expect(calls.acquire).toHaveBeenCalledTimes(2);

    const released = lease.release();
    await Promise.resolve();
    expect(calls.release).not.toHaveBeenCalled();
    finishRenewal();
    await released;
    expect(calls.release).toHaveBeenCalledTimes(1);
  });

  it("uses a new id for each hold", async () => {
    const calls = api();
    (await holdModelAssetLease("parakeet-stt", { api: calls })).release();
    (await holdModelAssetLease("parakeet-stt", { api: calls })).release();
    const ids = calls.acquire.mock.calls.map((call) => call[1]);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("never throws when the backend is unreachable, and keeps renewing", async () => {
    const calls = api();
    calls.acquire.mockRejectedValue(new Error("offline"));
    calls.release.mockRejectedValue(new Error("offline"));
    const lease = await holdModelAssetLease("parakeet-stt-webgpu", {
      api: calls,
    });
    await vi.advanceTimersByTimeAsync(MODEL_ASSET_LEASE_RENEW_MS);
    // A later renewal can succeed once the backend recovers.
    expect(calls.acquire).toHaveBeenCalledTimes(2);
    await expect(lease.release()).resolves.toBeUndefined();
    expect(calls.release).toHaveBeenCalledTimes(1);
  });

  it.each(["model_asset_not_installed", "model_asset_not_found"])(
    "stops renewing after a %s refusal",
    async (code) => {
      const calls = api();
      calls.acquire.mockRejectedValue({ detail: { code } });
      const lease = await holdModelAssetLease("parakeet-stt", { api: calls });
      await vi.advanceTimersByTimeAsync(MODEL_ASSET_LEASE_RENEW_MS * 3);
      expect(calls.acquire).toHaveBeenCalledTimes(1);
      await lease.release();
      // Nothing is held, so there is nothing to release.
      expect(calls.release).not.toHaveBeenCalled();
    },
  );

  it("stops renewing when a held set is removed", async () => {
    const calls = api();
    const lease = await holdModelAssetLease("parakeet-stt", { api: calls });
    calls.acquire.mockRejectedValue({
      detail: { code: "model_asset_not_installed" },
    });
    await vi.advanceTimersByTimeAsync(MODEL_ASSET_LEASE_RENEW_MS * 3);
    expect(calls.acquire).toHaveBeenCalledTimes(2);
    await lease.release();
  });
});
