import { describe, expect, it, vi } from "vitest";

import { AvatarPortraitGenerationCoordinator } from "./generationCoordinator";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((currentResolve) => {
    resolve = currentResolve;
  });
  return { promise, resolve };
}

describe("AvatarPortraitGenerationCoordinator", () => {
  it("coalesces concurrent loads and remembers one completion for the session", async () => {
    const coordinator = new AvatarPortraitGenerationCoordinator();
    const pending = deferred<string>();
    const operation = vi.fn(() => pending.promise);
    const first = coordinator.run({
      key: "version:r1:p1",
      signal: new AbortController().signal,
      operation,
    });
    const second = coordinator.run({
      key: "version:r1:p1",
      signal: new AbortController().signal,
      operation,
    });
    pending.resolve("done");

    await expect(first).resolves.toEqual({
      status: "completed",
      value: "done",
    });
    await expect(second).resolves.toEqual({
      status: "completed",
      value: "done",
    });
    expect(operation).toHaveBeenCalledTimes(1);
    await expect(
      coordinator.run({
        key: "version:r1:p1",
        signal: new AbortController().signal,
        operation,
      }),
    ).resolves.toEqual({ status: "skipped" });
  });

  it("allows a failed or interrupted release to be retried", async () => {
    const coordinator = new AvatarPortraitGenerationCoordinator();
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("temporary capture failure"))
      .mockResolvedValueOnce("recovered");

    await expect(
      coordinator.run({
        key: "retryable-release",
        signal: new AbortController().signal,
        operation,
      }),
    ).rejects.toThrow("temporary capture failure");
    await expect(
      coordinator.run({
        key: "retryable-release",
        signal: new AbortController().signal,
        operation,
      }),
    ).resolves.toEqual({ status: "completed", value: "recovered" });
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("keeps shared work alive until every subscriber cancels", async () => {
    const coordinator = new AvatarPortraitGenerationCoordinator();
    const operation = vi.fn(
      (signal: AbortSignal) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    );
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = coordinator.run({
      key: "shared",
      signal: firstController.signal,
      operation,
    });
    const second = coordinator.run({
      key: "shared",
      signal: secondController.signal,
      operation,
    });

    await Promise.resolve();
    firstController.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(operation.mock.calls[0]?.[0].aborted).toBe(false);
    secondController.abort();
    await expect(second).rejects.toMatchObject({ name: "AbortError" });
    expect(operation.mock.calls[0]?.[0].aborted).toBe(true);
  });
});
