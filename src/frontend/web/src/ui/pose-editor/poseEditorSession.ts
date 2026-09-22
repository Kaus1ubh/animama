import type { PyPose } from "@animama/runtime-contracts/api-types";
import { usePoseCreatorStore } from "@/stores/pose-creator-store";
import { editActionEditorSavedPose } from "@/ui/action-editor/actionEditorSavedPose";

/** Fence route loads independently of Query refreshes and canonical Save navigation. */
export class PoseEditorSession {
  private itemId: string | null = null;
  private loaded = false;
  private generation = 0;
  private pending: Promise<boolean> | null = null;

  activate(itemId: string): void {
    if (this.itemId === itemId) return;
    this.cancelPending();
    this.itemId = itemId;
    this.loaded = false;
    const state = usePoseCreatorStore.getState();
    state.cancelClipInlinePoseEdit();
    state.startNewPose();
    state.setAuthoringMode("pose");
  }

  isLoaded(itemId: string): boolean {
    return this.itemId === itemId && this.loaded;
  }

  /** A successful Save/Load has already supplied this exact editor document. */
  adoptSavedItem(itemId: string): void {
    this.cancelPending();
    this.itemId = itemId;
    this.loaded = true;
  }

  cancelPending(): void {
    this.generation += 1;
    this.pending = null;
  }

  async load(item: PyPose): Promise<boolean> {
    if (item.item_id !== this.itemId) return false;
    if (this.loaded) return true;
    if (this.pending) return this.pending;
    const generation = this.generation;
    const isCurrent = () =>
      generation === this.generation && item.item_id === this.itemId;
    const pending = editActionEditorSavedPose(item, { isCurrent })
      .then((loaded) => {
        if (!isCurrent()) return false;
        this.loaded = loaded;
        return loaded;
      })
      .finally(() => {
        if (isCurrent()) this.pending = null;
      });
    this.pending = pending;
    return pending;
  }
}
