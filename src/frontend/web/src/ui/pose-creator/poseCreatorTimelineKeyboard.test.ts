import type { KeyboardEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseAnimaPoseClip } from "@/lib/avatar";
import { usePoseCreatorStore } from "@/stores/pose-creator-store";
import { handleTimelineDeleteKey } from "./poseCreatorTimelineKeyboard";

function keyEvent(key: string, overrides: Record<string, unknown> = {}) {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    defaultPrevented: false,
    nativeEvent: { isComposing: false },
    target: { closest: () => null },
    currentTarget: { focus: vi.fn() },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...overrides,
  } as unknown as KeyboardEvent<HTMLElement>;
}

beforeEach(() => {
  const store = usePoseCreatorStore.getState();
  store.resetWorkspace();
  store.hydrateClipDocument(
    parseAnimaPoseClip({
      schema: "animaPoseClip/2.0",
      id: "keyboard",
      name: "Keyboard",
      duration: 2,
      beats: [
        { id: "pose", label: "Pose", time: 0 },
        { id: "expression", label: "Expression", time: 1 },
      ],
      rotations: { head: [{ q: [0, 0, 0, 1], beat: "pose" }] },
      expressions: { happy: [{ v: 0.6, beat: "expression" }] },
      events: [
        { id: "avatar", kind: "avatar_vfx", time: 0.2, effectId: "sparkles" },
        {
          id: "scene",
          kind: "scene_vfx",
          time: 0.3,
          sceneKind: "background_layers",
          presetId: "stars",
        },
        {
          id: "particle",
          kind: "particle_vfx",
          time: 0.4,
          effectId: "confetti",
        },
        { id: "sound", kind: "sfx", time: 0.5, cueId: "chime" },
      ],
    }),
  );
});

describe("timeline delete keyboard shortcut", () => {
  it.each(["Delete", "Backspace"])(
    "%s deletes poses, expressions, and effects immediately with undo",
    (key) => {
      for (const selection of [
        "pose",
        "expression",
        "avatar",
        "scene",
        "particle",
        "sound",
      ]) {
        const store = usePoseCreatorStore.getState();
        const keyframe = store.clipDraft.keyframes.find(
          (frame) => frame.pose === selection,
        );
        if (keyframe) store.selectClipKeyframe(keyframe.id);
        else store.selectClipEvent(selection);
        const before = usePoseCreatorStore.getState().clipDraft;
        const event = keyEvent(key);
        handleTimelineDeleteKey(event);
        const after = usePoseCreatorStore.getState().clipDraft;
        if (keyframe)
          expect(
            after.keyframes.some((frame) => frame.id === keyframe.id),
          ).toBe(false);
        else
          expect(after.events.some((entry) => entry.id === selection)).toBe(
            false,
          );
        expect(event.preventDefault).toHaveBeenCalled();
        expect(event.currentTarget.focus).toHaveBeenCalled();
        store.undoClip();
        expect(usePoseCreatorStore.getState().clipDraft.keyframes).toEqual(
          before.keyframes,
        );
        expect(usePoseCreatorStore.getState().clipDraft.events).toEqual(
          before.events,
        );
        store.redoClip();
        expect(usePoseCreatorStore.getState().clipDraft.keyframes).toEqual(
          after.keyframes,
        );
        expect(usePoseCreatorStore.getState().clipDraft.events).toEqual(
          after.events,
        );
        store.undoClip();
      }
    },
  );

  it.each([
    { target: { closest: () => ({ tagName: "INPUT" }) } },
    { target: { closest: () => ({ tagName: "TEXTAREA" }) } },
    { target: { closest: () => ({ isContentEditable: true }) } },
    { ctrlKey: true },
    { metaKey: true },
    { altKey: true },
    { shiftKey: true },
    { defaultPrevented: true },
    { nativeEvent: { isComposing: true } },
    { key: "z" },
  ])("preserves editing and other shortcuts: %j", (override) => {
    const before = usePoseCreatorStore.getState().clipDraft;
    const event = keyEvent("Backspace", override);
    handleTimelineDeleteKey(event);
    expect(usePoseCreatorStore.getState().clipDraft).toBe(before);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("does not consume Delete when no item is selected", () => {
    const store = usePoseCreatorStore.getState();
    store.selectClipKeyframe(null);
    store.selectClipEvent(null);
    const event = keyEvent("Delete");
    handleTimelineDeleteKey(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
