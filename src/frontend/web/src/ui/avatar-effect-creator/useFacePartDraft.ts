import { useState } from "react";

import type { AvatarFacePartRole } from "@/lib/avatar/vfx/faceParts";
import type { FacePartDraft } from "./facePartsPanel";

/**
 * The Face parts panel's unsaved edits. A draft belongs to one Avatar file
 * (`scope`: its catalog item and VRM digest); another item or VRM starts
 * over, so one Avatar's mesh parts are never saved into another's correction.
 * A null scope (an Avatar still loading) keeps the current draft.
 */
export function useFacePartDraft(
  scope: string | null,
  pickedSequence: number | null,
) {
  const [editing, setEditing] = useState<AvatarFacePartRole | null>(null);
  const [draft, setDraft] = useState<FacePartDraft>({});
  const [lastPick, setLastPick] = useState<number | null>(pickedSequence);
  const [error, setError] = useState<string | null>(null);
  const [draftScope, setDraftScope] = useState(scope);
  if (scope !== null && scope !== draftScope) {
    setDraftScope(scope);
    setDraft({});
    setEditing(null);
    setError(null);
    // A pick made on the previous Avatar is not applied to this one.
    setLastPick(pickedSequence);
  }
  return {
    editing,
    setEditing,
    draft,
    setDraft,
    lastPick,
    setLastPick,
    error,
    setError,
  };
}
