import { useCallback, useRef } from "react";

import type { ParticleVFXEditorDraft } from "@/lib/avatar/particle-vfx";
import { useCreatorHistory } from "@/ui/creator-history/CreatorHistory";
import { particleVFXDocumentFingerprint } from "./particleVFXDocument";

const draftsEqual = (
  left: ParticleVFXEditorDraft,
  right: ParticleVFXEditorDraft,
) =>
  particleVFXDocumentFingerprint(left) ===
  particleVFXDocumentFingerprint(right);

/** Authoring-only history; preview and emitter selection remain route state. */
export function useParticleVFXHistory(initialDraft: ParticleVFXEditorDraft) {
  const current = useRef(initialDraft);
  const apply = useCallback((next: ParticleVFXEditorDraft) => {
    current.current = next;
  }, []);
  const history = useCreatorHistory({
    initialValue: initialDraft,
    onApply: apply,
    equals: draftsEqual,
  });
  const { commit, reset } = history;
  const updateDraft = useCallback(
    (updater: (value: ParticleVFXEditorDraft) => ParticleVFXEditorDraft) => {
      commit(updater(current.current));
    },
    [commit],
  );
  const resetDraft = useCallback(
    (next: ParticleVFXEditorDraft) => {
      apply(next);
      reset(next);
    },
    [apply, reset],
  );
  const getSnapshot = useCallback(() => current.current, []);
  return {
    draft: history.present,
    history,
    updateDraft,
    resetDraft,
    getSnapshot,
  };
}
