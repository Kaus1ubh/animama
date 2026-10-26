// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SHINE_PAUSED_ATTRIBUTE,
  usePauseShineWhileInactive,
} from "./usePauseShineWhileInactive";

function Probe({ pipActive }: { pipActive: boolean }) {
  usePauseShineWhileInactive(pipActive);
  return null;
}

let container: HTMLDivElement;
let root: Root;
let focused = true;
const paused = () =>
  document.documentElement.hasAttribute(SHINE_PAUSED_ATTRIBUTE);

describe("usePauseShineWhileInactive", () => {
  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    focused = true;
    vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("pauses while the window is unfocused and resumes on focus", () => {
    act(() => root.render(<Probe pipActive={false} />));
    expect(paused()).toBe(false);
    focused = false;
    act(() => window.dispatchEvent(new Event("blur")));
    expect(paused()).toBe(true);
    focused = true;
    act(() => window.dispatchEvent(new Event("focus")));
    expect(paused()).toBe(false);
  });

  it("pauses while PiP is open, even with the window focused", () => {
    act(() => root.render(<Probe pipActive />));
    expect(paused()).toBe(true);
    act(() => root.render(<Probe pipActive={false} />));
    expect(paused()).toBe(false);
  });

  it("clears the mark on unmount", () => {
    act(() => root.render(<Probe pipActive />));
    act(() => root.unmount());
    root = createRoot(container);
    expect(paused()).toBe(false);
  });
});
