// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSearchDraft } from "./useSearchDraft";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLElement;
const commits: Array<string | undefined> = [];
const view: {
  draft: string;
  type: (value: string) => void;
  navigate: (value: string | undefined) => void;
} = { draft: "", type: () => {}, navigate: () => {} };

/** A search box whose committed query lives in parent state, as in the URL. */
function Harness() {
  const [committed, setCommitted] = useState<string | undefined>("air");
  const [draft, setDraft] = useSearchDraft(committed, (query) => {
    commits.push(query);
    setCommitted(query);
  });
  view.draft = draft;
  view.type = setDraft;
  view.navigate = setCommitted;
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  commits.length = 0;
  container = document.createElement("div");
  root = createRoot(container);
  act(() => root.render(<Harness />));
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

describe("Library search draft", () => {
  it("keeps a typed space and commits the trimmed query after typing pauses", () => {
    act(() => view.type("air "));
    act(() => vi.advanceTimersByTime(300));
    expect(view.draft).toBe("air ");
    expect(commits).toEqual([]);

    act(() => view.type("air guitar"));
    expect(commits).toEqual([]);
    act(() => vi.advanceTimersByTime(300));
    expect(commits).toEqual(["air guitar"]);
    expect(view.draft).toBe("air guitar");
  });

  it("follows a query changed elsewhere, such as Back", () => {
    act(() => view.navigate("wave"));
    expect(view.draft).toBe("wave");
    act(() => view.navigate(undefined));
    expect(view.draft).toBe("");
    act(() => vi.advanceTimersByTime(300));
    expect(commits).toEqual([]);
  });
});
