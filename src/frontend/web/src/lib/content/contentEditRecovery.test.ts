import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearContentEditRecovery,
  CONTENT_EDIT_RECOVERY_SCHEMA,
  loadContentEditRecovery,
  saveContentEditRecovery,
} from "./contentEditRecovery";

describe("content edit workflow recovery", () => {
  const values = new Map<string, string>();

  beforeEach(() => {
    values.clear();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("keeps stable operation identity until a save succeeds", () => {
    saveContentEditRecovery({
      schema: CONTENT_EDIT_RECOVERY_SCHEMA,
      userId: "user-a",
      family: "idle-style",
      documentKey: "new",
      operationId: "operation-a",
      form: { name: "Angry idles", fileName: "angry.vrma" },
      updatedAt: "2026-08-12T12:00:00.000Z",
    });

    expect(
      loadContentEditRecovery("user-a", "idle-style", "new"),
    ).toMatchObject({
      operationId: "operation-a",
      form: { name: "Angry idles", fileName: "angry.vrma" },
    });
    expect(loadContentEditRecovery("user-b", "idle-style", "new")).toBeNull();

    clearContentEditRecovery("user-a", "idle-style", "new");
    expect(loadContentEditRecovery("user-a", "idle-style", "new")).toBeNull();
  });
});
