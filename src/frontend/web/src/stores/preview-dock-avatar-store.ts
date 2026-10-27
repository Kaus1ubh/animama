"use client";

import { create } from "zustand";

import type { Avatar } from "@/lib/avatar";

type PreviewDockAvatarState = {
  /** The preview dock's loaded Avatar, or null while none has loaded. */
  avatar: Avatar | null;
  /** The Avatar catalog item it shows, when the preview names one. */
  itemId: string | null;
};

/**
 * The Avatar the content preview dock shows, so Diagnostics for that Avatar
 * item can read it instead of loading another copy. The dock's scene sets it
 * once a load finishes and clears it when a load starts or the scene ends.
 */
export const usePreviewDockAvatarStore = create<PreviewDockAvatarState>(() => ({
  avatar: null,
  itemId: null,
}));

/** Publish the dock's loaded Avatar (`ContentPreviewScene`). */
export function registerPreviewDockAvatar(
  avatar: Avatar,
  itemId: string | null,
): void {
  usePreviewDockAvatarStore.setState({ avatar, itemId });
}

/** Withdraw the dock's Avatar, unless another has replaced it. */
export function unregisterPreviewDockAvatar(avatar: Avatar): void {
  if (usePreviewDockAvatarStore.getState().avatar !== avatar) return;
  usePreviewDockAvatarStore.setState({ avatar: null, itemId: null });
}
