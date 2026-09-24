import { useCallback, useRef, useState } from "react";
import {
  createDefaultAvatarEffectDocument,
  cloneAvatarEffectDocument,
  avatarEffectDocumentFingerprint,
  avatarEffectEditorReducer,
  type AvatarEffectEditorDocument,
  type AvatarEffectEditorImageResource,
} from "@/lib/avatar/vfx/editor";
import { useCreatorHistory } from "@/ui/creator-history/CreatorHistory";

export type AvatarEffectHistorySnapshot = {
  document: AvatarEffectEditorDocument;
  imageResource: AvatarEffectEditorImageResource | null;
};

/** Compare authored data and immutable File identities without serializing bytes. */
export function equalAvatarEffectHistorySnapshots(
  left: AvatarEffectHistorySnapshot,
  right: AvatarEffectHistorySnapshot,
): boolean {
  return (
    avatarEffectDocumentFingerprint(left.document) ===
      avatarEffectDocumentFingerprint(right.document) &&
    left.imageResource?.file === right.imageResource?.file &&
    left.imageResource?.sha256 === right.imageResource?.sha256
  );
}

/** Keep document edits and their private image bytes in one undoable snapshot. */
export function useAvatarEffectHistory() {
  const [initialValue] = useState<AvatarEffectHistorySnapshot>(() => ({
    document: createDefaultAvatarEffectDocument(),
    imageResource: null,
  }));
  const current = useRef(initialValue);
  const onApply = useCallback((value: AvatarEffectHistorySnapshot) => {
    current.current = value;
  }, []);
  const history = useCreatorHistory({
    initialValue,
    onApply,
    equals: equalAvatarEffectHistorySnapshots,
  });
  const { commit, reset } = history;
  const dispatch = useCallback(
    (
      action: Parameters<typeof avatarEffectEditorReducer>[1],
      imageResource: AvatarEffectEditorImageResource | null = current.current
        .imageResource,
    ) => {
      commit({
        document: avatarEffectEditorReducer(current.current.document, action),
        imageResource,
      });
    },
    [commit],
  );
  const resetDocument = useCallback(
    (
      document: AvatarEffectEditorDocument,
      imageResource: AvatarEffectEditorImageResource | null,
    ) => {
      const next = {
        document: cloneAvatarEffectDocument(document),
        imageResource,
      };
      current.current = next;
      reset(next);
    },
    [reset],
  );
  const getSnapshot = useCallback(() => current.current, []);
  return { ...history.present, history, dispatch, resetDocument, getSnapshot };
}
