import { useCallback, useRef, useState } from "react";

import {
  useCreatorHistory,
  type CreatorHistoryController,
} from "./CreatorHistory";

export type CreatorDocumentHistory<T> = {
  /** The current snapshot, for rendering. */
  present: T;
  /** Undo, redo and grouping controls for the toolbar and shortcuts. */
  history: CreatorHistoryController<T>;
  /**
   * Commit one undoable edit derived from the latest snapshot. Reading the
   * latest snapshot, not the last render's, keeps rapid edits from dropping
   * each other.
   */
  update: (updater: (current: T) => T) => void;
  /** Install a new document (new, load, recovery) and clear undo and redo. */
  reset: (value: T) => void;
  /** The latest snapshot, including edits not yet rendered. */
  getSnapshot: () => T;
};

/**
 * Snapshot history for one creator document. A snapshot holds the authored
 * document together with any private resources it references (for example
 * image Files), so undo restores both at once.
 */
export function useCreatorDocumentHistory<T>({
  initialValue,
  equals,
}: {
  initialValue: T | (() => T);
  /** Value equality; equal commits create no undo step. */
  equals: (left: T, right: T) => boolean;
}): CreatorDocumentHistory<T> {
  const [initial] = useState(initialValue);
  const current = useRef(initial);
  const onApply = useCallback((value: T) => {
    current.current = value;
  }, []);
  const history = useCreatorHistory({ initialValue: initial, onApply, equals });
  const { commit, reset: resetHistory } = history;
  const update = useCallback(
    (updater: (value: T) => T) => commit(updater(current.current)),
    [commit],
  );
  const reset = useCallback(
    (value: T) => {
      current.current = value;
      resetHistory(value);
    },
    [resetHistory],
  );
  const getSnapshot = useCallback(() => current.current, []);
  return { present: history.present, history, update, reset, getSnapshot };
}
