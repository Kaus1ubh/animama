"use client";

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
import type {
  AnimaRuntimeMediaProvider,
  RuntimeAudioDescriptor,
} from "@/lib/runtime-content/AnimaRuntimeMediaCatalog";

type MountedAudioCatalog = {
  animaId: string;
  catalog: AnimaRuntimeMediaProvider;
};

export type SoundContextValue = {
  bgmState: "stopped" | "loading" | "playing" | "paused" | "blocked";
  bgmRuntimeId: string | null;
  bgmTracks: readonly RuntimeAudioDescriptor[];
  pendingAutoplayRetry: boolean;
  masterMuted: boolean;
  bgmMuted: boolean;
  sfxMuted: boolean;
  ttsMuted: boolean;
  bgmVolume: number;
  sfxVolume: number;
  ttsVolume: number;
  mountRuntimeAudioCatalog: (
    animaId: string,
    catalog: AnimaRuntimeMediaProvider,
  ) => () => void;
  playBgm: () => Promise<boolean>;
  playBgmTrack: (runtimeId: string) => Promise<boolean>;
  playNextBgmTrack: () => Promise<boolean>;
  preloadBgm: () => void;
  pauseBgm: () => void;
  stopBgm: () => void;
  playSfxCue: (
    runtimeId: string,
    options?: PlaySfxOptions,
  ) => Promise<SoundPlaybackId | null>;
  playBuiltInSfxCue: (
    cueId: string,
    options?: PlaySfxOptions,
  ) => SoundPlaybackId | null;
  setMasterMuted: (muted: boolean) => void;
  setBgmMuted: (muted: boolean) => void;
  setSfxMuted: (muted: boolean) => void;
  setBgmVolume: (value: number) => void;
  setSfxVolume: (value: number) => void;
  setTtsMuted: (muted: boolean) => void;
  setTtsVolume: (value: number) => void;
};

const SoundContext = createContext<SoundContextValue | null>(null);
const logger = createLogger("SoundProvider");
const noCatalogSubscription = () => () => undefined;
const noCatalogVersion = () => 0;

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
  const [bgmRuntimeId, setBgmRuntimeId] = useState<string | null>(null);
  const bgmRuntimeIdRef = useRef(bgmRuntimeId);
  bgmRuntimeIdRef.current = bgmRuntimeId;
  const [selectedByAnima, setSelectedByAnima] = useState<
    Record<string, string>
  >(() => runtime.initialPrefs?.selectedBgmRuntimeIdByAnimaId ?? {});
  const selectedByAnimaRef = useRef(selectedByAnima);
  selectedByAnimaRef.current = selectedByAnima;
  const mountedAudioRef = useRef(mountedAudio);
  mountedAudioRef.current = mountedAudio;

  const catalogVersion = useSyncExternalStore(
    mountedAudio?.catalog.subscribe ?? noCatalogSubscription,
    mountedAudio?.catalog.getAvailabilityVersion ?? noCatalogVersion,
    noCatalogVersion,
  );
  const bgmTracks = useMemo(
    () => mountedAudio?.catalog.listAudio("bgm") ?? [],
    // The catalog keeps its identity as newly verified tracks are admitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mountedAudio, catalogVersion],
  );

  useEffect(() => () => releaseSharedSoundRuntime(runtime), [runtime]);

  useEffect(() => {
    if (!snapshot.pendingAutoplayRetry || typeof window === "undefined") return;
    const retry = () => void controller.retryPendingBgmAutoplay();
    window.addEventListener("click", retry);
    window.addEventListener("keyup", retry);
    return () => {
      window.removeEventListener("click", retry);
      window.removeEventListener("keyup", retry);
    };
  }, [controller, snapshot.pendingAutoplayRetry]);

  useEffect(() => {
    saveAudioPrefs(getAudioPrefsFromSnapshot(snapshot, selectedByAnima));
  }, [selectedByAnima, snapshot]);

  useEffect(() => {
    let cancelled = false;
    controller.stopBgm();
    controller.stopAllSfx();
    bgmRuntimeIdRef.current = null;
    setBgmRuntimeId(null);
    if (!mountedAudio) {
      return;
    }
    let initialized = false;
    const initializeTracks = () => {
      if (cancelled || initialized) return;
      // Respect a manual selection made while the rest of the catalog loaded.
      if (bgmRuntimeIdRef.current) {
        initialized = true;
        return;
      }
      const tracks = mountedAudio.catalog.listAudio("bgm");
      const autoplay = tracks.find((track) => track.autoplay) ?? null;
      // A later ready track may be the configured autoplay/remembered choice.
      // Ready tracks already appear in the controls and remain manually playable.
      if (!autoplay && mountedAudio.catalog.isPreparing?.()) return;
      initialized = true;
      const remembered = selectedByAnimaRef.current[mountedAudio.animaId];
      const selected =
        autoplay ??
        tracks.find((track) => track.runtimeId === remembered) ??
        tracks[0] ??
        null;
      setBgmRuntimeId(selected?.runtimeId ?? null);
      bgmRuntimeIdRef.current = selected?.runtimeId ?? null;
      if (selected) {
        setSelectedByAnima((current) => ({
          ...current,
          [mountedAudio.animaId]: selected.runtimeId,
        }));
      }
      if (autoplay) {
        void mountedAudio.catalog
          .resolveAudio("bgm", autoplay.runtimeId)
          .then((resolved) =>
            resolved &&
            !cancelled &&
            mountedAudioRef.current === mountedAudio &&
            bgmRuntimeIdRef.current === autoplay.runtimeId
              ? controller.playBgm({
                  trackUrl: resolved.url,
                  loop: resolved.loop,
                  volume: resolved.volume,
                })
              : false,
          );
      }
    };
    const unsubscribe = mountedAudio.catalog.subscribe?.(initializeTracks);
    initializeTracks();
    return () => {
      cancelled = true;
      unsubscribe?.();
      controller.stopBgm();
      controller.stopAllSfx();
    };
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

  const playBgmTrack = useCallback(
    async (runtimeId: string) => {
      const mounted = mountedAudioRef.current;
      if (!mounted) return false;
      if (
        !mounted.catalog
          .listAudio("bgm")
          .some((track) => track.runtimeId === runtimeId)
      )
        return false;
      // Record intent before decoding: a later catalog admission must not
      // replace this manual choice with an autoplay or remembered track.
      bgmRuntimeIdRef.current = runtimeId;
      setBgmRuntimeId(runtimeId);
      const resolved = await mounted.catalog.resolveAudio("bgm", runtimeId);
      if (
        !resolved ||
        mountedAudioRef.current !== mounted ||
        bgmRuntimeIdRef.current !== runtimeId
      )
        return false;
      setSelectedByAnima((current) => ({
        ...current,
        [mounted.animaId]: runtimeId,
      }));
      return controller.playBgm({
        trackUrl: resolved.url,
        loop: resolved.loop,
        volume: resolved.volume,
      });
    },
    [controller],
  );

  const playBgm = useCallback(async () => {
    return bgmRuntimeId ? playBgmTrack(bgmRuntimeId) : false;
  }, [bgmRuntimeId, playBgmTrack]);

  const playNextBgmTrack = useCallback(async () => {
    if (bgmTracks.length === 0) return false;
    const currentIndex = bgmTracks.findIndex(
      (track) => track.runtimeId === bgmRuntimeId,
    );
    const next =
      bgmTracks[(currentIndex + 1 + bgmTracks.length) % bgmTracks.length];
    return next ? playBgmTrack(next.runtimeId) : false;
  }, [bgmRuntimeId, bgmTracks, playBgmTrack]);

  const preloadBgm = useCallback(() => {
    const mounted = mountedAudioRef.current;
    if (!mounted || !bgmRuntimeId) return;
    void mounted.catalog.resolveAudio("bgm", bgmRuntimeId).then((resolved) => {
      if (resolved && mountedAudioRef.current === mounted) {
        controller.preloadBgm({ trackUrl: resolved.url });
      }
    });
  }, [bgmRuntimeId, controller]);

  const playSfxCue = useCallback(
    async (runtimeId: string, options?: PlaySfxOptions) => {
      const mounted = mountedAudioRef.current;
      if (!mounted) return null;
      const resolved = await mounted.catalog.resolveAudio("sfx", runtimeId);
      if (!resolved || mountedAudioRef.current !== mounted) return null;
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
      bgmState: snapshot.bgmState,
      bgmRuntimeId,
      bgmTracks,
      pendingAutoplayRetry: snapshot.pendingAutoplayRetry,
      masterMuted: snapshot.masterMuted,
      bgmMuted: snapshot.bgmMuted,
      sfxMuted: snapshot.sfxMuted,
      ttsMuted: snapshot.ttsMuted,
      bgmVolume: snapshot.bgmVolume,
      sfxVolume: snapshot.sfxVolume,
      ttsVolume: snapshot.ttsVolume,
      mountRuntimeAudioCatalog,
      playBgm,
      playBgmTrack,
      playNextBgmTrack,
      preloadBgm,
      pauseBgm: () => controller.pauseBgm(),
      stopBgm: () => controller.stopBgm(),
      playSfxCue,
      playBuiltInSfxCue,
      setMasterMuted: (muted) => controller.setMasterMuted(muted),
      setBgmMuted: (muted) => controller.setBgmMuted(muted),
      setSfxMuted: (muted) => controller.setSfxMuted(muted),
      setBgmVolume: (volume) => controller.setBgmVolume(volume),
      setSfxVolume: (volume) => controller.setSfxVolume(volume),
      setTtsMuted: (muted) => controller.setTtsMuted(muted),
      setTtsVolume: (volume) => controller.setTtsVolume(volume),
    }),
    [
      bgmRuntimeId,
      bgmTracks,
      controller,
      mountRuntimeAudioCatalog,
      playBgm,
      playBgmTrack,
      playNextBgmTrack,
      playBuiltInSfxCue,
      playSfxCue,
      preloadBgm,
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
