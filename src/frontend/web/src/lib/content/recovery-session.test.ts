import { afterEach, describe, expect, it, vi } from "vitest";
import { actionRecoveryKey } from "./actionRecovery";
import {
  beginHostedRecoverySession,
  endHostedRecoverySession,
  purgeHostedRecoverySessions,
  recoverySessionIsActive,
} from "./recovery-session";
import { assetAttemptStorageKey } from "@/query/model-download-coordination";

describe("hosted recovery retirement", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("purges an old generation across tabs without deleting a replacement generation", async () => {
    const rows = new Map<string, string>();
    const storage = {
      get length() {
        return rows.size;
      },
      key: (index: number) => [...rows.keys()][index] ?? null,
      getItem: (key: string) => rows.get(key) ?? null,
      setItem: (key: string, value: string) => {
        rows.set(key, value);
      },
      removeItem: (key: string) => {
        rows.delete(key);
      },
    };
    vi.stubGlobal("window", { localStorage: storage, sessionStorage: storage });
    const old = "hosted:old-generation-123:first-tab";
    const orphan = "hosted:old-generation-123:closed-tab";
    const current = "hosted:new-generation-456:second-tab";
    beginHostedRecoverySession(old);
    beginHostedRecoverySession(current);
    // An Action editor draft stands in for every per-session recovery record.
    const draft = (key: string) =>
      storage.getItem(actionRecoveryKey(key, "gesture", null));
    for (const key of [old, orphan, current, "installation-owner"])
      storage.setItem(actionRecoveryKey(key, "gesture", null), key);
    // A draft the retired Idle Style editor may have left behind.
    const legacy = `animama:content-edit:${encodeURIComponent(old)}:idle_style:new`;
    storage.setItem(legacy, old);
    await endHostedRecoverySession(old);
    expect(storage.getItem(legacy)).toBeNull();
    expect(draft(old)).toBeNull();
    expect(draft(orphan)).toBeNull();
    expect(draft(current)).toBe(current);
    expect(recoverySessionIsActive(current)).toBe(true);
    await purgeHostedRecoverySessions();
    expect(draft(current)).toBeNull();
    expect(draft("installation-owner")).not.toBeNull();
    expect(recoverySessionIsActive(current)).toBe(false);
  });

  it("removes hosted model download hints with their generation and on sign-out", async () => {
    const rows = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        get length() {
          return rows.size;
        },
        key: (index: number) => [...rows.keys()][index] ?? null,
        getItem: (key: string) => rows.get(key) ?? null,
        removeItem: (key: string) => rows.delete(key),
      },
    });
    const old = "hosted:hint-generation-123:first-tab";
    const orphan = "hosted:hint-generation-123:closed-tab";
    const current = "hosted:next-generation-456:second-tab";
    const local = "installation-owner";
    for (const key of [old, orphan, current, local])
      rows.set(assetAttemptStorageKey(key), '{"ids":[]}');
    beginHostedRecoverySession(old);
    beginHostedRecoverySession(current);
    await endHostedRecoverySession(old);
    expect([...rows.keys()].sort()).toEqual(
      [assetAttemptStorageKey(current), assetAttemptStorageKey(local)].sort(),
    );
    await purgeHostedRecoverySessions();
    expect([...rows.keys()]).toEqual([assetAttemptStorageKey(local)]);
  });

  it("removes an ephemeral lifetime's own hint and import receipt when it ends", async () => {
    const rows = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        get length() {
          return rows.size;
        },
        key: (index: number) => [...rows.keys()][index] ?? null,
        getItem: (key: string) => rows.get(key) ?? null,
        removeItem: (key: string) => rows.delete(key),
      },
    });
    // Without a valid recovery generation, a lifetime has its own namespace.
    const ended = "hosted:ephemeral:0f8fad5b-d9cb-469f-a165-70867728950e";
    const other = "hosted:ephemeral:7c9e6679-7425-40de-944b-e07fc1f90ae7";
    for (const key of [ended, other]) {
      rows.set(assetAttemptStorageKey(key), '{"ids":[]}');
      rows.set(`animama.package-import.v1.${key}`, "receipt");
    }
    beginHostedRecoverySession(ended);
    beginHostedRecoverySession(other);
    await endHostedRecoverySession(ended);
    expect([...rows.keys()].sort()).toEqual(
      [
        assetAttemptStorageKey(other),
        `animama.package-import.v1.${other}`,
      ].sort(),
    );
  });
});
