import { afterEach, describe, expect, it, vi } from "vitest";
import {
  saveContentEditRecovery,
  loadContentEditRecovery,
  CONTENT_EDIT_RECOVERY_SCHEMA,
} from "./contentEditRecovery";
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
    for (const key of [old, orphan, current, "installation-owner"]) {
      saveContentEditRecovery({
        schema: CONTENT_EDIT_RECOVERY_SCHEMA,
        userId: key,
        family: "pose",
        documentKey: "new",
        operationId: key,
        form: { text: key },
        updatedAt: "2030-01-01T00:00:00Z",
      });
    }
    await endHostedRecoverySession(old);
    expect(loadContentEditRecovery(old, "pose", "new")).toBeNull();
    expect(loadContentEditRecovery(orphan, "pose", "new")).toBeNull();
    expect(loadContentEditRecovery(current, "pose", "new")?.operationId).toBe(
      current,
    );
    expect(recoverySessionIsActive(current)).toBe(true);
    await purgeHostedRecoverySessions();
    expect(loadContentEditRecovery(current, "pose", "new")).toBeNull();
    expect(
      loadContentEditRecovery("installation-owner", "pose", "new"),
    ).not.toBeNull();
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
