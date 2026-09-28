"use client";

import { createLogger } from "@/lib/logger";

import { getAudioPrefsFromSnapshot, loadAudioPrefs } from "./audio-prefs";
import { SoundController } from "./SoundController";

const logger = createLogger("SharedSoundRuntime");
const SHARED_SOUND_RUNTIME_KEY = "__animaSharedSoundRuntime";
const SHARED_SOUND_DISPOSE_DELAY_MS = 250;

export type SharedSoundRuntime = {
  controller: SoundController;
  refCount: number;
  disposeTimer: number | null;
  shared: boolean;
};

type SharedWindow = Window & {
  [SHARED_SOUND_RUNTIME_KEY]?: SharedSoundRuntime;
};

function createSoundRuntime(shared: boolean): SharedSoundRuntime {
  const controller = new SoundController();
  const initialPrefs = loadAudioPrefs();

  controller.restorePersistedState(
    initialPrefs ?? getAudioPrefsFromSnapshot(controller.getSnapshot()),
  );

  return {
    controller,
    refCount: 0,
    disposeTimer: null,
    shared,
  };
}

export function acquireSharedSoundRuntime(): SharedSoundRuntime {
  if (typeof window === "undefined") {
    return createSoundRuntime(false);
  }

  const sharedWindow = window as SharedWindow;
  const runtime =
    sharedWindow[SHARED_SOUND_RUNTIME_KEY] ?? createSoundRuntime(true);

  sharedWindow[SHARED_SOUND_RUNTIME_KEY] = runtime;

  if (runtime.disposeTimer) {
    window.clearTimeout(runtime.disposeTimer);
    runtime.disposeTimer = null;
  }

  runtime.refCount += 1;
  logger.debug("Lifecycle", "Acquired shared sound runtime", {
    refCount: runtime.refCount,
  });

  return runtime;
}

export function releaseSharedSoundRuntime(runtime: SharedSoundRuntime) {
  if (!runtime.shared) {
    runtime.controller.dispose();
    return;
  }

  if (typeof window === "undefined") {
    return;
  }

  const sharedWindow = window as SharedWindow;
  if (sharedWindow[SHARED_SOUND_RUNTIME_KEY] !== runtime) {
    return;
  }

  runtime.refCount = Math.max(0, runtime.refCount - 1);
  logger.debug("Lifecycle", "Released shared sound runtime", {
    refCount: runtime.refCount,
  });

  if (runtime.refCount > 0 || runtime.disposeTimer) {
    return;
  }

  runtime.disposeTimer = window.setTimeout(() => {
    if (sharedWindow[SHARED_SOUND_RUNTIME_KEY] !== runtime) {
      return;
    }
    runtime.disposeTimer = null;

    if (runtime.refCount > 0) {
      return;
    }

    logger.info("Lifecycle", "Disposing shared sound runtime");
    runtime.controller.dispose();
    delete sharedWindow[SHARED_SOUND_RUNTIME_KEY];
  }, SHARED_SOUND_DISPOSE_DELAY_MS);
}
