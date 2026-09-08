import { describe, expect, it } from "vitest";

import {
  beginCreatorHistoryGroup,
  commitCreatorHistory,
  createCreatorHistoryState,
  endCreatorHistoryGroup,
  getCreatorHistoryShortcutLabels,
  historyKeyboardAction,
  redoCreatorHistory,
  undoCreatorHistory,
} from "./CreatorHistory";

describe("creator history shortcuts", () => {
  it("recognizes undo and redo keys", () => {
    expect(
      historyKeyboardAction({
        altKey: false,
        ctrlKey: true,
        key: "z",
        metaKey: false,
        shiftKey: false,
      }),
    ).toBe("undo");
    expect(
      historyKeyboardAction({
        altKey: false,
        ctrlKey: true,
        key: "z",
        metaKey: false,
        shiftKey: true,
      }),
    ).toBe("redo");
  });

  it("groups a drag into one undoable snapshot and preserves redo", () => {
    const equals = (left: number, right: number) => left === right;
    let state = beginCreatorHistoryGroup(createCreatorHistoryState(0));
    state = commitCreatorHistory(state, 1, equals);
    state = commitCreatorHistory(state, 2, equals);
    state = endCreatorHistoryGroup(state, equals);
    expect(state.past).toEqual([0]);
    state = undoCreatorHistory(state);
    expect(state.present).toBe(0);
    state = redoCreatorHistory(state);
    expect(state.present).toBe(2);
  });
});

describe("creator history shortcut labels", () => {
  it("uses Apple labels for macOS", () => {
    expect(getCreatorHistoryShortcutLabels("darwin", "")).toEqual({
      undo: "⌘Z",
      redo: "⇧⌘Z",
    });
  });

  it("includes both supported redo forms on Windows", () => {
    expect(getCreatorHistoryShortcutLabels("win32", "")).toEqual({
      undo: "Ctrl+Z",
      redo: "Ctrl+Shift+Z or Ctrl+Y",
    });
  });
});
