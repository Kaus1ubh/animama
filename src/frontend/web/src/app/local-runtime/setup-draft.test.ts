import { describe, expect, it } from "vitest";
import {
  clearSetupDraft,
  readSetupDraft,
  writeSetupDraft,
} from "./setup-draft";

function storage() {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
    removeItem: (key: string) => {
      entries.delete(key);
    },
  };
}

describe("unfinished installation setup draft", () => {
  it("restores explicit name and age choice for the same owner after renderer replacement", () => {
    const store = storage();
    const draft = { displayName: "  Ada  ", adultConfirmed: true };
    expect(writeSetupDraft("owner-a", draft, store)).toBe(true);
    expect(readSetupDraft("owner-a", store)).toEqual(draft);
    expect(readSetupDraft("owner-b", store)).toEqual({
      displayName: "",
      adultConfirmed: false,
    });
    writeSetupDraft("owner-a", { ...draft, adultConfirmed: false }, store);
    expect(readSetupDraft("owner-a", store).adultConfirmed).toBe(false);
  });

  it("stores only bounded nonsecret fields, never credentials or readiness", () => {
    const store = storage();
    writeSetupDraft(
      "owner-a",
      {
        displayName: "x".repeat(100),
        adultConfirmed: true,
        apiKey: "fixture-secret",
        firstRunComplete: true,
      } as { displayName: string; adultConfirmed: boolean },
      store,
    );
    expect([...store.entries.values()].map((text) => JSON.parse(text))).toEqual(
      [{ displayName: "x".repeat(80), adultConfirmed: true }],
    );
  });

  it("rejects corrupt or oversized drafts and never infers adult confirmation", () => {
    const store = storage();
    writeSetupDraft(
      "owner-a",
      { displayName: "Ada", adultConfirmed: false },
      store,
    );
    const key = [...store.entries.keys()][0];
    for (const text of [
      "broken",
      "null",
      JSON.stringify({ displayName: "Ada", adultConfirmed: "yes" }),
      "x".repeat(4096),
    ]) {
      store.setItem(key, text);
      expect(readSetupDraft("owner-a", store)).toEqual({
        displayName: "",
        adultConfirmed: false,
      });
    }
  });

  it("clears only the completed owner's draft and tolerates unavailable storage", () => {
    const store = storage();
    for (const owner of ["a", "b"])
      writeSetupDraft(
        owner,
        { displayName: owner, adultConfirmed: true },
        store,
      );
    clearSetupDraft("a", store);
    expect(readSetupDraft("a", store).displayName).toBe("");
    expect(readSetupDraft("b", store).displayName).toBe("b");
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readSetupDraft("a", blocked).adultConfirmed).toBe(false);
    expect(
      writeSetupDraft(
        "a",
        { displayName: "Ada", adultConfirmed: true },
        blocked,
      ),
    ).toBe(false);
    expect(() => clearSetupDraft("a", blocked)).not.toThrow();
  });
});
