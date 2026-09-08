"use client";

import { useCallback, useEffect, useState } from "react";

import type { Avatar } from "@/lib/avatar";
import {
  buildPlaybackObservationV1,
  capturePlaybackObservationRuntime,
  PLAYBACK_OBSERVATION_SCHEMA_VERSION,
  serializePlaybackObservation,
  shouldSamplePlaybackObservation,
  startPlaybackObservationSampling,
  type PlaybackObservationPoseClipSample,
  type PlaybackObservationStatus,
  type PlaybackObservationSurface,
} from "@/lib/content-preview/playbackObservation";
import type { ContentPreviewTarget } from "@/lib/content-preview/types";
import type { SceneVFXRuntimeEntry } from "@/lib/scene-vfx/types";

type PlaybackObservationOutputProps = {
  active: boolean;
  avatar: Avatar | null;
  expressionNames?: readonly string[];
  poseClipSample?: PlaybackObservationPoseClipSample;
  sceneVFX: SceneVFXRuntimeEntry | readonly SceneVFXRuntimeEntry[] | null;
  status: PlaybackObservationStatus;
  surface: PlaybackObservationSurface;
  target: Pick<ContentPreviewTarget, "kind" | "runtimeId">;
};

const EMPTY_EXPRESSION_NAMES: readonly string[] = [];

/**
 * Exposes a bounded, read-only projection of public playback snapshots.
 * The interval only asks React to resample; it never owns playback state.
 */
export function PlaybackObservationOutput({
  active,
  avatar,
  expressionNames = EMPTY_EXPRESSION_NAMES,
  poseClipSample,
  sceneVFX,
  status,
  surface,
  target,
}: PlaybackObservationOutputProps) {
  const [, setSampleRevision] = useState(0);
  const shouldSample = shouldSamplePlaybackObservation({ active, status });
  const sample = useCallback(() => {
    setSampleRevision((current) =>
      current >= Number.MAX_SAFE_INTEGER ? 0 : current + 1,
    );
  }, []);

  useEffect(
    () =>
      startPlaybackObservationSampling({
        enabled: shouldSample,
        sample,
        environment: {
          isVisible: () => document.visibilityState !== "hidden",
          setInterval: (callback, delayMs) =>
            window.setInterval(callback, delayMs),
          clearInterval: (intervalId) => window.clearInterval(intervalId),
          subscribeVisibility: (callback) => {
            document.addEventListener("visibilitychange", callback);
            return () =>
              document.removeEventListener("visibilitychange", callback);
          },
        },
      }),
    [sample, shouldSample, target.kind, target.runtimeId],
  );

  useEffect(() => {
    if (!active || !poseClipSample || shouldSample) return;
    // Timeline scrubbing applies expressions in a sibling passive effect.
    // Sample once after that commit so an idle creator reports the applied
    // Avatar state without starting an idle timer or predicting its weights.
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) sample();
    });
    return () => {
      cancelled = true;
    };
  }, [active, avatar, expressionNames, poseClipSample, sample, shouldSample]);

  const observation = buildPlaybackObservationV1({
    surface,
    target,
    status,
    runtime: capturePlaybackObservationRuntime(avatar, {
      expressionNames,
      poseClipSample,
    }),
    sceneVFX,
    nowMs: Date.now(),
  });

  return (
    <output
      hidden
      data-playback-observation
      data-schema-version={PLAYBACK_OBSERVATION_SCHEMA_VERSION}
    >
      {serializePlaybackObservation(observation)}
    </output>
  );
}
