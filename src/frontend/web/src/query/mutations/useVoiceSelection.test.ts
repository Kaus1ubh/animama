import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PyVoiceContent } from "@animama/runtime-contracts/api-types";
const api = vi.hoisted(() => ({ plan: vi.fn(), commit: vi.fn() }));
vi.mock("@animama/runtime-contracts/sdk", () => ({
  planVoice: api.plan,
  commitVoice: api.commit,
}));
import { selectVoiceClone } from "./useVoiceSelection";

beforeEach(() => {
  vi.clearAllMocks();
  api.plan.mockResolvedValue({
    data: { plan_digest: "complete-closure-digest" },
  });
  api.commit.mockResolvedValue({ data: { aggregate_revision: 8 } });
});

describe("Anima voice binding selection", () => {
  it("commits the planned catalog source using the captured loadout revision and full plan digest", async () => {
    const clone = {
      item_id: "clone-1",
      logical_key: "local:voice:1",
      source: "local",
    } as PyVoiceContent;
    await expect(
      selectVoiceClone("anima-1", {
        clone,
        expectedRevision: 7,
        idempotencyKey: "select-once",
      }),
    ).resolves.toEqual({ aggregate_revision: 8 });
    const intent = {
      operation: "set",
      source: {
        type: "catalog",
        catalog_item_id: "clone-1",
        logical_key: "local:voice:1",
        source: "local",
      },
      config: {},
    };
    expect(api.plan).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        path: { anima_id: "anima-1" },
        body: { expected_revision: 7, intent },
      }),
    );
    expect(api.commit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        path: { anima_id: "anima-1" },
        body: {
          expected_revision: 7,
          intent,
          plan_digest: "complete-closure-digest",
          idempotency_key: "select-once",
        },
      }),
    );
  });

  it("removes only the binding when returning to a preset", async () => {
    await selectVoiceClone("anima-1", { clone: null, expectedRevision: 7 });
    expect(api.plan.mock.calls[0][0].body.intent).toEqual({
      operation: "remove",
      config: {},
    });
    expect(api.commit.mock.calls[0][0].body.intent).toEqual({
      operation: "remove",
      config: {},
    });
  });

  it("does not attempt a commit after a stale or failed plan", async () => {
    api.plan.mockRejectedValueOnce(new Error("Loadout changed"));
    await expect(
      selectVoiceClone("anima-1", { clone: null, expectedRevision: 7 }),
    ).rejects.toThrow("Loadout changed");
    expect(api.commit).not.toHaveBeenCalled();
  });

  it("reports commit failure without fabricating a selected binding", async () => {
    api.commit.mockRejectedValueOnce(new Error("Source changed"));
    await expect(
      selectVoiceClone("anima-1", { clone: null, expectedRevision: 7 }),
    ).rejects.toThrow("Source changed");
  });
});
