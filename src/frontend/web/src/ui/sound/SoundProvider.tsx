import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { createLogger } from "@/lib/logger";
import {
  getAudioPrefsFromSnapshot,
  saveAudioPrefs,
} from "@/lib/sound/audio-prefs";
import { getSoundCueById } from "@/lib/sound/catalog";
import {
  acquireSharedSoundRuntime,
  releaseSharedSoundRuntime,
} from "@/lib/sound/shared-runtime";
import type { PlaySfxOptions, SoundPlaybackId } from "@/lib/sound/types";
import type { AnimaRuntimeMediaProvider } from "@/lib/runtime-content/AnimaRuntimeMediaCatalog";

type MountedAudioCatalog = {
  animaId: string;
  catalog: AnimaRuntimeMediaProvider;
};

export type SoundContextValue = {
  masterMuted: boolean;
  sfxMuted: boolean;
  ttsMuted: boolean;
  sfxVolume: number;
  ttsVolume: number;
  mountRuntimeAudioCatalog: (
    animaId: string,
    catalog: AnimaRuntimeMediaProvider,
  ) => () => void;
  playSfxCue: (
    runtimeId: string,
    options?: PlaySfxOptions,
  ) => Promise<SoundPlaybackId | null>;
  playBuiltInSfxCue: (
    cueId: string,
    options?: PlaySfxOptions,
  ) => SoundPlaybackId | null;
  setMasterMuted: (muted: boolean) => void;
  setSfxMuted: (muted: boolean) => void;
  setSfxVolume: (value: number) => void;
  setTtsMuted: (muted: boolean) => void;
  setTtsVolume: (value: number) => void;
};

const SoundContext = createContext<SoundContextValue | null>(null);
const logger = createLogger("SoundProvider");
export function SoundProvider({ children }: { children: ReactNode }) {
  const [runtime] = useState(acquireSharedSoundRuntime);
  const controller = runtime.controller;
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const [mountedAudio, setMountedAudio] = useState<MountedAudioCatalog | null>(
    null,
  );
  const mountedAudioRef = useRef(mountedAudio);
  mountedAudioRef.current = mountedAudio;

  useEffect(() => () => releaseSharedSoundRuntime(runtime), [runtime]);

  useEffect(() => {
    saveAudioPrefs(getAudioPrefsFromSnapshot(snapshot));
  }, [snapshot]);

  useEffect(() => {
    controller.stopAllSfx();
    return () => controller.stopAllSfx();
  }, [controller, mountedAudio]);

  const mountRuntimeAudioCatalog = useCallback(
    (animaId: string, catalog: AnimaRuntimeMediaProvider) => {
      const mounted = { animaId, catalog };
      setMountedAudio(mounted);
      return () => {
        setMountedAudio((current) => (current === mounted ? null : current));
      };
    },
    [],
  );

  const playSfxCue = useCallback(
    async (runtimeId: string, options?: PlaySfxOptions) => {
      const mounted = mountedAudioRef.current;
      if (!mounted || options?.signal?.aborted) return null;
      const resolved = await mounted.catalog.resolveAudio("sfx", runtimeId);
      if (
        !resolved ||
        mountedAudioRef.current !== mounted ||
        options?.signal?.aborted
      )
        return null;
      return controller.playSfx(resolved.url, {
        ...options,
        loop: false,
        volume: (options?.volume ?? 1) * resolved.volume,
      });
    },
    [controller],
  );

  const playBuiltInSfxCue = useCallback(
    (cueId: string, options?: PlaySfxOptions) => {
      const cue = getSoundCueById(cueId);
      if (!cue || cue.kind !== "sfx") {
        logger.warn("Playback", "Editor sound cue was not found");
        return null;
      }
      return controller.playSfx(cue.assetPath, {
        ...options,
        volume: (options?.volume ?? 1) * cue.defaultVolume,
      });
    },
    [controller],
  );

  const value = useMemo<SoundContextValue>(
    () => ({
      masterMuted: snapshot.masterMuted,
      sfxMuted: snapshot.sfxMuted,
      ttsMuted: snapshot.ttsMuted,
      sfxVolume: snapshot.sfxVolume,
      ttsVolume: snapshot.ttsVolume,
      mountRuntimeAudioCatalog,
      playSfxCue,
      playBuiltInSfxCue,
      setMasterMuted: (muted) => controller.setMasterMuted(muted),
      setSfxMuted: (muted) => controller.setSfxMuted(muted),
      setSfxVolume: (volume) => controller.setSfxVolume(volume),
      setTtsMuted: (muted) => controller.setTtsMuted(muted),
      setTtsVolume: (volume) => controller.setTtsVolume(volume),
    }),
    [
      controller,
      mountRuntimeAudioCatalog,
      playBuiltInSfxCue,
      playSfxCue,
      snapshot,
    ],
  );

  return (
    <SoundContext.Provider value={value}>{children}</SoundContext.Provider>
  );
}

export function useSoundContext(): SoundContextValue {
  const context = useContext(SoundContext);
  if (!context)
    throw new Error("useSoundController must be used within SoundProvider");
  return context;
}

export function useOptionalSoundContext(): SoundContextValue | null {
  return useContext(SoundContext);
}
