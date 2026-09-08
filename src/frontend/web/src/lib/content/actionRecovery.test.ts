import { describe, expect, it } from "vitest";
import { createGestureDocument } from "@/ui/gesture-editor/gestureDocument";
import {
  clearActionRecoveryForNewDocument,
  loadActionRecovery,
  loadActionRecoveryForEditorRoute,
  actionDocumentDigest,
  saveActionRecovery,
} from "./actionRecovery";

describe("actionRecovery", () => {
  it("round trips exact dependency and server draft identity per user", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const document = createGestureDocument("Wave");
    const rootDigest = actionDocumentDigest(document);
    saveActionRecovery(storage, {
      userId: "user-1",
      itemId: null,
      itemRevision: null,
      sessionId: "session-1",
      sessionRevision: 2,
      document,
      rootDigest,
    });
    expect(
      loadActionRecovery(storage, "user-1", "gesture", null),
    ).toMatchObject({
      sessionId: "session-1",
      sessionRevision: 2,
      rootDigest,
    });
    expect(loadActionRecovery(storage, "user-2", "gesture", null)).toBeNull();
  });

  it("rejects the pre-hydration recovery schema", () => {
    const document = createGestureDocument("Stale blank recovery");
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    saveActionRecovery(storage, {
      userId: "user-1",
      itemId: "gesture-1",
      itemRevision: null,
      sessionId: null,
      sessionRevision: null,
      document,
      rootDigest: actionDocumentDigest(document),
    });
    const key = [...values.keys()][0];
    values.set(
      key,
      JSON.stringify({ ...JSON.parse(values.get(key)!), schema: 2 }),
    );

    expect(
      loadActionRecovery(storage, "user-1", "gesture", "gesture-1"),
    ).toBeNull();
  });

  it("restores a server draft from the new-item route key", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const document = createGestureDocument("Recovered Gesture");
    saveActionRecovery(
      storage,
      {
        userId: "user-1",
        itemId: "gesture-draft-1",
        itemRevision: "a".repeat(64),
        sessionId: "session-1",
        sessionRevision: 2,
        document,
        rootDigest: actionDocumentDigest(document),
      },
      null,
    );

    expect(loadActionRecovery(storage, "user-1", "gesture", null)?.itemId).toBe(
      "gesture-draft-1",
    );
  });

  it("treats the new route as blank and clears stale recovery", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };
    const document = createGestureDocument("Previous Gesture");
    saveActionRecovery(
      storage,
      {
        userId: "user-1",
        itemId: "gesture-draft-1",
        itemRevision: "a".repeat(64),
        sessionId: "session-1",
        sessionRevision: 2,
        document,
        rootDigest: actionDocumentDigest(document),
      },
      null,
    );

    expect(
      loadActionRecoveryForEditorRoute(storage, "user-1", "gesture", null),
    ).toBeNull();
    expect(loadActionRecovery(storage, "user-1", "gesture", null)).toBeNull();
  });

  it("clears stale new-route recovery when starting New from an edit route", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };
    const document = createGestureDocument("Recovered Gesture");
    const recovery = {
      userId: "user-1",
      itemId: "gesture-1",
      itemRevision: "a".repeat(64),
      sessionId: "session-1",
      sessionRevision: 2,
      document,
      rootDigest: actionDocumentDigest(document),
    };
    saveActionRecovery(storage, recovery, null);
    saveActionRecovery(storage, recovery, "gesture-1");

    clearActionRecoveryForNewDocument(
      storage,
      "user-1",
      "gesture",
      "gesture-1",
    );

    expect(loadActionRecovery(storage, "user-1", "gesture", null)).toBeNull();
    expect(
      loadActionRecovery(storage, "user-1", "gesture", "gesture-1"),
    ).toBeNull();
  });
});
