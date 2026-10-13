import { describe, expect, it } from "vitest";

import {
  getPoseCreatorHistoryKeyboardAction,
  isPoseCreatorNativeUndoTarget,
  isPoseCreatorUndoKeyboardEvent,
} from "./poseCreatorUndo";

describe("Pose Creator history shortcuts", () => {
  it("accepts the standard macOS and Windows/Linux shortcuts", () => {
    expect(
      isPoseCreatorUndoKeyboardEvent({
        key: "z",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      }),
    ).toBe(true);
    expect(
      isPoseCreatorUndoKeyboardEvent({
        key: "Z",
        metaKey: false,
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
      }),
    ).toBe(true);
  });

  it("recognizes Shift+Cmd/Ctrl+Z and Ctrl+Y as Redo", () => {
    expect(
      getPoseCreatorHistoryKeyboardAction({
        key: "z",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: true,
      }),
    ).toBe("redo");
    expect(
      getPoseCreatorHistoryKeyboardAction({
        key: "Z",
        metaKey: false,
        ctrlKey: true,
        altKey: false,
        shiftKey: true,
      }),
    ).toBe("redo");
    expect(
      getPoseCreatorHistoryKeyboardAction({
        key: "y",
        metaKey: false,
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
      }),
    ).toBe("redo");
  });

  it("classifies standard Undo and rejects unrelated modifiers", () => {
    expect(
      getPoseCreatorHistoryKeyboardAction({
        key: "z",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      }),
    ).toBe("undo");
    expect(
      getPoseCreatorHistoryKeyboardAction({
        key: "z",
        metaKey: true,
        ctrlKey: false,
        altKey: true,
        shiftKey: true,
      }),
    ).toBeNull();
  });

  it("rejects Redo and unrelated modified shortcuts", () => {
    expect(
      isPoseCreatorUndoKeyboardEvent({
        key: "z",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: true,
      }),
    ).toBe(false);
    expect(
      isPoseCreatorUndoKeyboardEvent({
        key: "z",
        metaKey: false,
        ctrlKey: true,
        altKey: true,
        shiftKey: false,
      }),
    ).toBe(false);
    expect(
      isPoseCreatorUndoKeyboardEvent({
        key: "y",
        metaKey: false,
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
      }),
    ).toBe(false);
  });

  it("preserves native undo for editable targets and their descendants", () => {
    const editableTarget = {
      closest: (selector: string) =>
        selector.includes("textarea") ? editableTarget : null,
    } as unknown as EventTarget;
    const nonEditableTarget = {
      closest: () => null,
    } as unknown as EventTarget;

    expect(isPoseCreatorNativeUndoTarget(editableTarget)).toBe(true);
    expect(isPoseCreatorNativeUndoTarget(nonEditableTarget)).toBe(false);
    expect(isPoseCreatorNativeUndoTarget(null)).toBe(false);
  });
});
