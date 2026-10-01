import { describe, expect, it } from "vitest";
import {
  clearSetupDraft,
  emptySetupDraft,
  readSetupDraft,
  writeSetupDraft,
  type SetupDraft,
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

const draft = (patch: Partial<SetupDraft>): SetupDraft => ({
  ...emptySetupDraft(),
  ...patch,
});

describe("unfinished installation setup draft", () => {
  it("restores the step and choices for the same owner after renderer replacement", () => {
    const store = storage();
    const saved = draft({
      step: "voice",
      displayName: "  Ada  ",
      adultConfirmed: true,
      modelLocation: "local",
      chatModelId: "OpenAIHTTPAgent:qwen3",
      ttsEnabled: true,
      ttsProvider: "elevenlabs",
    });
    expect(writeSetupDraft("owner-a", saved, store)).toBe(true);
    expect(readSetupDraft("owner-a", store)).toEqual(saved);
    expect(readSetupDraft("owner-b", store)).toEqual(emptySetupDraft());
    writeSetupDraft("owner-a", { ...saved, adultConfirmed: false }, store);
    // A later step needs the Welcome answers.
    expect(readSetupDraft("owner-a", store)).toMatchObject({
      step: "welcome",
      adultConfirmed: false,
      chatModelId: "OpenAIHTTPAgent:qwen3",
    });
  });

  it("stores only bounded nonsecret fields, never credentials or readiness", () => {
    const store = storage();
    writeSetupDraft(
      "owner-a",
      {
        ...draft({ displayName: "x".repeat(100), adultConfirmed: true }),
        apiKey: "fixture-secret",
        firstRunComplete: true,
      } as SetupDraft,
      store,
    );
    expect([...store.entries.values()].map((text) => JSON.parse(text))).toEqual(
      [draft({ displayName: "x".repeat(80), adultConfirmed: true })],
    );
  });

  it("rejects corrupt or oversized drafts and never infers adult confirmation", () => {
    const store = storage();
    writeSetupDraft("owner-a", draft({ displayName: "Ada" }), store);
    const key = [...store.entries.keys()][0];
    for (const text of [
      "broken",
      "null",
      JSON.stringify({ displayName: "Ada", adultConfirmed: "yes" }),
      "x".repeat(5000),
    ]) {
      store.setItem(key, text);
      expect(readSetupDraft("owner-a", store)).toEqual(emptySetupDraft());
    }
    store.setItem(
      key,
      JSON.stringify({
        step: "elsewhere",
        displayName: "Ada",
        adultConfirmed: true,
        modelLocation: "orbit",
        chatModelId: 7,
        ttsEnabled: "yes",
        ttsProvider: "browser",
      }),
    );
    expect(readSetupDraft("owner-a", store)).toEqual(
      draft({ displayName: "Ada", adultConfirmed: true }),
    );
  });

  it("clears only the completed owner's draft and tolerates unavailable storage", () => {
    const store = storage();
    for (const owner of ["a", "b"])
      writeSetupDraft(
        owner,
        draft({ displayName: owner, adultConfirmed: true }),
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
        draft({ displayName: "Ada", adultConfirmed: true }),
        blocked,
      ),
    ).toBe(false);
    expect(() => clearSetupDraft("a", blocked)).not.toThrow();
  });
});
