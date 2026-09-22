import { useCallback, useRef, useState } from "react";
import {
  createDefaultSceneEffectDocument,
  sceneEffectDocumentFingerprint,
  sceneEffectEditorReducer,
  type SceneEffectEditorDocument,
  type SceneEffectEditorImageResource,
} from "@/lib/scene-vfx/editor";
import { useCreatorHistory } from "@/ui/creator-history/CreatorHistory";

export type SceneEffectHistorySnapshot = {
  document: SceneEffectEditorDocument;
  imageResources: SceneEffectEditorImageResource[];
};

/** Compare authored data and immutable File identities without serializing bytes. */
export function equalSceneEffectHistorySnapshots(
  left: SceneEffectHistorySnapshot,
  right: SceneEffectHistorySnapshot,
): boolean {
  return (
    sceneEffectDocumentFingerprint(left.document) ===
      sceneEffectDocumentFingerprint(right.document) &&
    left.imageResources.length === right.imageResources.length &&
    left.imageResources.every(
      (resource, index) =>
        resource.logicalName === right.imageResources[index]?.logicalName &&
        resource.sha256 === right.imageResources[index]?.sha256 &&
        resource.file === right.imageResources[index]?.file,
    )
  );
}

/** Keep document edits and their private image bytes in one undoable snapshot. */
export function useSceneEffectHistory() {
  const [initialValue] = useState<SceneEffectHistorySnapshot>(() => ({
    document: createDefaultSceneEffectDocument(),
    imageResources: [],
  }));
  const current = useRef(initialValue);
  const onApply = useCallback((value: SceneEffectHistorySnapshot) => {
    current.current = value;
  }, []);
  const history = useCreatorHistory({
    initialValue,
    onApply,
    equals: equalSceneEffectHistorySnapshots,
  });
  const { commit, reset } = history;
  const dispatch = useCallback(
    (
      action: Parameters<typeof sceneEffectEditorReducer>[1],
      imageResources: SceneEffectEditorImageResource[] = current.current
        .imageResources,
    ) => {
      commit({
        document: sceneEffectEditorReducer(current.current.document, action),
        imageResources,
      });
    },
    [commit],
  );
  const resetDocument = useCallback(
    (
      document: SceneEffectEditorDocument,
      imageResources: SceneEffectEditorImageResource[],
    ) => {
      const next = { document, imageResources };
      current.current = next;
      reset(next);
    },
    [reset],
  );
  const getSnapshot = useCallback(() => current.current, []);
  return { ...history.present, history, dispatch, resetDocument, getSnapshot };
}
