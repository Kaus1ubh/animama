import { describe, expect, it, vi } from "vitest";
import type { RuntimeAdmission } from "@animama/runtime-contracts";
import { RuntimeController } from "./runtime-controller";
import { hostedCapabilitiesFixture as capabilities } from "./runtime-fixture";
import type { AppComposition } from "./composition";

function ready(key: string, onboardingRequired = false): RuntimeAdmission {
  return {
    status: "ready",
    session: { key, owner: { id: "same-owner" } },
    capabilities,
    onboardingRequired,
  };
}
function fixture(kind: AppComposition["kind"] = "hosted") {
  let admission = ready("first-lifetime");
  const composition: AppComposition = {
    kind,
    transport: { baseUrl: "https://app.example.test", fetch: vi.fn() },
    readAdmission: vi.fn(async () => admission),
    repair: vi.fn(async () => admission),
    accountActions: {
      signIn: vi.fn(),
      signOut: vi.fn(async () => {}),
      openAccount: vi.fn(),
      loadUsage: vi.fn(),
    },
  };
  return {
    controller: new RuntimeController(composition),
    composition,
    set: (next: RuntimeAdmission) => {
      admission = next;
    },
  };
}

describe("composition lifetime boundary", () => {
  it("refetches every query after an 18+ confirmation on hosted only", async () => {
    for (const kind of ["hosted", "local"] as const) {
      const { controller, set } = fixture(kind);
      try {
        set(ready("first-lifetime", true));
        await controller.refresh();
        const invalidate = vi.spyOn(
          controller.getSnapshot().queryClient,
          "invalidateQueries",
        );
        set(ready("first-lifetime"));
        await controller.refresh();
        // Local onboarding refreshes its own query families; hosted refused all of them.
        expect(invalidate.mock.calls.some(([filters]) => !filters)).toBe(
          kind === "hosted",
        );
      } finally {
        controller.dispose();
      }
    }
  });
  it("bounds automatic reconnect backoff and cancels it on sign-out", async () => {
    vi.useFakeTimers();
    const { controller, composition } = fixture();
    try {
      await controller.refresh();
      vi.mocked(composition.readAdmission).mockRejectedValue(
        new TypeError("Offline"),
      );
      await controller.refresh();
      let calls = 2;
      for (const delay of [
        1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000,
      ]) {
        await vi.advanceTimersByTimeAsync(delay - 1);
        expect(composition.readAdmission).toHaveBeenCalledTimes(calls);
        await vi.advanceTimersByTimeAsync(1);
        expect(composition.readAdmission).toHaveBeenCalledTimes(++calls);
      }
      await controller.signOut();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(composition.readAdmission).toHaveBeenCalledTimes(calls);
    } finally {
      controller.dispose();
      vi.useRealTimers();
    }
  });
  it("retains drafts and resources during a transient hosted context failure, suspending dispatch until readmission", async () => {
    const { controller, composition } = fixture();
    await controller.refresh();
    const previous = controller.getSnapshot();
    previous.queryClient.setQueryData(["draft"], {
      operationId: "original-save",
    });
    const dispose = vi.fn();
    previous.scope!.register(dispose);
    vi.mocked(composition.readAdmission).mockRejectedValueOnce(
      new TypeError("Failed to fetch"),
    );
    await controller.refresh();
    expect(controller.getSnapshot().scope).toBe(previous.scope);
    expect(previous.scope!.controller.signal.aborted).toBe(false);
    expect(previous.queryClient.getQueryData(["draft"])).toEqual({
      operationId: "original-save",
    });
    expect(dispose).not.toHaveBeenCalled();
    await expect(
      previous.scope!.fetch("/v1/chats", { method: "POST" }),
    ).rejects.toThrow("reconnecting");
    expect(composition.transport.fetch).not.toHaveBeenCalled();
    await controller.refresh();
    expect(controller.getSnapshot().scope).toBe(previous.scope);
    vi.mocked(composition.transport.fetch).mockResolvedValueOnce(
      Response.json({ ok: true }),
    );
    expect((await previous.scope!.fetch("/v1/chats")).ok).toBe(true);
    controller.dispose();
  });

  it("retires an uncertain lifetime immediately on an authoritative revoke even when context is unreachable", async () => {
    const { controller, composition } = fixture();
    await controller.refresh();
    const old = controller.getSnapshot().scope!;
    vi.mocked(composition.readAdmission).mockRejectedValue(
      new TypeError("Offline"),
    );
    await controller.refresh();
    await controller.refresh(false, true);
    expect(old.controller.signal.aborted).toBe(true);
    expect(controller.getSnapshot().scope).toBeNull();
    controller.dispose();
  });

  it("clears queries and ends registered work before same-owner reauthentication mounts", async () => {
    const { controller, set } = fixture();
    await controller.refresh();
    const old = controller.getSnapshot();
    old.queryClient.setQueryData(["private"], "old-draft");
    const dispose = vi.fn();
    old.scope!.register(dispose);
    set(ready("new-lifetime"));
    await controller.refresh();
    expect(old.scope!.controller.signal.aborted).toBe(true);
    expect(dispose).toHaveBeenCalledOnce();
    expect(old.queryClient.getQueryData(["private"])).toBeUndefined();
    expect(
      controller.getSnapshot().queryClient.getQueryData(["private"]),
    ).toBeUndefined();
  });

  it("does not interrupt private work for a fresh unchanged admission check", async () => {
    const { controller } = fixture();
    await controller.refresh();
    const old = controller.getSnapshot();
    await controller.refresh();
    expect(controller.getSnapshot().scope).toBe(old.scope);
    expect(controller.getSnapshot().queryClient).toBe(old.queryClient);
    expect(old.scope!.controller.signal.aborted).toBe(false);
  });

  it("ends work synchronously when sign-out is requested, before remote logout settles", async () => {
    const { controller, composition } = fixture();
    await controller.refresh();
    const old = controller.getSnapshot();
    let finish!: () => void;
    vi.mocked(composition.accountActions!.signOut).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = controller.signOut();
    expect(old.scope!.controller.signal.aborted).toBe(true);
    expect(controller.getSnapshot().admission.status).toBe("sign-in-required");
    finish();
    await pending;
  });

  it("ignores an admission read that finishes after sign-out", async () => {
    const { controller, composition } = fixture();
    let finish!: (value: RuntimeAdmission) => void;
    vi.mocked(composition.readAdmission).mockImplementation(
      () =>
        new Promise<RuntimeAdmission>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = controller.refresh();
    await controller.signOut();
    finish(ready("stale"));
    await pending;
    expect(controller.getSnapshot().admission.status).toBe("sign-in-required");
  });

  it("awaits durable cleanup after immediately ending admission and remote sign-out", async () => {
    const { controller, composition } = fixture();
    await controller.refresh();
    const old = controller.getSnapshot();
    let finish!: () => void;
    old.scope!.register(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    let settled = false;
    const pending = controller.signOut().then(() => {
      settled = true;
    });
    expect(old.scope!.controller.signal.aborted).toBe(true);
    expect(controller.getSnapshot().admission.status).toBe("sign-in-required");
    expect(composition.accountActions!.signOut).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(settled).toBe(false);
    finish();
    await pending;
  });

  it("does not admit a changed lifetime until prior durable cleanup finishes", async () => {
    const { controller, set } = fixture();
    await controller.refresh();
    let finish!: () => void;
    controller.getSnapshot().scope!.register(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    set(ready("replacement-after-cleanup"));
    const pending = controller.refresh();
    await Promise.resolve();
    expect(controller.getSnapshot().admission.status).toBe("loading");
    finish();
    await pending;
    expect(controller.getSnapshot().scope!.key).toBe(
      "replacement-after-cleanup",
    );
  });

  it("reports a failed session cleanup once, then readmits and reports only newer failures", async () => {
    const { controller, set } = fixture();
    await controller.refresh();
    controller.getSnapshot().scope!.register(() => {
      throw new Error("Recovery storage is blocked");
    });
    set(ready("after-failed-cleanup"));
    await controller.refresh();
    const reported = controller.getSnapshot().admission;
    expect(reported.status).toBe("unavailable");
    expect(reported.status !== "ready" && reported.message).toMatch(
      /previous session/,
    );
    await controller.refresh();
    expect(controller.getSnapshot().scope!.key).toBe("after-failed-cleanup");
    set(ready("after-clean-cleanup"));
    await controller.refresh();
    expect(controller.getSnapshot().scope!.key).toBe("after-clean-cleanup");
  });

  it("reports a cleanup failure from sign-out once without blocking the next sign-in", async () => {
    const { controller, set } = fixture();
    await controller.refresh();
    controller.getSnapshot().scope!.register(() => {
      throw new Error("Recovery storage is blocked");
    });
    await controller.signOut();
    const signedOut = controller.getSnapshot().admission;
    expect(signedOut.status).toBe("sign-in-required");
    expect(signedOut.status !== "ready" && signedOut.message).toMatch(
      /could not be removed/,
    );
    set(ready("next-sign-in"));
    await controller.refresh();
    expect(controller.getSnapshot().scope!.key).toBe("next-sign-in");
  });

  it("keeps a failed sign-out visible when admission is re-read while it runs", async () => {
    const { controller, composition } = fixture();
    await controller.refresh();
    let incomplete = false;
    Object.assign(composition, {
      accountAffordances: () => ({
        canOpenAccount: false,
        signOutIncomplete: incomplete,
      }),
    });
    let fail!: () => void;
    vi.mocked(composition.accountActions!.signOut).mockImplementation(
      () =>
        new Promise<void>((_resolve, reject) => {
          fail = () => {
            incomplete = true;
            reject(new Error("Logout failed"));
          };
        }),
    );
    const pending = controller.signOut();
    // A focus while the logout runs re-reads admission.
    vi.mocked(composition.readAdmission).mockResolvedValue({
      status: "sign-in-required",
    });
    await controller.refresh();
    fail();
    await pending;
    expect(controller.getSnapshot().admission).toEqual({
      status: "sign-in-required",
    });
    expect(controller.getSnapshot().account.signOutIncomplete).toBe(true);
  });

  it("shows only the retry view when a sign-out is unfinished, even after a cleanup failure", async () => {
    const { controller, composition } = fixture();
    await controller.refresh();
    controller.getSnapshot().scope!.register(() => {
      throw new Error("Recovery storage is blocked");
    });
    Object.assign(composition, {
      accountAffordances: () => ({
        canOpenAccount: false,
        signOutIncomplete: true,
      }),
    });
    vi.mocked(composition.accountActions!.signOut).mockRejectedValue(
      new Error("Logout failed"),
    );
    await controller.signOut();
    expect(controller.getSnapshot().admission).toEqual({
      status: "sign-in-required",
    });
    expect(controller.getSnapshot().account.signOutIncomplete).toBe(true);
  });

  it("publishes the account affordances the composition reports with each admission", async () => {
    const { controller, composition } = fixture();
    expect(controller.getSnapshot().account).toEqual({
      canOpenAccount: false,
      signOutIncomplete: false,
    });
    let canOpenAccount = true;
    Object.assign(composition, {
      accountAffordances: () => ({ canOpenAccount, signOutIncomplete: false }),
    });
    await controller.refresh();
    expect(controller.getSnapshot().account.canOpenAccount).toBe(true);
    // An unchanged session keeps its lifetime but still follows the newest read.
    const scope = controller.getSnapshot().scope;
    canOpenAccount = false;
    await controller.refresh();
    expect(controller.getSnapshot().scope).toBe(scope);
    expect(controller.getSnapshot().account.canOpenAccount).toBe(false);
  });

  it("does not retire a newer ready lifetime when an older admission read finishes late", async () => {
    const { controller, composition } = fixture();
    await controller.refresh();
    let finish!: (admission: RuntimeAdmission) => void;
    vi.mocked(composition.readAdmission).mockImplementationOnce(
      () =>
        new Promise<RuntimeAdmission>((resolve) => {
          finish = resolve;
        }),
    );
    const oldRead = controller.refresh();
    vi.mocked(composition.readAdmission).mockResolvedValueOnce(
      ready("newest-lifetime"),
    );
    await controller.refresh();
    const newest = controller.getSnapshot().scope;
    finish(ready("stale-replacement"));
    await oldRead;
    expect(controller.getSnapshot().scope).toBe(newest);
    expect(newest!.controller.signal.aborted).toBe(false);
  });
});
