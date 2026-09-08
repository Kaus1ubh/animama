"use client";

import { create } from "zustand";

import type { Avatar } from "@/lib/avatar";

export type VRMEditorDebugTarget = {
  animaId: string | null;
  avatar: Avatar;
  sourceUrl: string | null;
  sourceKey: string | null;
};

type VRMEditorDebugStoreState = {
  isOpen: boolean;
  showFaceDebugBox: boolean;
  target: VRMEditorDebugTarget | null;
  setOpen: (open: boolean) => void;
  setShowFaceDebugBox: (show: boolean) => void;
  toggleShowFaceDebugBox: () => void;
  toggleOpen: () => void;
  registerTarget: (target: VRMEditorDebugTarget) => void;
  clearTarget: (avatar?: Avatar | null) => void;
};

export const useVRMEditorDebugStore = create<VRMEditorDebugStoreState>(
  (set) => ({
    isOpen: false,
    showFaceDebugBox: false,
    target: null,
    setOpen: (isOpen) => set({ isOpen }),
    setShowFaceDebugBox: (showFaceDebugBox) => set({ showFaceDebugBox }),
    toggleShowFaceDebugBox: () =>
      set((state) => ({ showFaceDebugBox: !state.showFaceDebugBox })),
    toggleOpen: () => set((state) => ({ isOpen: !state.isOpen })),
    registerTarget: (target) => set({ target, showFaceDebugBox: false }),
    clearTarget: (avatar) =>
      set((state) => {
        if (!state.target) return state;
        if (avatar && state.target.avatar !== avatar) return state;
        return {
          isOpen: false,
          showFaceDebugBox: false,
          target: null,
        };
      }),
  }),
);
