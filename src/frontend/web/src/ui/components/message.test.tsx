// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Motion drives every animation from requestAnimationFrame, which a hidden
 * window (another macOS Space, a background tab) stops calling. Hold frames
 * while `hidden` is set, as Chromium does, and replay them when it clears.
 * Motion reads the global once, so this must run before it is imported.
 */
const frames = vi.hoisted(() => {
  const native = globalThis.requestAnimationFrame.bind(globalThis);
  const held: FrameRequestCallback[] = [];
  const control = {
    hidden: false,
    show() {
      control.hidden = false;
      for (const callback of held.splice(0)) native(callback);
    },
  };
  globalThis.requestAnimationFrame = (callback) => {
    if (!control.hidden) return native(callback);
    held.push(callback);
    return 0;
  };
  return control;
});

const { MessageContent } = await import("./message");

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  frames.hidden = false;
});

function render(animateOnEnter: boolean) {
  act(() =>
    root!.render(
      <MessageContent animateOnEnter={animateOnEnter}>reply</MessageContent>,
    ),
  );
}

/** The bubble's background and text layers. */
function layers(container: HTMLElement) {
  const [background, foreground] = Array.from(
    container.firstElementChild!.children,
  ) as HTMLElement[];
  return { background: background!, foreground: foreground! };
}

/** Let the 0.42 s entrance finish on real frames. */
const settle = () =>
  act(() => new Promise((resolve) => setTimeout(resolve, 800)));

describe("MessageContent entrance", () => {
  it("ends fully shown after an ordinary entrance", async () => {
    const container = document.createElement("div");
    root = createRoot(container);
    render(true);
    await settle();
    const { background, foreground } = layers(container);
    expect(foreground.style.opacity).toBe("1");
    expect(background.style.opacity).toBe("1");
    expect(background.style.transform).not.toMatch(/scale\(0/);
  });

  it("ends fully shown when its turn finished while the window was hidden", async () => {
    const container = document.createElement("div");
    root = createRoot(container);
    frames.hidden = true;
    // A streamed bubble mounts with its entrance, then the finished turn
    // replaces it with the saved message under the same key.
    render(true);
    render(false);
    frames.show();
    await settle();
    const { background, foreground } = layers(container);
    expect(foreground.style.opacity).toBe("1");
    expect(background.style.opacity).toBe("1");
    expect(background.style.transform).not.toMatch(/scale\(0/);
  });
});
