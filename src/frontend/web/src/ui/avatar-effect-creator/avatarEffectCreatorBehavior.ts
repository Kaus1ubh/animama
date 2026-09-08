export type AvatarEffectCreatorKeyboardAction =
  | "save"
  | "toggle-preview"
  | null;

export function avatarEffectCreatorKeyboardAction(args: {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  editing: boolean;
}): AvatarEffectCreatorKeyboardAction {
  if ((args.metaKey || args.ctrlKey) && args.key.toLowerCase() === "s")
    return "save";
  if (!args.editing && args.code === "Space") return "toggle-preview";
  return null;
}

export function shouldBlockAvatarEffectNavigation(args: {
  dirty: boolean;
  busy: boolean;
  currentPath: string;
  nextPath: string;
}): boolean {
  return (args.dirty || args.busy) && args.currentPath !== args.nextPath;
}

export const AVATAR_EFFECT_PREVIEW_MOTION_CLASS =
  "motion-safe:animate-pulse motion-reduce:animate-none";

/**
 * Report compatibility only after an attempted effect application settles.
 * Clearing the controller before an async image load must remain a loading
 * state rather than briefly claiming that the Avatar is incompatible.
 */
export function avatarEffectPreviewCompatibility(args: {
  playing: boolean;
  hasController: boolean;
  hasEffect: boolean;
  applySettled: boolean;
  activeEffectCount: number;
}): boolean | null {
  if (!args.playing || !args.hasController || !args.hasEffect) return null;
  if (args.activeEffectCount > 0) return true;
  return args.applySettled ? false : null;
}

export function createAvatarEffectObjectUrlLease(
  file: File,
  api: Pick<typeof URL, "createObjectURL" | "revokeObjectURL"> = URL,
): { url: string; dispose: () => void } {
  const url = api.createObjectURL(file);
  let disposed = false;
  return {
    url,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      api.revokeObjectURL(url);
    },
  };
}
