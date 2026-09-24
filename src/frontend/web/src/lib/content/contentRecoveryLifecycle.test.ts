import { describe, expect, it, vi } from "vitest";

import { ContentRecoveryLifecycle } from "./contentRecoveryLifecycle";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("creator recovery lifecycle", () => {
  it("drains a delayed write before clearing so discard cannot resurrect the draft", async () => {
    const lifecycle = new ContentRecoveryLifecycle();
    const started = deferred<void>();
    const finish = deferred<void>();
    let stored: string | null = null;
    const write = lifecycle.write(lifecycle.capture(), async () => {
      started.resolve();
      await finish.promise;
      stored = "old draft";
    });
    await started.promise;
    const clear = vi.fn(async () => {
      stored = null;
    });
    const discarded = lifecycle.discard(clear);
    await Promise.resolve();
    expect(clear).not.toHaveBeenCalled();
    finish.resolve();
    await Promise.all([write, discarded]);
    expect(clear).toHaveBeenCalledOnce();
    expect(stored).toBeNull();
  });

  it("fences queued writes, late timers and stale restores even after a new session resumes", async () => {
    const lifecycle = new ContentRecoveryLifecycle();
    const generation = lifecycle.capture();
    const callback = vi.fn(async () => "old draft");
    const queued = lifecycle.write(generation, callback);
    const restore = deferred<string>();
    const onRestore = vi.fn();
    const restoration = restore.promise.then((value) => {
      if (lifecycle.isCurrent(generation)) onRestore(value);
    });
    await lifecycle.discard(async () => {});
    lifecycle.resume();
    await lifecycle.write(generation, callback); // old 350ms debounce fires late
    restore.resolve("old draft");
    await Promise.all([queued, restoration]);
    expect(callback).not.toHaveBeenCalled();
    expect(onRestore).not.toHaveBeenCalled();
    expect(lifecycle.isCurrent(lifecycle.capture())).toBe(true);
  });

  it("blocks new scheduling after discard until explicitly resumed", async () => {
    const lifecycle = new ContentRecoveryLifecycle();
    await lifecycle.discard(async () => {});
    const write = vi.fn(async () => "new draft");
    await lifecycle.write(lifecycle.capture(), write);
    expect(write).not.toHaveBeenCalled();
    lifecycle.resume();
    expect(await lifecycle.write(lifecycle.capture(), write)).toBe("new draft");
    expect(write).toHaveBeenCalledOnce();
  });

  it("keeps independent document keys active and continues after a rejected write", async () => {
    const first = new ContentRecoveryLifecycle();
    const second = new ContentRecoveryLifecycle();
    const failure = first.write(first.capture(), async () => {
      throw new Error("write failed");
    });
    await expect(failure).rejects.toThrow("write failed");
    const clear = vi.fn(async () => {});
    await first.discard(clear);
    expect(clear).toHaveBeenCalledOnce();
    expect(await second.write(second.capture(), async () => "other key")).toBe(
      "other key",
    );
  });

  it("reports clear failure and remains fenced until the caller deliberately resumes", async () => {
    const lifecycle = new ContentRecoveryLifecycle();
    await expect(
      lifecycle.discard(async () => {
        throw new Error("clear failed");
      }),
    ).rejects.toThrow("clear failed");
    expect(lifecycle.isCurrent(lifecycle.capture())).toBe(false);
    lifecycle.resume();
    expect(lifecycle.isCurrent(lifecycle.capture())).toBe(true);
  });
});
