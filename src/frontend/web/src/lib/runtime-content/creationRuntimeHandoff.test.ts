import { afterEach, describe, expect, it, vi } from "vitest";
import type { PyAnimaRuntime } from "@/lib/content/catalogTypes";
import { PreparedRuntimeMount } from "./RuntimeMountPreparer";
import {
  claimCreationRuntime,
  offerCreationRuntime,
} from "./creationRuntimeHandoff";

const typed = { effective_revision: "exact-revision" } as PyAnimaRuntime;
function mount() {
  return new PreparedRuntimeMount(
    typed,
    new Map(),
    "ready",
    { completedMembers: 0, totalMembers: 0, loadedBytes: 0, totalBytes: 0 },
    [],
    { revokeObjectURL: vi.fn() },
  );
}
afterEach(() => vi.useRealTimers());

describe("one prepared first-chat mount", () => {
  it("transfers only to the same owner, Anima and exact revision", async () => {
    const prepared = mount();
    const dispose = vi.spyOn(prepared, "dispose");
    const consumed = vi.fn();
    offerCreationRuntime("owner", "anima", typed, prepared, consumed);
    expect(claimCreationRuntime("other", "anima", "exact-revision")).toBeNull();
    expect(claimCreationRuntime("owner", "anima", "changed")).toBeNull();
    const lease = claimCreationRuntime("owner", "anima", "exact-revision")!;
    expect(lease.mount).toBe(prepared);
    expect(consumed).toHaveBeenCalledTimes(1);
    lease.release();
    lease.release();
    await Promise.resolve();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
  it("survives synchronous React effect replay without releasing bytes or creating a second mount", async () => {
    const prepared = mount();
    const dispose = vi.spyOn(prepared, "dispose");
    const consumed = vi.fn();
    offerCreationRuntime("owner", "strict", typed, prepared, consumed);
    const first = claimCreationRuntime("owner", "strict", "exact-revision")!;
    first.release();
    const replay = claimCreationRuntime("owner", "strict", "exact-revision")!;
    await Promise.resolve();
    expect(dispose).not.toHaveBeenCalled();
    expect(replay.mount).toBe(first.mount);
    expect(consumed).toHaveBeenCalledTimes(1);
    replay.release();
    await Promise.resolve();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
  it("expires an abandoned handoff without deleting or recreating an Anima", () => {
    vi.useFakeTimers();
    const prepared = mount();
    const dispose = vi.spyOn(prepared, "dispose");
    const consumed = vi.fn();
    offerCreationRuntime("owner", "abandoned", typed, prepared, consumed);
    vi.advanceTimersByTime(60001);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(consumed).not.toHaveBeenCalled();
    expect(
      claimCreationRuntime("owner", "abandoned", "exact-revision"),
    ).toBeNull();
  });
});
