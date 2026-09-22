import { renderToString } from "react-dom/server";
import { Object3D, PerspectiveCamera, type EventDispatcher } from "three";
import type { TransformControls } from "three-stdlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AvatarTransformControls } from "./AvatarTransformControls";

const harness = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  controls: [] as TransformControls[],
  state: {} as Record<string, unknown>,
}));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useMemo: (factory: () => unknown) => {
    const value = factory();
    if (value && typeof value === "object") {
      const control = "controls" in value ? value.controls : value;
      if (
        control &&
        typeof control === "object" &&
        "isTransformControls" in control
      ) {
        harness.controls.push(control as TransformControls);
      }
    }
    return value;
  },
  useEffect: (setup: () => void | (() => void)) => harness.effects.push(setup),
  useLayoutEffect: (setup: () => void | (() => void)) =>
    harness.effects.push(setup),
}));
vi.mock("@react-three/fiber", () => ({
  useThree: (selector?: (state: Record<string, unknown>) => unknown) =>
    selector ? selector(harness.state) : harness.state,
}));

/** Count real control listeners without requiring a WebGL renderer. */
class ListenerTarget extends EventTarget {
  listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) {
    if (listener) {
      const listeners = this.listeners.get(type) ?? new Set();
      listeners.add(listener);
      this.listeners.set(type, listeners);
    }
    super.addEventListener(type, listener, options);
  }

  override removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ) {
    if (listener) this.listeners.get(type)?.delete(listener);
    super.removeEventListener(type, listener, options);
  }

  get listenerCount() {
    return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0);
  }
}

let documentTarget: ListenerTarget;
let canvas: ListenerTarget & { ownerDocument: ListenerTarget };
let cleanups: Array<void | (() => void)> = [];
let orbit: { enabled: boolean };

function render(
  props: Partial<React.ComponentProps<typeof AvatarTransformControls>> = {},
) {
  harness.effects = [];
  renderToString(
    <AvatarTransformControls object={new Object3D()} {...props} />,
  );
  return harness.effects;
}

function flush(effects = harness.effects) {
  cleanups = effects.map((setup) => setup());
}

function cleanup() {
  cleanups.forEach((dispose) => dispose?.());
  cleanups = [];
}

function controlEvents() {
  return harness.controls.at(-1)! as unknown as EventDispatcher<
    Record<string, { value?: boolean }>
  >;
}

beforeEach(() => {
  documentTarget = new ListenerTarget();
  canvas = Object.assign(new ListenerTarget(), {
    ownerDocument: documentTarget,
  });
  orbit = { enabled: true };
  vi.stubGlobal("document", documentTarget);
  harness.controls = [];
  harness.effects = [];
  harness.state = {
    camera: new PerspectiveCamera(),
    gl: { domElement: canvas },
    events: {},
    controls: orbit,
    invalidate: vi.fn(),
    get: () => harness.state,
    set: (value: object) => Object.assign(harness.state, value),
  };
});

afterEach(() => {
  cleanup();
  // Dispose even the intentionally abandoned instances after a failing test.
  harness.controls.forEach((control) => control.dispose());
  vi.unstubAllGlobals();
});

describe("avatar transform control ownership", () => {
  it("does not register listeners from a render that never commits", () => {
    render();
    expect(documentTarget.listenerCount).toBe(0);
    expect(canvas.listenerCount).toBe(0);
  });

  it("releases listeners after repeated commits and StrictMode effect replay", () => {
    for (let cycle = 0; cycle < 3; cycle++) {
      render(); // Discarded render, as with development StrictMode.
      const effects = render();
      flush(effects);
      expect(documentTarget.listeners.get("pointerup")?.size).toBe(1);
      expect(canvas.listenerCount).toBe(2);
      cleanup();
      expect(documentTarget.listenerCount).toBe(0);
      expect(canvas.listenerCount).toBe(0);
      flush(effects); // StrictMode replays effects on the same committed instance.
      expect(documentTarget.listeners.get("pointerup")?.size).toBe(1);
      cleanup();
      expect(documentTarget.listenerCount).toBe(0);
      expect(canvas.listenerCount).toBe(0);
    }
  });

  it("forwards editing events and restores orbit controls when removed during a drag", () => {
    const onObjectChange = vi.fn();
    const onMouseDown = vi.fn();
    const onMouseUp = vi.fn();
    render({ onObjectChange, onMouseDown, onMouseUp });
    flush();
    const control = controlEvents();
    control.dispatchEvent({ type: "mouseDown" });
    control.dispatchEvent({ type: "objectChange" });
    control.dispatchEvent({ type: "mouseUp" });
    expect(onMouseDown).toHaveBeenCalledOnce();
    expect(onObjectChange).toHaveBeenCalledOnce();
    expect(onMouseUp).toHaveBeenCalledOnce();
    control.dispatchEvent({ type: "dragging-changed", value: true });
    expect(orbit.enabled).toBe(false);
    cleanup();
    expect(orbit.enabled).toBe(true);
    expect(documentTarget.listenerCount).toBe(0);
    control.dispatchEvent({ type: "objectChange" });
    expect(onObjectChange).toHaveBeenCalledOnce();
  });

  it("keeps an already-disabled orbit control disabled after dragging", () => {
    orbit.enabled = false;
    render();
    flush();
    const control = controlEvents();
    control.dispatchEvent({ type: "dragging-changed", value: true });
    control.dispatchEvent({ type: "dragging-changed", value: false });
    expect(orbit.enabled).toBe(false);
    cleanup();
    expect(orbit.enabled).toBe(false);
  });
});
