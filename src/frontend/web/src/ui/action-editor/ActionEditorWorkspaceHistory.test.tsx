import { renderToString } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";

import { usePoseCreatorStore } from "@/stores/pose-creator-store";
import { useActionHistoryController } from "./ActionEditorWorkspace";

vi.mock("@/stores/pose-creator-store", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/stores/pose-creator-store")>();
  return {
    ...actual,
    usePoseCreatorStore: Object.assign(
      (
        selector: (
          state: ReturnType<typeof actual.usePoseCreatorStore.getState>,
        ) => unknown,
      ) => selector(actual.usePoseCreatorStore.getState()),
      actual.usePoseCreatorStore,
    ),
  };
});

it("uses pose Undo and Redo in standalone editing without changing the clip", () => {
  const store = usePoseCreatorStore.getState();
  store.resetWorkspace();
  store.setAuthoringMode("pose");
  store.setExpressionDraft("happy", { baseValue: 0, value: 0.6 });
  const clip = usePoseCreatorStore.getState().clipDraft;
  const documentHistory = {
    canUndo: true,
    canRedo: true,
    undo: vi.fn(),
    redo: vi.fn(),
  };
  let history: ReturnType<typeof useActionHistoryController> | undefined;
  function Probe() {
    history = useActionHistoryController(documentHistory, false);
    return null;
  }
  renderToString(<Probe />);
  expect(history!.canUndo).toBe(true);
  history!.undo();
  expect(usePoseCreatorStore.getState().expressionDrafts.happy).toBeUndefined();
  renderToString(<Probe />);
  expect(history!.canRedo).toBe(true);
  history!.redo();
  expect(usePoseCreatorStore.getState().expressionDrafts.happy?.value).toBe(
    0.6,
  );
  expect(usePoseCreatorStore.getState().clipDraft).toBe(clip);
  expect(documentHistory.undo).not.toHaveBeenCalled();
  expect(documentHistory.redo).not.toHaveBeenCalled();
});
afterEach(() => {
  vi.restoreAllMocks();
  usePoseCreatorStore.getState().resetWorkspace();
});
