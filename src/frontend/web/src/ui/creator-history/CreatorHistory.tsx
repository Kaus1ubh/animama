"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getI18n } from "react-i18next";

export type CreatorHistoryController<T> = {
  canUndo: boolean;
  canRedo: boolean;
  present: T;
  commit: (value: T) => void;
  reset: (value: T) => void;
  replacePresent: (value: T) => void;
  beginGroup: () => void;
  endGroup: () => void;
  undo: () => void;
  redo: () => void;
};

export type CreatorHistoryState<T> = {
  past: T[];
  present: T;
  future: T[];
  groupDepth: number;
  groupStart: T | null;
};

/** Format the discoverable history labels used by desktop and web creators. */
export function getCreatorHistoryShortcutLabels(
  os: string | null = null,
  browserPlatformHint = typeof navigator === "undefined"
    ? ""
    : `${navigator.platform} ${navigator.userAgent}`,
): { undo: string; redo: string } {
  const platform = `${os ?? ""} ${browserPlatformHint}`.toLowerCase();
  const apple = /darwin|mac|iphone|ipad|ipod/.test(platform);
  // Key names stay as the OS shows them; only the alternative is worded.
  const t = getI18n().getFixedT(null, "actionEditor");
  return apple
    ? { undo: "⌘Z", redo: "⇧⌘Z" }
    : {
        undo: "Ctrl+Z",
        redo: t("history.eitherShortcut", {
          shortcuts: ["Ctrl+Shift+Z", "Ctrl+Y"],
        }),
      };
}

export function createCreatorHistoryState<T>(value: T): CreatorHistoryState<T> {
  return {
    past: [],
    present: value,
    future: [],
    groupDepth: 0,
    groupStart: null,
  };
}

export function commitCreatorHistory<T>(
  current: CreatorHistoryState<T>,
  value: T,
  equals: (left: T, right: T) => boolean,
  limit = 50,
): CreatorHistoryState<T> {
  if (equals(current.present, value)) return current;
  if (current.groupDepth > 0) return { ...current, present: value, future: [] };
  return {
    ...current,
    past: [...current.past, current.present].slice(-limit),
    present: value,
    future: [],
  };
}

export function beginCreatorHistoryGroup<T>(
  current: CreatorHistoryState<T>,
): CreatorHistoryState<T> {
  return {
    ...current,
    groupDepth: current.groupDepth + 1,
    groupStart: current.groupDepth === 0 ? current.present : current.groupStart,
  };
}

export function endCreatorHistoryGroup<T>(
  current: CreatorHistoryState<T>,
  equals: (left: T, right: T) => boolean,
  limit = 50,
): CreatorHistoryState<T> {
  if (current.groupDepth === 0) return current;
  if (current.groupDepth > 1)
    return { ...current, groupDepth: current.groupDepth - 1 };
  const start = current.groupStart;
  return {
    ...current,
    past:
      start !== null && !equals(start, current.present)
        ? [...current.past, start].slice(-limit)
        : current.past,
    groupDepth: 0,
    groupStart: null,
  };
}

export function undoCreatorHistory<T>(
  current: CreatorHistoryState<T>,
): CreatorHistoryState<T> {
  if (current.past.length === 0 || current.groupDepth > 0) return current;
  const previous = current.past.at(-1);
  if (previous === undefined) return current;
  return {
    ...current,
    past: current.past.slice(0, -1),
    present: previous,
    future: [current.present, ...current.future],
  };
}

export function redoCreatorHistory<T>(
  current: CreatorHistoryState<T>,
  limit = 50,
): CreatorHistoryState<T> {
  if (current.future.length === 0 || current.groupDepth > 0) return current;
  const next = current.future[0];
  if (next === undefined) return current;
  return {
    ...current,
    past: [...current.past, current.present].slice(-limit),
    present: next,
    future: current.future.slice(1),
  };
}

function isEditableHistoryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest(
      'input, textarea, select, [contenteditable=""], [contenteditable="true"]',
    ),
  );
}

function historyKeyboardAction(
  event: Pick<
    KeyboardEvent,
    "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey"
  >,
): "undo" | "redo" | null {
  if (event.altKey || (!event.ctrlKey && !event.metaKey)) return null;
  const key = event.key.toLowerCase();
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  if (key === "y" && event.ctrlKey && !event.shiftKey) return "redo";
  return null;
}

/** Generic grouped snapshot history for creator documents. */
export function useCreatorHistory<T>({
  initialValue,
  onApply,
  equals = Object.is,
  limit = 50,
}: {
  initialValue: T;
  onApply: (value: T) => void;
  equals?: (left: T, right: T) => boolean;
  limit?: number;
}): CreatorHistoryController<T> {
  const [state, setState] = useState<CreatorHistoryState<T>>({
    ...createCreatorHistoryState(initialValue),
  });
  const stateRef = useRef(state);
  stateRef.current = state;

  const applyState = useCallback(
    (next: CreatorHistoryState<T>, apply = true) => {
      stateRef.current = next;
      setState(next);
      if (apply) onApply(next.present);
    },
    [onApply],
  );

  const commit = useCallback(
    (value: T) => {
      const current = stateRef.current;
      applyState(commitCreatorHistory(current, value, equals, limit));
    },
    [applyState, equals, limit],
  );

  // Save normalization updates the current snapshot without creating an edit or
  // discarding the session's undo/redo steps.
  const replacePresent = useCallback(
    (value: T) => {
      applyState({ ...stateRef.current, present: value });
    },
    [applyState],
  );

  const reset = useCallback(
    (value: T) => {
      applyState(
        {
          past: [],
          present: value,
          future: [],
          groupDepth: 0,
          groupStart: null,
        },
        false,
      );
    },
    [applyState],
  );

  const beginGroup = useCallback(() => {
    const current = stateRef.current;
    applyState(beginCreatorHistoryGroup(current), false);
  }, [applyState]);

  const endGroup = useCallback(() => {
    const current = stateRef.current;
    applyState(endCreatorHistoryGroup(current, equals, limit), false);
  }, [applyState, equals, limit]);

  const undo = useCallback(() => {
    const current = stateRef.current;
    applyState(undoCreatorHistory(current));
  }, [applyState]);

  const redo = useCallback(() => {
    const current = stateRef.current;
    applyState(redoCreatorHistory(current, limit));
  }, [applyState, limit]);

  return useMemo(
    () => ({
      canUndo: state.groupDepth === 0 && state.past.length > 0,
      canRedo: state.groupDepth === 0 && state.future.length > 0,
      present: state.present,
      commit,
      reset,
      replacePresent,
      beginGroup,
      endGroup,
      undo,
      redo,
    }),
    [beginGroup, commit, endGroup, redo, reset, replacePresent, state, undo],
  );
}

/** Provider-independent keyboard shortcut shared by present and future creators. */
export function CreatorHistoryShortcut({
  controller,
  isBusy,
}: {
  controller: Pick<
    CreatorHistoryController<unknown>,
    "canRedo" | "canUndo" | "redo" | "undo"
  >;
  isBusy: boolean;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const action = historyKeyboardAction(event);
      if (!action || isBusy || isEditableHistoryTarget(event.target)) return;
      const canApply =
        action === "undo" ? controller.canUndo : controller.canRedo;
      if (!canApply) return;
      event.preventDefault();
      if (action === "undo") controller.undo();
      else controller.redo();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [controller, isBusy]);
  return null;
}

export { historyKeyboardAction, isEditableHistoryTarget };
