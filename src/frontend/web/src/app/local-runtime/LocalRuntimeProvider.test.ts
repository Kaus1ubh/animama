import { describe, expect, it, vi } from "vitest";

import type { PyRuntimeContext } from "@animama/runtime-contracts/sdk";
import {
  completeLocalRuntimeOnboarding,
  loadLocalRuntimeContext,
  localRuntimeHomePath,
  type LocalRuntimeApi,
} from "@web/app/local-runtime/LocalRuntimeProvider";
import { localRuntimeShellView } from "@web/app/local-runtime/runtime-shell";

const incompleteContext: PyRuntimeContext = {
  schema_version: 1,
  principal_id: "installation-owner-1",
  bootstrap_status: "ready",
  failed_steps: [],
  first_run_complete: false,
  display_name: null,
};

const repairContext: PyRuntimeContext = {
  ...incompleteContext,
  bootstrap_status: "repair_required",
  failed_steps: ["profile_memory"],
};

function api(overrides: Partial<LocalRuntimeApi> = {}): LocalRuntimeApi {
  return {
    ensureBootstrap: vi.fn(async () => incompleteContext),
    getContext: vi.fn(async () => incompleteContext),
    completeOnboarding: vi.fn(async (displayName) => ({
      ...incompleteContext,
      first_run_complete: true,
      display_name: displayName,
    })),
    ...overrides,
  };
}

describe("local runtime bootstrap", () => {
  it("reads ready context without rescanning installation content", async () => {
    const runtimeApi = api();

    await expect(loadLocalRuntimeContext(runtimeApi)).resolves.toEqual({
      status: "ready",
      principalId: "installation-owner-1",
      firstRunComplete: false,
      displayName: null,
    });
    expect(runtimeApi.getContext).toHaveBeenCalledOnce();
    expect(runtimeApi.ensureBootstrap).not.toHaveBeenCalled();
  });

  it("repairs only when requested and uses the returned context directly", async () => {
    const calls: string[] = [];
    const runtimeApi = api({
      ensureBootstrap: vi.fn(async () => {
        calls.push("ensure");
        return {
          ...incompleteContext,
          first_run_complete: true,
          display_name: "Ada",
        };
      }),
      getContext: vi.fn(async () => {
        calls.push("context");
        return repairContext;
      }),
    });

    await expect(loadLocalRuntimeContext(runtimeApi)).resolves.toEqual({
      status: "ready",
      principalId: "installation-owner-1",
      firstRunComplete: true,
      displayName: "Ada",
    });
    expect(calls).toEqual(["context", "ensure"]);
  });

  it("shares an in-flight context read across repeated effect setup", async () => {
    let resolveContext!: (value: PyRuntimeContext) => void;
    const runtimeApi = api({
      getContext: vi.fn(
        () =>
          new Promise<PyRuntimeContext>((resolve) => {
            resolveContext = resolve;
          }),
      ),
    });

    const first = loadLocalRuntimeContext(runtimeApi);
    const second = loadLocalRuntimeContext(runtimeApi);
    expect(first).toBe(second);
    expect(runtimeApi.getContext).toHaveBeenCalledOnce();
    resolveContext(incompleteContext);
    await expect(first).resolves.toMatchObject({ status: "ready" });
    await expect(second).resolves.toMatchObject({ status: "ready" });
    expect(runtimeApi.ensureBootstrap).not.toHaveBeenCalled();
  });

  it("shares repair work across concurrent initialization", async () => {
    const runtimeApi = api({
      getContext: vi.fn(async () => repairContext),
    });

    const results = await Promise.all([
      loadLocalRuntimeContext(runtimeApi),
      loadLocalRuntimeContext(runtimeApi),
    ]);

    expect(results.every((result) => result.status === "ready")).toBe(true);
    expect(runtimeApi.getContext).toHaveBeenCalledOnce();
    expect(runtimeApi.ensureBootstrap).toHaveBeenCalledOnce();
  });

  it("reads fresh state after a completed load instead of caching it", async () => {
    const getContext = vi
      .fn<LocalRuntimeApi["getContext"]>()
      .mockResolvedValueOnce(incompleteContext)
      .mockResolvedValue({
        ...incompleteContext,
        first_run_complete: true,
        display_name: "Ada",
      });
    const runtimeApi = api({ getContext });

    await expect(loadLocalRuntimeContext(runtimeApi)).resolves.toMatchObject({
      firstRunComplete: false,
    });
    await expect(loadLocalRuntimeContext(runtimeApi)).resolves.toMatchObject({
      firstRunComplete: true,
      displayName: "Ada",
    });
    expect(getContext).toHaveBeenCalledTimes(2);
  });

  it("does not share ownership between different API adapters", async () => {
    const firstApi = api();
    const secondApi = api({
      getContext: vi.fn(async () => ({
        ...incompleteContext,
        principal_id: "installation-owner-2",
      })),
    });

    const [first, second] = await Promise.all([
      loadLocalRuntimeContext(firstApi),
      loadLocalRuntimeContext(secondApi),
    ]);
    expect(first).toMatchObject({ principalId: "installation-owner-1" });
    expect(second).toMatchObject({ principalId: "installation-owner-2" });
  });

  it("retries failed reads without turning request errors into repair mutations", async () => {
    const getContext = vi
      .fn<LocalRuntimeApi["getContext"]>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(incompleteContext);
    const runtimeApi = api({ getContext });

    await expect(loadLocalRuntimeContext(runtimeApi)).rejects.toThrow(
      "offline",
    );
    await expect(loadLocalRuntimeContext(runtimeApi)).resolves.toMatchObject({
      status: "ready",
    });
    expect(getContext).toHaveBeenCalledTimes(2);
    expect(runtimeApi.ensureBootstrap).not.toHaveBeenCalled();
  });

  it("can retry a recoverable bootstrap failure safely", async () => {
    const ensureBootstrap = vi
      .fn<LocalRuntimeApi["ensureBootstrap"]>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(incompleteContext);
    const runtimeApi = api({
      ensureBootstrap,
      getContext: vi.fn(async () => repairContext),
    });

    await expect(loadLocalRuntimeContext(runtimeApi)).rejects.toThrow(
      "offline",
    );
    await expect(loadLocalRuntimeContext(runtimeApi)).resolves.toMatchObject({
      status: "ready",
      principalId: "installation-owner-1",
    });
    expect(ensureBootstrap).toHaveBeenCalledTimes(2);
  });

  it("completes named setup without credentials", async () => {
    const displayName = "Ada";
    const runtimeApi = api();

    await expect(
      completeLocalRuntimeOnboarding(displayName, runtimeApi),
    ).resolves.toMatchObject({
      status: "ready",
      firstRunComplete: true,
      displayName,
    });
    expect(runtimeApi.completeOnboarding).toHaveBeenCalledWith(displayName);
  });

  it("retries a lost onboarding response without changing the operation", async () => {
    const completeOnboarding = vi
      .fn<LocalRuntimeApi["completeOnboarding"]>()
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValue({
        ...incompleteContext,
        first_run_complete: true,
        display_name: "Ada",
      });
    const runtimeApi = api({ completeOnboarding });

    await expect(
      completeLocalRuntimeOnboarding("Ada", runtimeApi),
    ).rejects.toThrow("response lost");
    await expect(
      completeLocalRuntimeOnboarding("Ada", runtimeApi),
    ).resolves.toMatchObject({
      firstRunComplete: true,
      displayName: "Ada",
    });
    expect(completeOnboarding).toHaveBeenNthCalledWith(1, "Ada");
    expect(completeOnboarding).toHaveBeenNthCalledWith(2, "Ada");
  });

  it("rejects a repair-required context instead of mounting feature routes", async () => {
    const runtimeApi = api({
      getContext: vi.fn(async () => repairContext),
      ensureBootstrap: vi.fn(async () => repairContext),
    });

    await expect(loadLocalRuntimeContext(runtimeApi)).rejects.toThrow(
      "profile_memory",
    );
  });

  it("routes fresh installs to setup and completed installs straight to the app", () => {
    const fresh = {
      status: "ready" as const,
      principalId: "installation-owner-1",
      firstRunComplete: false,
      displayName: null,
    };

    expect(localRuntimeHomePath(fresh)).toBe("/setup");
    expect(localRuntimeHomePath({ ...fresh, firstRunComplete: true })).toBe(
      "/a",
    );
  });

  it("keeps auxiliary desktop windows on a blank wait surface", () => {
    expect(localRuntimeShellView("loading", true)).toBe("auxiliary-wait");
    expect(localRuntimeShellView("recoverable-error", true)).toBe(
      "auxiliary-wait",
    );
    expect(localRuntimeShellView("ready", true)).toBe("router");
    expect(localRuntimeShellView("recoverable-error", false)).toBe(
      "main-error",
    );
  });
});
