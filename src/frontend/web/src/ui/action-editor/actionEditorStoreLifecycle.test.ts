import { afterEach, describe, expect, it, vi } from "vitest";

import { retainActionEditorWorkspace } from "./actionEditorStoreLifecycle";

afterEach(() => {
  vi.runAllTimers();
  vi.useRealTimers();
});

describe("action editor store lifecycle", () => {
  it("preserves the timeline across an immediate creator route handoff", () => {
    vi.useFakeTimers();
    const resetWorkspace = vi.fn();
    const releaseNewRoute = retainActionEditorWorkspace(resetWorkspace);

    releaseNewRoute();
    const releaseEditRoute = retainActionEditorWorkspace(resetWorkspace);
    vi.runAllTimers();

    expect(resetWorkspace).not.toHaveBeenCalled();

    releaseEditRoute();
    vi.runAllTimers();
    expect(resetWorkspace).toHaveBeenCalledTimes(1);
  });
});
