import { afterEach, describe, expect, it, vi } from "vitest";

import { createInFlightWork } from "./in-flight-work";

afterEach(() => {
  vi.useRealTimers();
});

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("waiting for in-flight work", () => {
  it("settles at once when nothing is running", async () => {
    await expect(createInFlightWork().settle(1000)).resolves.toBe(true);
  });

  it("waits for every tracked transcription, including failed ones", async () => {
    const work = createInFlightWork();
    const first = deferred();
    const second = deferred();
    work.track(first.promise);
    void work.track(second.promise).catch(() => {});
    let settled = false;
    const waiting = work.settle(5000).then((done) => {
      settled = done;
    });

    first.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    second.reject(new Error("decode failed"));
    await waiting;

    expect(settled).toBe(true);
    await expect(work.settle(5000)).resolves.toBe(true);
  });

  it("stops waiting when the bound runs out", async () => {
    vi.useFakeTimers();
    const work = createInFlightWork();
    work.track(new Promise(() => {}));
    const waiting = work.settle(500);
    await vi.advanceTimersByTimeAsync(500);
    await expect(waiting).resolves.toBe(false);
  });
});
