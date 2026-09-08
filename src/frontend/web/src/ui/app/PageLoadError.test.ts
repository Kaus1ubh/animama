import { describe, expect, it, vi } from "vitest";

import { subscribeToAppFileErrors } from "./PageLoadError";

describe("application file recovery", () => {
  it("suppresses automatic import-error handling and releases its listener on unmount", () => {
    const events = new EventTarget();
    const recover = vi.fn();
    const unsubscribe = subscribeToAppFileErrors(events, recover);
    const failure = new Event("vite:preloadError", { cancelable: true });
    expect(events.dispatchEvent(failure)).toBe(false);
    expect(recover).toHaveBeenCalledTimes(1);
    events.dispatchEvent(new Event("unrelated-error"));
    expect(recover).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(
      events.dispatchEvent(
        new Event("vite:preloadError", { cancelable: true }),
      ),
    ).toBe(true);
    expect(recover).toHaveBeenCalledTimes(1);
  });
});
