import { describe, expect, it, vi } from "vitest";

import { createLastActiveAnimaAttempts } from "./lastActiveAnimaAttempts";

const owned = ["anima-a", "anima-b"];

describe("last active Anima persistence attempts", () => {
  it("does not retry a failed write while the same Anima stays open", async () => {
    const attempts = createLastActiveAnimaAttempts();
    const update = vi.fn().mockRejectedValue(new Error("offline"));
    const visit = {
      routeAnimaId: "anima-a",
      rememberedAnimaId: "anima-gone",
      ownedAnimaIds: owned,
    };

    attempts.remember(visit, update);
    await Promise.resolve();
    // Settings and mutation state change after a failure and re-run the effect.
    attempts.remember(visit, update);
    attempts.remember(visit, update);

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith("anima-a");
  });

  it("tries again on the next visit after a failure", async () => {
    const attempts = createLastActiveAnimaAttempts();
    const update = vi.fn().mockRejectedValue(new Error("offline"));
    const remembered = "anima-gone";

    attempts.remember(
      {
        routeAnimaId: "anima-a",
        rememberedAnimaId: remembered,
        ownedAnimaIds: owned,
      },
      update,
    );
    attempts.remember(
      {
        routeAnimaId: "anima-b",
        rememberedAnimaId: remembered,
        ownedAnimaIds: owned,
      },
      update,
    );
    attempts.remember(
      {
        routeAnimaId: "anima-a",
        rememberedAnimaId: remembered,
        ownedAnimaIds: owned,
      },
      update,
    );
    await Promise.resolve();

    expect(update.mock.calls).toEqual([["anima-a"], ["anima-b"], ["anima-a"]]);
  });

  it("tries again after visiting an Anima that is already remembered", async () => {
    const attempts = createLastActiveAnimaAttempts();
    const update = vi.fn().mockRejectedValue(new Error("offline"));

    attempts.remember(
      {
        routeAnimaId: "anima-a",
        rememberedAnimaId: "anima-b",
        ownedAnimaIds: owned,
      },
      update,
    );
    await Promise.resolve();
    attempts.remember(
      {
        routeAnimaId: "anima-b",
        rememberedAnimaId: "anima-b",
        ownedAnimaIds: owned,
      },
      update,
    );
    attempts.remember(
      {
        routeAnimaId: "anima-a",
        rememberedAnimaId: "anima-b",
        ownedAnimaIds: owned,
      },
      update,
    );

    expect(update.mock.calls).toEqual([["anima-a"], ["anima-a"]]);
  });

  it("skips Animas that are already remembered or not owned", () => {
    const attempts = createLastActiveAnimaAttempts();
    const update = vi.fn().mockResolvedValue(undefined);

    attempts.remember(
      {
        routeAnimaId: "anima-a",
        rememberedAnimaId: "anima-a",
        ownedAnimaIds: owned,
      },
      update,
    );
    attempts.remember(
      {
        routeAnimaId: "anima-x",
        rememberedAnimaId: "anima-a",
        ownedAnimaIds: owned,
      },
      update,
    );

    expect(update).not.toHaveBeenCalled();
  });
});
