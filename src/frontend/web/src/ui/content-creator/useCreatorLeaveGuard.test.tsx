import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import {
  shouldBlockCreatorNavigation,
  useCreatorLeaveGuard,
  type CreatorLeaveGuard,
  type CreatorLeaveLocation,
} from "./useCreatorLeaveGuard";

const router = vi.hoisted(() => ({
  options: null as null | {
    shouldBlockFn: (args: {
      current: CreatorLeaveLocation;
      next: CreatorLeaveLocation;
    }) => boolean;
    enableBeforeUnload: () => boolean;
  },
  proceed: vi.fn(),
  reset: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useBlocker: (options: typeof router.options) => {
    router.options = options;
    return {
      status: "blocked",
      proceed: router.proceed,
      reset: router.reset,
    };
  },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

function mount(args: Parameters<typeof useCreatorLeaveGuard>[0]) {
  let guard!: CreatorLeaveGuard;
  function Harness() {
    guard = useCreatorLeaveGuard(args);
    return null;
  }
  renderToString(<Harness />);
  return guard;
}

const at = (pathname: string, search: object = {}) => ({ pathname, search });

describe("creator leave guard", () => {
  beforeEach(() => {
    router.options = null;
  });

  it("blocks leaving a dirty or saving creator, not staying on its route", () => {
    for (const state of [
      { dirty: true, busy: false },
      { dirty: false, busy: true },
    ]) {
      expect(
        shouldBlockCreatorNavigation({
          ...state,
          current: at("/avatar-effects/new"),
          next: at("/library"),
        }),
      ).toBe(true);
    }
    expect(
      shouldBlockCreatorNavigation({
        dirty: false,
        busy: false,
        current: at("/avatar-effects/new"),
        next: at("/library"),
      }),
    ).toBe(false);
    expect(
      shouldBlockCreatorNavigation({
        dirty: true,
        busy: false,
        current: at("/scene-effects/item/edit", { tab: "a" }),
        next: at("/scene-effects/item/edit", { tab: "b" }),
      }),
    ).toBe(false);
  });

  it("treats a different starting point on a /new route as leaving", () => {
    const block = (current: object, next: object) =>
      shouldBlockCreatorNavigation({
        dirty: true,
        busy: false,
        current: at("/avatar-effects/new", current),
        next: at("/avatar-effects/new", next),
      });

    expect(block({ template: "a" }, { template: "b" })).toBe(true);
    expect(block({}, { template: "a" })).toBe(true);
    expect(block({ template: "a" }, { template: "a" })).toBe(false);
    expect(block({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(false);
    expect(block({ template: undefined }, {})).toBe(false);
  });

  it("wires the router blocker and unload prompt to the creator state", () => {
    mount({ dirty: true, busy: false, discard: async () => true });
    expect(router.options?.enableBeforeUnload()).toBe(true);
    expect(
      router.options?.shouldBlockFn({
        current: at("/particle-effects/new"),
        next: at("/library"),
      }),
    ).toBe(true);
    mount({ dirty: false, busy: false, discard: async () => true });
    expect(router.options?.enableBeforeUnload()).toBe(false);
  });

  it("discards before continuing, and stays when discarding fails", async () => {
    const discard = vi.fn(async () => true);
    const guard = mount({ dirty: true, busy: false, discard });
    expect(guard.blocked).toBe(true);
    await guard.leave();
    expect(discard).toHaveBeenCalledOnce();
    expect(router.proceed).toHaveBeenCalledOnce();

    router.proceed.mockClear();
    const failing = mount({
      dirty: true,
      busy: false,
      discard: async () => {
        throw new Error("Browser recovery could not be discarded.");
      },
    });
    await failing.leave();
    expect(router.proceed).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "Browser recovery could not be discarded.",
    );
    failing.stay();
    expect(router.reset).toHaveBeenCalledOnce();
  });

  it("leaves a saving creator without discarding its recovery", async () => {
    const discard = vi.fn(async () => true);
    const guard = mount({ dirty: true, busy: true, discard });
    await guard.leave();
    expect(discard).not.toHaveBeenCalled();
    expect(router.proceed).toHaveBeenCalledOnce();
  });
});
