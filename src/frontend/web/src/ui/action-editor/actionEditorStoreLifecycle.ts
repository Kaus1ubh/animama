type ResetWorkspace = () => void;

let activeWorkspaces = 0;
let pendingReset: ReturnType<typeof setTimeout> | null = null;

/**
 * Retain the shared pose/timeline store across an immediate creator-route
 * handoff, while still disposing it after the final editor has unmounted.
 */
export function retainActionEditorWorkspace(
  resetWorkspace: ResetWorkspace,
): () => void {
  activeWorkspaces += 1;
  if (pendingReset !== null) {
    clearTimeout(pendingReset);
    pendingReset = null;
  }

  return () => {
    activeWorkspaces = Math.max(0, activeWorkspaces - 1);
    if (activeWorkspaces > 0) return;
    pendingReset = setTimeout(() => {
      pendingReset = null;
      if (activeWorkspaces === 0) resetWorkspace();
    }, 0);
  };
}
