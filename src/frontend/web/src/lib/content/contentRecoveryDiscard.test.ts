import { afterEach, describe, expect, it, vi } from "vitest";

import { avatarEffectRecoveryStore } from "@/lib/avatar/vfx/editor/recovery";
import { sceneEffectRecoveryStore } from "@/lib/scene-vfx/editor/recovery";
import { particleVFXRecoveryStore } from "./particleVFXRecovery";

afterEach(() => vi.unstubAllGlobals());

/** Fake only the browser storage boundary so request success and commit can differ. */
function indexedDbDelete() {
  const operation = {
    result: undefined,
    onsuccess: null as (() => void) | null,
    onerror: null as (() => void) | null,
  };
  const remove = vi.fn(() => operation);
  const transaction = {
    objectStore: vi.fn(() => ({ delete: remove })),
    oncomplete: null as (() => void) | null,
    onabort: null as (() => void) | null,
    error: new Error("transaction aborted"),
  };
  const database = {
    transaction: vi.fn(() => transaction),
    close: vi.fn(),
  };
  const opening = {
    result: database,
    onsuccess: null as (() => void) | null,
  };
  vi.stubGlobal("window", {
    indexedDB: { open: () => opening },
    localStorage: { removeItem: vi.fn() },
  });
  return { opening, operation, transaction, database, remove };
}

describe.each([
  [
    "Avatar",
    avatarEffectRecoveryStore.clear,
    "anima.avatarEffectCreator.recovery.v1:",
  ],
  [
    "Scene",
    sceneEffectRecoveryStore.clear,
    "anima.sceneEffectCreator.recovery.v1:",
  ],
  [
    "Particle",
    particleVFXRecoveryStore.clear,
    "anima.particleVfxCreator.recovery.v1:",
  ],
] as const)("%s Effect explicit discard", (_name, clear, prefix) => {
  it("clears only this key when IndexedDB is absent", async () => {
    const values = new Map([
      [`${prefix}owner:item`, "discarded"],
      [`${prefix}owner:other`, "keep"],
    ]);
    vi.stubGlobal("window", {
      localStorage: { removeItem: (key: string) => values.delete(key) },
    });
    await clear("owner", "item", { strict: true });
    expect([...values.entries()]).toEqual([[`${prefix}owner:other`, "keep"]]);
  });

  it("reports fallback storage deletion failure and permits a later retry", async () => {
    const removeItem = vi.fn().mockImplementationOnce(() => {
      throw new Error("storage denied");
    });
    vi.stubGlobal("window", { localStorage: { removeItem } });
    await expect(clear("owner", "item", { strict: true })).rejects.toThrow();
    await expect(
      clear("owner", "item", { strict: true }),
    ).resolves.toBeUndefined();
  });

  it("reports inaccessible IndexedDB rather than claiming successful discard", async () => {
    vi.stubGlobal("window", {
      localStorage: { removeItem: vi.fn() },
      indexedDB: {
        open: () => {
          throw new Error("database blocked");
        },
      },
    });
    await expect(clear("owner", "item", { strict: true })).rejects.toThrow();
    // Existing best-effort save cleanup keeps its established behavior.
    await expect(clear("owner", "item")).resolves.toBeUndefined();
  });

  it("waits for deletion commit, not just a successful IDB delete request", async () => {
    const browser = indexedDbDelete();
    let completed = false;
    const discarded = clear("owner", "item", { strict: true }).then(() => {
      completed = true;
    });
    browser.opening.onsuccess?.();
    await Promise.resolve();
    browser.operation.onsuccess?.();
    // Let all request-success promise chains settle before the transaction commits.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(completed).toBe(false);
    expect(browser.remove).toHaveBeenCalledWith("owner:item");
    browser.transaction.oncomplete?.();
    await discarded;
    expect(completed).toBe(true);
    expect(browser.database.close).toHaveBeenCalledOnce();
  });

  it("propagates transaction abort after the delete request succeeded", async () => {
    const browser = indexedDbDelete();
    const discarded = clear("owner", "item", { strict: true });
    browser.opening.onsuccess?.();
    await Promise.resolve();
    browser.operation.onsuccess?.();
    await Promise.resolve();
    browser.transaction.onabort?.();
    await expect(discarded).rejects.toThrow();
    expect(browser.database.close).toHaveBeenCalledOnce();
  });
});
