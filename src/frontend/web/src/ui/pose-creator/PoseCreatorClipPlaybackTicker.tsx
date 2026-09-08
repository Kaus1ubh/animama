"use client";

import { useFrame } from "@react-three/fiber";

import { usePoseCreatorStore } from "@/stores/pose-creator-store";

export function PoseCreatorClipPlaybackTicker() {
  const authoringMode = usePoseCreatorStore((state) => state.authoringMode);
  const clipPlaybackPlaying = usePoseCreatorStore(
    (state) => state.clipPlaybackPlaying,
  );
  const advanceClipPlayback = usePoseCreatorStore(
    (state) => state.advanceClipPlayback,
  );

  useFrame((_state, delta) => {
    if (authoringMode !== "clip" || !clipPlaybackPlaying) return;
    advanceClipPlayback(delta);
  });

  return null;
}
