// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ItemRevisionRef } from "@animama/runtime-contracts/api-types";

import {
  CreationPortraits,
  useCreationPortraitCapture,
} from "./createAnimaPortrait";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const target: ItemRevisionRef = {
  item_id: "avatar-1",
  revision_sha256: "a".repeat(64),
};

type Props = Parameters<typeof useCreationPortraitCapture>[0];

function Probe(props: Props) {
  useCreationPortraitCapture(props);
  return null;
}

const container = document.createElement("div");
let root = createRoot(container);

afterEach(() => {
  act(() => root.unmount());
  root = createRoot(container);
});

function setup(overrides: Partial<Props> = {}) {
  const portraits = new CreationPortraits();
  const generate = vi.spyOn(portraits, "generate").mockResolvedValue("saved");
  const props: Props = {
    ready: true,
    source: target,
    target,
    capture: vi.fn(),
    save: vi.fn(),
    portraits,
    ...overrides,
  };
  act(() => root.render(<Probe {...props} />));
  return { generate, props };
}

describe("useCreationPortraitCapture", () => {
  it("starts one background attempt when the targeted Avatar is on the stage", () => {
    const { generate, props } = setup();
    act(() => root.render(<Probe {...props} source={{ ...target }} />));

    expect(generate).toHaveBeenCalledOnce();
    expect(generate.mock.calls[0][0]).toMatchObject({
      target,
      capture: props.capture,
      save: props.save,
    });
  });

  it.each([
    ["the Avatar is still loading", { ready: false }],
    ["nothing needs a portrait", { target: null }],
    [
      "the stage shows another Avatar",
      { source: { ...target, item_id: "other" } },
    ],
    ["there is no save", { save: undefined }],
  ])("waits while %s", (_name, overrides) => {
    expect(setup(overrides).generate).not.toHaveBeenCalled();
  });

  it("re-renders with an equal target object do not restart the attempt", () => {
    const { generate, props } = setup();
    act(() => root.render(<Probe {...props} target={{ ...target }} />));

    expect(generate).toHaveBeenCalledOnce();
    expect(generate.mock.calls[0][0].signal.aborted).toBe(false);
  });

  it("never holds up the stage while the attempt is pending", () => {
    const { generate, props } = setup();
    generate.mockReturnValue(new Promise(() => undefined));
    const next = vi.fn();
    function Next() {
      next();
      return null;
    }

    // Moving on (another step, a submission, leaving) renders and unmounts
    // straight away; the pending attempt is only abandoned.
    act(() =>
      root.render(
        <>
          <Probe {...props} ready={false} />
          <Next />
        </>,
      ),
    );
    expect(next).toHaveBeenCalled();
    expect(generate.mock.calls[0][0].signal.aborted).toBe(true);
  });

  it("waits for a hidden page to be shown before starting", () => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    try {
      const { generate } = setup();
      expect(generate).not.toHaveBeenCalled();

      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: false,
      });
      act(() => document.dispatchEvent(new Event("visibilitychange")));
      expect(generate).toHaveBeenCalledOnce();
    } finally {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: false,
      });
    }
  });

  it("abandons the attempt when the stage unmounts or the page is hidden", () => {
    const { generate } = setup();
    const signal = generate.mock.calls[0][0].signal;
    expect(signal.aborted).toBe(false);

    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(signal.aborted).toBe(true);
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });

    const second = setup();
    const next = second.generate.mock.calls[0][0].signal;
    act(() => root.unmount());
    root = createRoot(container);
    expect(next.aborted).toBe(true);
  });
});
