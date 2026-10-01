import { QueryClient, MutationObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PyModelAssetState } from "@animama/runtime-contracts/api-types";
import type { AnimamaDesktopBridge } from "@/platform/runtime-platform";
import { queryKeys } from "@/query/keys";
import {
  assertAssetInstallAllowed,
  assetAttemptStorageKey,
  pulseAssetAttempts,
  assertPackTransitionAllowed,
  modelAssetActionKey,
  nativePackActionKey,
  readAssetAttempts,
  recordAssetAttempt,
  reconcileAssetAttempts,
  retryAssetIds,
} from "./model-download-coordination";

const api = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@animama/runtime-contracts/sdk", () => ({
  listModelAssetsV1ModelAssetsGet: api.list,
}));
const owner = "owner-1";
const id = "pocket-tts-voice-cloning-encoder";
const missing: PyModelAssetState = {
  id,
  status: "not_installed",
  size_bytes: 10,
  required_free_bytes: 10,
  media_type: "application/octet-stream",
  license_ref: "CC-BY-4.0",
  files_total: 1,
  files_verified: 0,
};
let client: QueryClient;
let storage: Map<string, string>;
function desktop(state = "not_installed") {
  return {
    windowRole: "main",
    runtime: { status: vi.fn(async () => ({ state: "ready" })) },
    featurePacks: {
      list: vi.fn(async () => [{ id: "parakeet-stt", state, available: true }]),
    },
  } as unknown as AnimamaDesktopBridge;
}
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  storage = new Map();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });
  api.list.mockResolvedValue({ data: { assets: [missing], free_bytes: 100 } });
});
afterEach(() => {
  client.clear();
  vi.unstubAllGlobals();
});

describe("cross-manager download admission", () => {
  it("checks fresh native state before backend installs after reload", async () => {
    await expect(
      assertAssetInstallAllowed(client, owner, desktop("installing")),
    ).rejects.toThrow("speech download");
    await expect(
      assertAssetInstallAllowed(client, owner, desktop()),
    ).resolves.toBeUndefined();
  });
  it("checks fresh backend state before a native transition", async () => {
    api.list.mockResolvedValue({
      data: {
        assets: [{ ...missing, status: "downloading" }],
        free_bytes: 100,
      },
    });
    await expect(
      assertPackTransitionAllowed(client, owner, desktop()),
    ).rejects.toThrow("voice download");
    expect(client.getQueryData(queryKeys.modelAssets(owner))).toMatchObject({
      assets: [{ status: "downloading" }],
    });
  });
  it("closes the request gap across separate mutation consumers", async () => {
    let finish!: () => void;
    const pending = new MutationObserver(client, {
      mutationKey: modelAssetActionKey(owner),
      mutationFn: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    }).mutate();
    await Promise.resolve();
    await expect(
      assertPackTransitionAllowed(client, owner, desktop()),
    ).rejects.toThrow("voice download");
    finish();
    await pending;
    const native = new MutationObserver(client, {
      mutationKey: nativePackActionKey(owner),
      mutationFn: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    }).mutate();
    await Promise.resolve();
    await expect(
      assertAssetInstallAllowed(client, owner, desktop()),
    ).rejects.toThrow("speech download");
    finish();
    await native;
  });
  it("leaves ordinary web installs independent of native IPC", async () => {
    await expect(
      assertAssetInstallAllowed(client, owner, null),
    ).resolves.toBeUndefined();
  });
});

describe("attempt recovery hints", () => {
  it("retains only known IDs across renderer replacement and reconciles installed state", () => {
    recordAssetAttempt(client, owner, id, true);
    recordAssetAttempt(client, owner, "secret-or-unknown-id", true);
    const replacement = new QueryClient();
    expect(readAssetAttempts(owner)).toEqual([id]);
    expect(retryAssetIds(readAssetAttempts(owner), [missing])).toEqual(
      new Set([id]),
    );
    expect(
      retryAssetIds(readAssetAttempts(owner), [
        { ...missing, status: "downloading" },
      ]),
    ).toEqual(new Set());
    reconcileAssetAttempts(replacement, owner, [
      { ...missing, status: "installed" },
    ]);
    expect(readAssetAttempts(owner)).toEqual([]);
    replacement.clear();
  });
  it("clears explicit cancellation/removal without touching another owner", () => {
    recordAssetAttempt(client, owner, id, true);
    recordAssetAttempt(client, "owner-2", id, true);
    recordAssetAttempt(client, owner, id, false);
    expect(readAssetAttempts(owner)).toEqual([]);
    expect(readAssetAttempts("owner-2")).toEqual([id]);
  });
  it("does not turn missing storage into a download failure", () => {
    vi.stubGlobal("window", {
      get localStorage() {
        throw new Error("denied");
      },
    });
    expect(() => recordAssetAttempt(client, owner, id, true)).not.toThrow();
    expect(readAssetAttempts(owner)).toEqual([]);
  });
});

it("stores only known IDs and an event revision, pulsing unchanged and empty sets", () => {
  recordAssetAttempt(client, owner, id, true);
  const key = assetAttemptStorageKey(owner);
  const first = JSON.parse(storage.get(key)!);
  expect(Object.keys(first).sort()).toEqual(["ids", "revision"]);
  expect(first.ids).toEqual([id]);
  pulseAssetAttempts(client, owner);
  const settled = JSON.parse(storage.get(key)!);
  expect(settled.ids).toEqual([id]);
  expect(settled.revision).not.toBe(first.revision);
  recordAssetAttempt(client, owner, id, false);
  const removed = JSON.parse(storage.get(key)!);
  expect(removed.ids).toEqual([]);
  pulseAssetAttempts(client, owner);
  expect(JSON.parse(storage.get(key)!).revision).not.toBe(removed.revision);
  storage.set(
    key,
    JSON.stringify({
      ids: [id, id, "unknown", 7],
      revision: first.revision,
      secret: "ignored",
    }),
  );
  expect(readAssetAttempts(owner)).toEqual([id]);
});
