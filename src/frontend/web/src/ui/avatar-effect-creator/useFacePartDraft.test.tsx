// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { useFacePartDraft } from "./useFacePartDraft";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("face part draft", () => {
  it("starts over for another Avatar and keeps the draft while one loads", () => {
    let state!: ReturnType<typeof useFacePartDraft>;
    function Harness({ scope }: { scope: string | null }) {
      state = useFacePartDraft(scope, 3);
      return null;
    }
    const root = createRoot(document.createElement("div"));
    act(() => root.render(<Harness scope="annie:aaa" />));
    act(() => {
      state.setEditing("eyelash");
      state.setDraft({ eyelash: ["91:0:4"] });
    });
    // The model reloads (no digest yet): nothing is lost.
    act(() => root.render(<Harness scope={null} />));
    expect(state.draft).toEqual({ eyelash: ["91:0:4"] });
    act(() => root.render(<Harness scope="annie:aaa" />));
    expect(state.draft).toEqual({ eyelash: ["91:0:4"] });
    // Another Avatar: the draft and the editor are cleared.
    act(() => root.render(<Harness scope="caitlyn:bbb" />));
    expect(state.draft).toEqual({});
    expect(state.editing).toBeNull();
    expect(state.lastPick).toBe(3);
    act(() => root.unmount());
  });
});
