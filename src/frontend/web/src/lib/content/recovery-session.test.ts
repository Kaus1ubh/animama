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
});
