"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Info, Keyboard } from "lucide-react";
import { toast } from "sonner";

import {
  DEFAULT_ELEVENLABS_TTS_MODEL_ID,
  DEFAULT_ELEVENLABS_V3_FINALIZED_CHUNKING,
  DEFAULT_ANIMAMA_PREFERENCES,
  ELEVENLABS_TTS_MODEL_OPTIONS,
  ELEVENLABS_V3_FINALIZED_CHUNKING_OPTIONS,
  isElevenLabsFinalizedTtsModelId,
  mergePreferences,
  resolveElevenLabsV3FinalizedChunking,
  toElevenLabsTtsModelId,
  toElevenLabsV3FinalizedChunking,
  type ElevenLabsTtsModelId,
  type ElevenLabsV3FinalizedChunking,
  type SettingsPreferences,
} from "@/lib/settings/preferences";
import {
  DEFAULT_DESKTOP_SHORTCUTS,
  DESKTOP_SHORTCUT_ACTION_LABELS,
  formatDesktopShortcut,
  resolveDesktopShortcuts,
  shortcutFromKeyboardEvent,
  shortcutFromMouseEvent,
  validateDesktopShortcut,
  type DesktopShortcut,
  type DesktopShortcutAction,
  type DesktopShortcutMap,
} from "@/lib/settings/desktop-shortcuts";
import { useRuntimePlatform } from "@/platform/RuntimePlatformProvider";
import { useModelProviders } from "@/query/hooks/useModelProviders";
import {
  getSttProviderOptions,
  resolvePreferredSttProvider,
  toSttProvider,
  type SttProvider,
} from "@/lib/speech/stt-provider";
import {
  getTtsProviderOptions,
  resolvePreferredTtsProvider,
  toTtsProvider,
  type TtsProvider,
} from "@/lib/speech/tts-provider";
import { Switch } from "@/ui/components/switch";
import { Button } from "@/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/select";
import { useSettings } from "@/ui/settings/SettingsProvider";
import { DesktopCredentialsPanel } from "@/ui/settings/DesktopCredentialsPanel";
import { DesktopFeaturePacksPanel } from "@/ui/settings/DesktopFeaturePacksPanel";
import { DesktopUpdatesPanel } from "@/ui/settings/DesktopUpdatesPanel";
import { useRuntimeCapabilities } from "@/query/hooks/useRuntimeCapabilities";
import { fetchRuntimeCapabilities } from "@/query/runtime-capabilities";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/ui/components/tooltip";
import { SectionedModalFrame } from "@/ui/components/sectioned-modal-frame";
import { AudioVolumePanel } from "@/ui/sound/SoundControls";
import { cn } from "@/lib/utils";

type ApplicationSettingsModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type ShortcutRecorderProps = {
  label: string;
  description: string;
  shortcut: DesktopShortcut;
  isRecording: boolean;
  disabled: boolean;
  allowMouseShortcut: boolean;
  onStartRecording: () => void;
  onCancelRecording: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
};

function ShortcutRecorder({
  label,
  description,
  shortcut,
  isRecording,
  disabled,
  allowMouseShortcut,
  onStartRecording,
  onCancelRecording,
  onKeyDown,
}: ShortcutRecorderProps) {
  return (
    <div className="border-border/70 bg-background/50 grid gap-3 rounded-lg border px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <p className="text-foreground text-sm font-medium">{label}</p>
        <p className="text-muted-foreground text-xs">{description}</p>
      </div>
      <Button
        type="button"
        variant={isRecording ? "default" : "outline"}
        className={cn(
          "min-h-9 min-w-36 justify-center font-mono text-xs",
          isRecording ? "animate-pulse" : "",
        )}
        disabled={disabled}
        onClick={onStartRecording}
        onBlur={() => {
          if (isRecording) onCancelRecording();
        }}
        onKeyDown={onKeyDown}
        aria-label={`Record ${label} shortcut`}
      >
        <Keyboard className="h-3.5 w-3.5" />
        {isRecording
          ? allowMouseShortcut
            ? "Press keys or mouse"
            : "Press keys"
          : formatDesktopShortcut(shortcut)}
      </Button>
    </div>
  );
}

const sections = ["General", "Voice", "Memory", "Advanced"] as const;
type ApplicationSettingsSection = (typeof sections)[number];

const OPENAI_RESPONSES_PROVIDER = "OpenAIResponsesHTTPAgent";
const SYSTEM_MEMORY_MANAGER_MODEL = "__system_default__";

const AVATAR_TRANSFORM_CONTROLS_TOOLTIP =
  "Press G to move, R to rotate, and S to scale the avatar. Press Esc to exit a transform mode. In avatar mode, drag or scroll the canvas to orbit and zoom. In avatar-chat mode, hold Ctrl while dragging to orbit and Ctrl + scroll to zoom.";

const shortcutRows: Array<{
  action: DesktopShortcutAction;
  description: string;
  allowMouseShortcut?: boolean;
}> = [
  {
    action: "press_to_talk",
    description: "Temporarily unmute Voice Mode while held.",
    allowMouseShortcut: true,
  },
  {
    action: "quick_chat",
    description: "Show or hide the desktop Quick Chat window.",
  },
  {
    action: "toggle_voice_mode",
    description: "Start or stop Voice Mode.",
  },
  {
    action: "toggle_voice_mute",
    description: "Mute or unmute the Voice Mode microphone.",
  },
  {
    action: "skip_tts",
    description: "Stop the active spoken response.",
  },
];

export function ApplicationSettingsModal({
  open,
  onOpenChange,
}: ApplicationSettingsModalProps) {
  const {
    chatMarkdownEnabled,
    setChatMarkdownEnabled,
    userPreferences,
    updateUserPreferences,
  } = useSettings();
  const platform = useRuntimePlatform();
  const modelProviders = useModelProviders();
  const resolvedUserPreferences = useMemo<SettingsPreferences>(
    () => mergePreferences(DEFAULT_ANIMAMA_PREFERENCES, userPreferences),
    [userPreferences],
  );
  const [selectedSttProvider, setSelectedSttProvider] =
    useState<SttProvider | null>(null);
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [ttsStreamChunks, setTtsStreamChunks] = useState(true);
  const [selectedTtsProvider, setSelectedTtsProvider] =
    useState<TtsProvider | null>(null);
  const [selectedElevenLabsModelId, setSelectedElevenLabsModelId] =
    useState<ElevenLabsTtsModelId>(DEFAULT_ELEVENLABS_TTS_MODEL_ID);
  const [
    selectedElevenLabsV3FinalizedChunking,
    setSelectedElevenLabsV3FinalizedChunking,
  ] = useState<ElevenLabsV3FinalizedChunking>(
    DEFAULT_ELEVENLABS_V3_FINALIZED_CHUNKING,
  );
  const [desktopShortcuts, setDesktopShortcuts] = useState<DesktopShortcutMap>(
    DEFAULT_DESKTOP_SHORTCUTS,
  );
  const [recordingShortcutAction, setRecordingShortcutAction] =
    useState<DesktopShortcutAction | null>(null);
  const [avatarTransformControlsEnabled, setAvatarTransformControlsEnabled] =
    useState(false);
  const [activeSection, setActiveSection] =
    useState<ApplicationSettingsSection>("General");
  const [isInitializing, setIsInitializing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const runtimeCapabilities = useRuntimeCapabilities();
  const parakeetAvailable =
    runtimeCapabilities.data?.offline_speech_enabled ?? null;
  const initializedForOpenRef = useRef(false);
  const savedSttProviderRef = useRef<SttProvider | null>(null);
  const savedTtsProviderRef = useRef<TtsProvider | null>(null);
  const savedElevenLabsModelIdRef = useRef<ElevenLabsTtsModelId>(
    DEFAULT_ELEVENLABS_TTS_MODEL_ID,
  );
  const savedElevenLabsV3FinalizedChunkingRef =
    useRef<ElevenLabsV3FinalizedChunking>(
      DEFAULT_ELEVENLABS_V3_FINALIZED_CHUNKING,
    );
  const savedTtsEnabledRef = useRef(false);
  const savedTtsStreamChunksRef = useRef(true);
  const savedDesktopShortcutsRef = useRef<DesktopShortcutMap>(
    DEFAULT_DESKTOP_SHORTCUTS,
  );
  const savedAvatarTransformControlsEnabledRef = useRef(false);
  const updateUserPreferencesRef = useRef(updateUserPreferences);

  const savedSttProvider = toSttProvider(
    resolvedUserPreferences?.speech?.stt_provider,
  );
  const savedTtsProvider = toTtsProvider(
    resolvedUserPreferences?.speech?.tts_provider,
  );
  const savedElevenLabsModelId =
    toElevenLabsTtsModelId(
      resolvedUserPreferences?.speech?.tts_elevenlabs_model_id,
    ) ?? DEFAULT_ELEVENLABS_TTS_MODEL_ID;
  const savedElevenLabsV3FinalizedChunking =
    resolveElevenLabsV3FinalizedChunking(
      resolvedUserPreferences?.speech?.tts_elevenlabs_v3_finalized_chunking,
    );
  const savedTtsEnabled = resolvedUserPreferences?.speech?.tts_enabled === true;
  const savedTtsStreamChunks =
    resolvedUserPreferences?.speech?.tts_stream_chunks !== false;
  const savedDesktopShortcuts = useMemo(
    () =>
      resolveDesktopShortcuts(
        resolvedUserPreferences?.speech?.desktop_shortcuts,
      ),
    [resolvedUserPreferences?.speech?.desktop_shortcuts],
  );
  const savedAvatarTransformControlsEnabled =
    resolvedUserPreferences?.presentation?.enable_avatar_transform_controls ===
    true;
  const savedMemoryManagerModel =
    typeof resolvedUserPreferences.memory?.manager_model === "string" &&
    resolvedUserPreferences.memory.manager_model.trim()
      ? resolvedUserPreferences.memory.manager_model.trim()
      : null;
  const memoryManagerModels = useMemo(
    () =>
      (modelProviders.data ?? []).filter(
        (provider) => provider.model_provider === OPENAI_RESPONSES_PROVIDER,
      ),
    [modelProviders.data],
  );
  const currentMemoryManagerModel = memoryManagerModels.find(
    (provider) => provider.model === savedMemoryManagerModel,
  );

  useEffect(() => {
    savedSttProviderRef.current = savedSttProvider;
  }, [savedSttProvider]);

  useEffect(() => {
    savedTtsProviderRef.current = savedTtsProvider;
  }, [savedTtsProvider]);

  useEffect(() => {
    savedElevenLabsModelIdRef.current = savedElevenLabsModelId;
  }, [savedElevenLabsModelId]);

  useEffect(() => {
    savedElevenLabsV3FinalizedChunkingRef.current =
      savedElevenLabsV3FinalizedChunking;
  }, [savedElevenLabsV3FinalizedChunking]);

  useEffect(() => {
    savedTtsEnabledRef.current = savedTtsEnabled;
  }, [savedTtsEnabled]);

  useEffect(() => {
    savedTtsStreamChunksRef.current = savedTtsStreamChunks;
  }, [savedTtsStreamChunks]);

  useEffect(() => {
    savedDesktopShortcutsRef.current = savedDesktopShortcuts;
  }, [savedDesktopShortcuts]);

  useEffect(() => {
    savedAvatarTransformControlsEnabledRef.current =
      savedAvatarTransformControlsEnabled;
  }, [savedAvatarTransformControlsEnabled]);

  useEffect(() => {
    updateUserPreferencesRef.current = updateUserPreferences;
  }, [updateUserPreferences]);

  useEffect(() => {
    if (!platform.isDesktop || !platform.desktopBridge.shortcuts) return;
    void platform.desktopBridge.shortcuts.setContext({
      shortcutCaptureActive: recordingShortcutAction !== null,
    });
  }, [platform, recordingShortcutAction]);

  useEffect(() => {
    return () => {
      if (!platform.isDesktop || !platform.desktopBridge.shortcuts) return;
      void platform.desktopBridge.shortcuts.setContext({
        shortcutCaptureActive: false,
      });
    };
  }, [platform]);

  useEffect(() => {
    if (open) return;
    initializedForOpenRef.current = false;
    setIsInitializing(false);
    setIsSaving(false);
    setSelectedSttProvider(savedSttProvider);
    setSelectedTtsProvider(savedTtsProvider);
    setSelectedElevenLabsModelId(savedElevenLabsModelId);
    setSelectedElevenLabsV3FinalizedChunking(
      savedElevenLabsV3FinalizedChunking,
    );
    setTtsEnabled(savedTtsEnabled);
    setTtsStreamChunks(savedTtsStreamChunks);
    setDesktopShortcuts(savedDesktopShortcuts);
    setRecordingShortcutAction(null);
    setAvatarTransformControlsEnabled(savedAvatarTransformControlsEnabled);
    setActiveSection("General");
  }, [
    savedAvatarTransformControlsEnabled,
    open,
    savedSttProvider,
    savedElevenLabsModelId,
    savedElevenLabsV3FinalizedChunking,
    savedTtsEnabled,
    savedTtsProvider,
    savedTtsStreamChunks,
    savedDesktopShortcuts,
  ]);

  useEffect(() => {
    if (!open) return;
    if (initializedForOpenRef.current) return;
    initializedForOpenRef.current = true;

    let cancelled = false;
    const initialSavedSttProvider = savedSttProviderRef.current;
    const initialSavedTtsProvider = savedTtsProviderRef.current;
    const initialSavedElevenLabsModelId = savedElevenLabsModelIdRef.current;
    const initialSavedElevenLabsV3FinalizedChunking =
      savedElevenLabsV3FinalizedChunkingRef.current;
    const initialSavedTtsEnabled = savedTtsEnabledRef.current;
    const initialSavedTtsStreamChunks = savedTtsStreamChunksRef.current;
    const initialSavedDesktopShortcuts = savedDesktopShortcutsRef.current;
    const initialSavedAvatarTransformControlsEnabled =
      savedAvatarTransformControlsEnabledRef.current;
    setIsInitializing(true);

    void (async () => {
      try {
        const capabilities = await fetchRuntimeCapabilities();
        const resolved = resolvePreferredSttProvider({
          savedProvider: initialSavedSttProvider,
          platform,
          parakeetAvailable: capabilities.offline_speech_enabled,
        });
        const resolvedTts = resolvePreferredTtsProvider({
          savedProvider: initialSavedTtsProvider,
          platform,
        });

        if (cancelled) return;
        setSelectedSttProvider(resolved.provider);
        setSelectedTtsProvider(resolvedTts.provider);
        setSelectedElevenLabsModelId(initialSavedElevenLabsModelId);
        setSelectedElevenLabsV3FinalizedChunking(
          initialSavedElevenLabsV3FinalizedChunking,
        );
        setTtsEnabled(initialSavedTtsEnabled);
        setTtsStreamChunks(initialSavedTtsStreamChunks);
        setDesktopShortcuts(initialSavedDesktopShortcuts);
        setRecordingShortcutAction(null);
        setAvatarTransformControlsEnabled(
          initialSavedAvatarTransformControlsEnabled,
        );

        const speechPatch: {
          stt_provider?: SttProvider;
          tts_provider?: TtsProvider;
        } = {};
        if (
          !initialSavedSttProvider ||
          initialSavedSttProvider !== resolved.provider
        ) {
          speechPatch.stt_provider = resolved.provider;
        }
        if (
          resolvedTts.provider &&
          (!initialSavedTtsProvider ||
            initialSavedTtsProvider !== resolvedTts.provider)
        ) {
          speechPatch.tts_provider = resolvedTts.provider;
        }

        if (Object.keys(speechPatch).length > 0) {
          try {
            await updateUserPreferencesRef.current({
              speech: speechPatch,
            });
          } catch {
            toast.error("Failed to save default speech providers.");
          }
        }
      } catch {
        if (!cancelled)
          toast.error(
            "Could not check speech capabilities. Reopen Settings to retry.",
          );
      } finally {
        if (!cancelled) setIsInitializing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, platform]);

  const sttProviderOptions = useMemo(
    () => getSttProviderOptions(parakeetAvailable, platform),
    [parakeetAvailable, platform],
  );
  const ttsProviderOptions = useMemo(
    () => getTtsProviderOptions(platform),
    [platform],
  );

  const currentSttOption = sttProviderOptions.find(
    (option) => option.id === selectedSttProvider,
  );
  const currentTtsOption = ttsProviderOptions.find(
    (option) => option.id === selectedTtsProvider,
  );
  const currentElevenLabsModelOption = ELEVENLABS_TTS_MODEL_OPTIONS.find(
    (option) => option.id === selectedElevenLabsModelId,
  );
  const currentElevenLabsV3FinalizedChunkingOption =
    ELEVENLABS_V3_FINALIZED_CHUNKING_OPTIONS.find(
      (option) => option.id === selectedElevenLabsV3FinalizedChunking,
    );
  const selectedElevenLabsModelIsFinalized =
    selectedTtsProvider === "elevenlabs" &&
    isElevenLabsFinalizedTtsModelId(selectedElevenLabsModelId);

  const firstAvailableTtsProvider = useMemo(() => {
    return ttsProviderOptions.find((option) => !option.disabled)?.id ?? null;
  }, [ttsProviderOptions]);

  const handleSttProviderChange = useCallback(
    (value: string) => {
      const nextProvider = toSttProvider(value);
      if (!nextProvider || isSaving || isInitializing) return;
      const nextOption = sttProviderOptions.find(
        (option) => option.id === nextProvider,
      );
      if (!nextOption || nextOption.disabled) {
        if (nextOption?.reason) {
          toast.error(nextOption.reason);
        }
        return;
      }
      const previousProvider = selectedSttProvider;
      setSelectedSttProvider(nextProvider);
      setIsSaving(true);

      void updateUserPreferences({
        speech: { stt_provider: nextProvider },
      })
        .catch(() => {
          setSelectedSttProvider(previousProvider);
          toast.error("Failed to update STT provider.");
        })
        .finally(() => setIsSaving(false));
    },
    [
      isInitializing,
      isSaving,
      selectedSttProvider,
      sttProviderOptions,
      updateUserPreferences,
    ],
  );

  const handleTtsEnabledChange = useCallback(
    (nextEnabled: boolean) => {
      if (isSaving || isInitializing) return;

      const previousEnabled = ttsEnabled;
      const previousProvider = selectedTtsProvider;

      let nextProvider = selectedTtsProvider;
      if (nextEnabled) {
        const selectedOption = ttsProviderOptions.find(
          (option) => option.id === nextProvider,
        );
        if (!nextProvider || selectedOption?.disabled) {
          nextProvider = firstAvailableTtsProvider;
        }
        if (!nextProvider) {
          toast.error(
            "No supported TTS provider is available in this environment.",
          );
          return;
        }
      }

      setTtsEnabled(nextEnabled);
      if (nextEnabled && nextProvider) {
        setSelectedTtsProvider(nextProvider);
      }
      setIsSaving(true);

      const speechPatch: {
        tts_enabled: boolean;
        tts_provider?: TtsProvider;
        tts_elevenlabs_model_id?: ElevenLabsTtsModelId;
      } = {
        tts_enabled: nextEnabled,
      };
      if (nextProvider) {
        speechPatch.tts_provider = nextProvider;
      }
      if (nextProvider === "elevenlabs") {
        speechPatch.tts_elevenlabs_model_id = selectedElevenLabsModelId;
      }

      void updateUserPreferences({
        speech: speechPatch,
      })
        .catch(() => {
          setTtsEnabled(previousEnabled);
          setSelectedTtsProvider(previousProvider);
          toast.error("Failed to update TTS settings.");
        })
        .finally(() => setIsSaving(false));
    },
    [
      firstAvailableTtsProvider,
      isInitializing,
      isSaving,
      selectedTtsProvider,
      selectedElevenLabsModelId,
      ttsEnabled,
      ttsProviderOptions,
      updateUserPreferences,
    ],
  );

  const handleTtsProviderChange = useCallback(
    (value: string) => {
      const nextProvider = toTtsProvider(value);
      if (!nextProvider || isSaving || isInitializing) return;
      const nextOption = ttsProviderOptions.find(
        (option) => option.id === nextProvider,
      );
      if (!nextOption || nextOption.disabled) {
        if (nextOption?.reason) {
          toast.error(nextOption.reason);
        }
        return;
      }

      const previousProvider = selectedTtsProvider;
      const previousEnabled = ttsEnabled;
      setSelectedTtsProvider(nextProvider);
      setTtsEnabled(true);
      setIsSaving(true);

      void updateUserPreferences({
        speech: {
          tts_enabled: true,
          tts_provider: nextProvider,
          ...(nextProvider === "elevenlabs"
            ? { tts_elevenlabs_model_id: selectedElevenLabsModelId }
            : {}),
        },
      })
        .catch(() => {
          setSelectedTtsProvider(previousProvider);
          setTtsEnabled(previousEnabled);
          toast.error("Failed to update TTS provider.");
        })
        .finally(() => setIsSaving(false));
    },
    [
      isInitializing,
      isSaving,
      selectedTtsProvider,
      selectedElevenLabsModelId,
      ttsEnabled,
      ttsProviderOptions,
      updateUserPreferences,
    ],
  );

  const handleTtsStreamChunksChange = useCallback(
    (nextEnabled: boolean) => {
      if (
        isSaving ||
        isInitializing ||
        !ttsEnabled ||
        selectedElevenLabsModelIsFinalized
      ) {
        return;
      }
      const previous = ttsStreamChunks;
      setTtsStreamChunks(nextEnabled);
      setIsSaving(true);

      void updateUserPreferences({
        speech: { tts_stream_chunks: nextEnabled },
      })
        .catch(() => {
          setTtsStreamChunks(previous);
          toast.error("Failed to update TTS streaming mode.");
        })
        .finally(() => setIsSaving(false));
    },
    [
      isInitializing,
      isSaving,
      ttsEnabled,
      ttsStreamChunks,
      selectedElevenLabsModelIsFinalized,
      updateUserPreferences,
    ],
  );

  const handleElevenLabsModelChange = useCallback(
    (value: string) => {
      const nextModel = toElevenLabsTtsModelId(value);
      if (
        !nextModel ||
        isSaving ||
        isInitializing ||
        !ttsEnabled ||
        selectedTtsProvider !== "elevenlabs"
      ) {
        return;
      }

      const previous = selectedElevenLabsModelId;
      setSelectedElevenLabsModelId(nextModel);
      setIsSaving(true);

      void updateUserPreferences({
        speech: { tts_elevenlabs_model_id: nextModel },
      })
        .catch(() => {
          setSelectedElevenLabsModelId(previous);
          toast.error("Failed to update ElevenLabs model.");
        })
        .finally(() => setIsSaving(false));
    },
    [
      isInitializing,
      isSaving,
      selectedElevenLabsModelId,
      selectedTtsProvider,
      ttsEnabled,
      updateUserPreferences,
    ],
  );

  const handleElevenLabsV3FinalizedChunkingChange = useCallback(
    (value: string) => {
      const nextChunking = toElevenLabsV3FinalizedChunking(value);
      if (
        !nextChunking ||
        isSaving ||
        isInitializing ||
        !ttsEnabled ||
        !selectedElevenLabsModelIsFinalized
      ) {
        return;
      }

      const previous = selectedElevenLabsV3FinalizedChunking;
      setSelectedElevenLabsV3FinalizedChunking(nextChunking);
      setIsSaving(true);

      void updateUserPreferences({
        speech: { tts_elevenlabs_v3_finalized_chunking: nextChunking },
      })
        .catch(() => {
          setSelectedElevenLabsV3FinalizedChunking(previous);
          toast.error("Failed to update Eleven v3 audio grouping.");
        })
        .finally(() => setIsSaving(false));
    },
    [
      isInitializing,
      isSaving,
      selectedElevenLabsModelIsFinalized,
      selectedElevenLabsV3FinalizedChunking,
      ttsEnabled,
      updateUserPreferences,
    ],
  );

  const handleShortcutRecordingStart = useCallback(
    (action: DesktopShortcutAction) => {
      if (isSaving || isInitializing) return;
      setRecordingShortcutAction(action);
    },
    [isInitializing, isSaving],
  );

  const saveShortcut = useCallback(
    (action: DesktopShortcutAction, nextShortcut: DesktopShortcut) => {
      const validationError = validateDesktopShortcut(
        action,
        nextShortcut,
        desktopShortcuts,
      );
      if (validationError) {
        toast.error(validationError);
        return;
      }

      const previous = desktopShortcuts;
      const nextShortcuts: DesktopShortcutMap = {
        ...desktopShortcuts,
        [action]: nextShortcut,
      };
      setDesktopShortcuts(nextShortcuts);
      setRecordingShortcutAction(null);
      setIsSaving(true);

      void updateUserPreferences({
        speech: {
          desktop_shortcuts: {
            [action]: nextShortcut,
          },
        },
      })
        .catch(() => {
          setDesktopShortcuts(previous);
          toast.error("Failed to update shortcut.");
        })
        .finally(() => setIsSaving(false));
    },
    [desktopShortcuts, updateUserPreferences],
  );

  const handleShortcutKeyDown = useCallback(
    (
      action: DesktopShortcutAction,
      event: KeyboardEvent<HTMLButtonElement>,
    ) => {
      if (recordingShortcutAction !== action) return;
      event.preventDefault();
      event.stopPropagation();

      const nextShortcut = shortcutFromKeyboardEvent(event);
      if (!nextShortcut) {
        return;
      }

      saveShortcut(action, nextShortcut);
    },
    [recordingShortcutAction, saveShortcut],
  );

  useEffect(() => {
    if (recordingShortcutAction !== "press_to_talk") return;

    const handleMouseDown = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const nextShortcut = shortcutFromMouseEvent(event);
      if (!nextShortcut) return;
      saveShortcut("press_to_talk", nextShortcut);
    };
    const preventPendingMouseDefault = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener("mousedown", handleMouseDown, { capture: true });
    window.addEventListener("auxclick", preventPendingMouseDefault, {
      capture: true,
    });
    window.addEventListener("contextmenu", preventPendingMouseDefault, {
      capture: true,
    });
    return () => {
      window.removeEventListener("mousedown", handleMouseDown, {
        capture: true,
      });
      window.removeEventListener("auxclick", preventPendingMouseDefault, {
        capture: true,
      });
      window.removeEventListener("contextmenu", preventPendingMouseDefault, {
        capture: true,
      });
    };
  }, [recordingShortcutAction, saveShortcut]);

  const handleAvatarTransformControlsChange = useCallback(
    (nextEnabled: boolean) => {
      if (isSaving || isInitializing) return;
      const previous = avatarTransformControlsEnabled;
      setAvatarTransformControlsEnabled(nextEnabled);
      setIsSaving(true);

      void updateUserPreferences({
        presentation: { enable_avatar_transform_controls: nextEnabled },
      })
        .catch(() => {
          setAvatarTransformControlsEnabled(previous);
          toast.error("Failed to update avatar transform controls.");
        })
        .finally(() => setIsSaving(false));
    },
    [
      avatarTransformControlsEnabled,
      isInitializing,
      isSaving,
      updateUserPreferences,
    ],
  );

  const handleMemoryManagerModelChange = useCallback(
    (value: string) => {
      if (isSaving || isInitializing) return;
      const nextModel =
        value === SYSTEM_MEMORY_MANAGER_MODEL
          ? null
          : (memoryManagerModels.find((provider) => provider.model === value)
              ?.model ?? null);
      if (value !== SYSTEM_MEMORY_MANAGER_MODEL && !nextModel) return;
      if (nextModel === savedMemoryManagerModel) return;

      setIsSaving(true);
      void updateUserPreferences({
        memory: { manager_model: nextModel },
      })
        .catch(() => {
          toast.error("Failed to update the Memory Manager model.");
        })
        .finally(() => setIsSaving(false));
    },
    [
      isInitializing,
      isSaving,
      memoryManagerModels,
      savedMemoryManagerModel,
      updateUserPreferences,
    ],
  );

  const isBusy = isSaving || isInitializing;
  const isAudioBusy = isBusy;
  const sectionDescription = useMemo(() => {
    switch (activeSection) {
      case "General":
        return "Application settings plus local audio defaults.";
      case "Voice":
        return "Configure speech-to-text and text-to-speech across all animas.";
      case "Memory":
        return "Configure application-wide memory maintenance preferences.";
      case "Advanced":
        return "Advanced interface and avatar control preferences.";
      default:
        return "";
    }
  }, [activeSection]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />
        <SectionedModalFrame<ApplicationSettingsSection>
          title="Application settings"
          description="Configure application-level voice and interface settings."
          closeLabel="Close application settings"
          sidebarLabel="Application"
          sidebarTitle="Settings"
          sections={sections}
          activeSection={activeSection}
          onSectionChange={setActiveSection}
          headerTitle={activeSection}
          headerDescription={sectionDescription}
          headerMeta={
            <p className="text-muted-foreground mt-1 text-sm">
              Application preferences apply across all animas.
            </p>
          }
          gridClassName="md:grid-cols-[220px_minmax(0,1fr)]"
          contentClassName="gap-5"
        >
          {activeSection === "General" ? (
            <section className="border-border/60 bg-muted/10 flex flex-col gap-4 rounded-xl border p-5">
              <div>
                <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                  Audio
                </p>
                <h3 className="text-foreground mt-1 text-base font-semibold">
                  Volume
                </h3>
              </div>
              <AudioVolumePanel
                disabled={isAudioBusy}
                showTitle={false}
                showBgmDetail
                muteAllClassName="px-4 py-3"
                volumeCardClassName="px-4 py-3"
              />
            </section>
          ) : null}

          {activeSection === "General" ? <DesktopCredentialsPanel /> : null}
          {activeSection === "General" ? <DesktopFeaturePacksPanel /> : null}
          {activeSection === "General" ? <DesktopUpdatesPanel /> : null}

          {activeSection === "Voice" ? (
            <>
              <section className="border-border/60 bg-muted/10 flex flex-col gap-4 rounded-xl border p-5">
                <div>
                  <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                    Voice Mode
                  </p>
                  <h3 className="text-foreground mt-1 text-base font-semibold">
                    Microphone
                  </h3>
                </div>

                <div className="border-border/70 bg-background/50 rounded-lg border px-4 py-3">
                  <p className="text-foreground text-sm font-medium">
                    Default voice input
                  </p>
                  <p className="text-muted-foreground text-xs">
                    Voice Mode keeps the microphone session open until it is
                    stopped or muted.
                  </p>
                </div>
              </section>

              <section className="border-border/60 bg-muted/10 flex flex-col gap-4 rounded-xl border p-5">
                <div>
                  <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                    Desktop
                  </p>
                  <h3 className="text-foreground mt-1 text-base font-semibold">
                    Shortcuts
                  </h3>
                  <p className="text-muted-foreground mt-2 text-xs">
                    Shortcuts apply only in the desktop app. Press to talk can
                    use a keyboard shortcut or mouse button.
                  </p>
                </div>

                <div className="grid gap-3">
                  {shortcutRows.map((row) => (
                    <ShortcutRecorder
                      key={row.action}
                      label={DESKTOP_SHORTCUT_ACTION_LABELS[row.action]}
                      description={row.description}
                      shortcut={desktopShortcuts[row.action]}
                      isRecording={recordingShortcutAction === row.action}
                      disabled={isBusy}
                      allowMouseShortcut={row.allowMouseShortcut === true}
                      onStartRecording={() =>
                        handleShortcutRecordingStart(row.action)
                      }
                      onCancelRecording={() => setRecordingShortcutAction(null)}
                      onKeyDown={(event) =>
                        handleShortcutKeyDown(row.action, event)
                      }
                    />
                  ))}
                </div>
              </section>

              <section className="border-border/60 bg-muted/10 flex flex-col gap-4 rounded-xl border p-5">
                <div>
                  <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                    Voice Input
                  </p>
                  <h3 className="text-foreground mt-1 text-base font-semibold">
                    Speech-to-text provider
                  </h3>
                </div>
                <div className="grid gap-2">
                  <p className="text-muted-foreground text-sm">
                    Choose how dictation transcribes speech.
                  </p>
                  <Select
                    value={selectedSttProvider ?? undefined}
                    onValueChange={handleSttProviderChange}
                    disabled={isBusy}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select provider" />
                    </SelectTrigger>
                    <SelectContent>
                      {sttProviderOptions.map((option) => (
                        <SelectItem
                          key={option.id}
                          value={option.id}
                          disabled={option.disabled}
                        >
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-muted-foreground text-xs">
                    {currentSttOption?.description ??
                      "Provider selection will be applied automatically."}
                  </p>
                  {currentSttOption?.reason ? (
                    <p className="text-xs text-amber-600 dark:text-amber-500">
                      {currentSttOption.reason}
                    </p>
                  ) : null}
                  {parakeetAvailable === false ? (
                    <DesktopFeaturePacksPanel only="parakeet-stt" />
                  ) : null}
                  {isInitializing ? (
                    <p className="text-muted-foreground text-xs">
                      Preparing provider defaults...
                    </p>
                  ) : null}
                </div>
              </section>

              <section className="border-border/60 bg-muted/10 flex flex-col gap-4 rounded-xl border p-5">
                <div>
                  <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                    Voice Output
                  </p>
                  <h3 className="text-foreground mt-1 text-base font-semibold">
                    Text-to-speech
                  </h3>
                </div>

                <div className="border-border/70 bg-background/50 flex items-center justify-between gap-4 rounded-lg border px-4 py-3">
                  <div>
                    <p className="text-foreground text-sm font-medium">
                      Enable TTS
                    </p>
                    <p className="text-muted-foreground text-xs">
                      Read assistant responses aloud as they stream.
                    </p>
                  </div>
                  <Switch
                    checked={ttsEnabled}
                    onCheckedChange={handleTtsEnabledChange}
                    disabled={isBusy}
                    aria-label="Enable text-to-speech"
                  />
                </div>

                <div className="border-border/70 bg-background/50 flex items-center justify-between gap-4 rounded-lg border px-4 py-3">
                  <div>
                    <p className="text-foreground text-sm font-medium">
                      Stream chunked TTS
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {selectedElevenLabsModelIsFinalized
                        ? "Eleven v3 uses backend-pushed audio; this switch applies to realtime models."
                        : "When enabled, TTS plays progressively while text streams. When disabled, TTS waits for completion and speaks once."}
                    </p>
                  </div>
                  <Switch
                    checked={
                      selectedElevenLabsModelIsFinalized
                        ? false
                        : ttsStreamChunks
                    }
                    onCheckedChange={handleTtsStreamChunksChange}
                    disabled={
                      isBusy ||
                      !ttsEnabled ||
                      selectedElevenLabsModelIsFinalized
                    }
                    aria-label="Stream chunked text-to-speech"
                  />
                </div>

                <div className="grid gap-2">
                  <p className="text-muted-foreground text-sm">
                    Choose a text-to-speech provider.
                  </p>
                  <Select
                    value={selectedTtsProvider ?? undefined}
                    onValueChange={handleTtsProviderChange}
                    disabled={isBusy || !ttsEnabled}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select provider" />
                    </SelectTrigger>
                    <SelectContent>
                      {ttsProviderOptions.map((option) => (
                        <SelectItem
                          key={option.id}
                          value={option.id}
                          disabled={option.disabled}
                        >
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!ttsEnabled ? (
                    <p className="text-muted-foreground text-xs">
                      Enable TTS to select a provider.
                    </p>
                  ) : (
                    <p className="text-muted-foreground text-xs">
                      {currentTtsOption?.description ??
                        "Provider selection will be applied automatically."}
                    </p>
                  )}
                  {currentTtsOption?.reason && ttsEnabled ? (
                    <p className="text-xs text-amber-600 dark:text-amber-500">
                      {currentTtsOption.reason}
                    </p>
                  ) : null}
                  {ttsEnabled && selectedTtsProvider === "elevenlabs" ? (
                    <div className="mt-2 grid gap-2">
                      <p className="text-muted-foreground text-sm">
                        Choose an ElevenLabs model.
                      </p>
                      <Select
                        value={selectedElevenLabsModelId}
                        onValueChange={handleElevenLabsModelChange}
                        disabled={isBusy}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select model" />
                        </SelectTrigger>
                        <SelectContent>
                          {ELEVENLABS_TTS_MODEL_OPTIONS.map((option) => (
                            <SelectItem key={option.id} value={option.id}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-muted-foreground text-xs">
                        {currentElevenLabsModelOption?.description ??
                          "Model selection will be applied automatically."}
                      </p>
                      {selectedElevenLabsModelIsFinalized ? (
                        <div className="mt-2 grid gap-2">
                          <p className="text-muted-foreground text-sm">
                            Audio grouping
                          </p>
                          <Select
                            value={selectedElevenLabsV3FinalizedChunking}
                            onValueChange={
                              handleElevenLabsV3FinalizedChunkingChange
                            }
                            disabled={isBusy}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Select grouping" />
                            </SelectTrigger>
                            <SelectContent>
                              {ELEVENLABS_V3_FINALIZED_CHUNKING_OPTIONS.map(
                                (option) => (
                                  <SelectItem key={option.id} value={option.id}>
                                    {option.label}
                                  </SelectItem>
                                ),
                              )}
                            </SelectContent>
                          </Select>
                          <p className="text-muted-foreground text-xs">
                            {currentElevenLabsV3FinalizedChunkingOption?.description ??
                              "Sentence grouping starts fastest."}
                          </p>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {ttsEnabled && selectedTtsProvider === "pocket_tts" ? (
                    <p className="text-muted-foreground text-xs">
                      Pocket voice selection and custom voice upload are
                      configured per anima in Anima Settings.
                    </p>
                  ) : null}
                </div>
              </section>
            </>
          ) : null}

          {activeSection === "Memory" ? (
            <section className="border-border/60 bg-muted/10 flex flex-col gap-4 rounded-xl border p-5">
              <div>
                <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                  Memory
                </p>
                <h3 className="text-foreground mt-1 text-base font-semibold">
                  Memory Manager
                </h3>
                <p className="text-muted-foreground mt-2 text-xs">
                  Choose the OpenAI Responses model used for memory maintenance
                  requests.
                </p>
              </div>

              <div className="grid gap-2">
                <p className="text-foreground text-sm font-medium">Model</p>
                <Select
                  value={savedMemoryManagerModel ?? SYSTEM_MEMORY_MANAGER_MODEL}
                  onValueChange={handleMemoryManagerModelChange}
                  disabled={isBusy}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select model" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SYSTEM_MEMORY_MANAGER_MODEL}>
                      System default
                    </SelectItem>
                    {savedMemoryManagerModel && !currentMemoryManagerModel ? (
                      <SelectItem value={savedMemoryManagerModel} disabled>
                        {savedMemoryManagerModel} (unavailable)
                      </SelectItem>
                    ) : null}
                    {memoryManagerModels.map((provider) => (
                      <SelectItem key={provider.id} value={provider.model}>
                        {provider.model_label ?? provider.model}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-xs">
                  {savedMemoryManagerModel
                    ? `The Memory Manager will use ${savedMemoryManagerModel}.`
                    : "The Memory Manager will use the model configured by the server."}
                </p>
                {modelProviders.isLoading ? (
                  <p className="text-muted-foreground text-xs">
                    Loading OpenAI Responses models...
                  </p>
                ) : null}
                {modelProviders.isError ? (
                  <p className="text-destructive text-xs">
                    OpenAI Responses models could not be loaded.
                  </p>
                ) : null}
              </div>
            </section>
          ) : null}

          {activeSection === "Advanced" ? (
            <>
              <section className="border-border/60 bg-muted/10 flex flex-col gap-4 rounded-xl border p-5">
                <div>
                  <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                    Interface
                  </p>
                  <h3 className="text-foreground mt-1 text-base font-semibold">
                    Cursor theme
                  </h3>
                </div>

                <div className="border-border/70 bg-background/50 flex items-center justify-between gap-4 rounded-lg border px-4 py-3">
                  <div>
                    <p className="text-foreground text-sm font-medium">
                      Render assistant Markdown
                    </p>
                    <p className="text-muted-foreground text-xs">
                      Format assistant messages with Markdown for this app
                      session.
                    </p>
                  </div>
                  <Switch
                    checked={chatMarkdownEnabled}
                    onCheckedChange={setChatMarkdownEnabled}
                    aria-label="Render assistant Markdown"
                  />
                </div>
              </section>

              <section className="border-border/60 bg-muted/10 flex flex-col gap-4 rounded-xl border p-5">
                <div>
                  <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                    Advanced
                  </p>
                  <h3 className="text-foreground mt-1 text-base font-semibold">
                    Avatar controls
                  </h3>
                </div>

                <div className="border-border/70 bg-background/50 flex items-center justify-between gap-4 rounded-lg border px-4 py-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-foreground text-sm font-medium">
                        Enable avatar transform controls
                      </p>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex h-5 w-5 items-center justify-center rounded-full transition focus-visible:ring-2 focus-visible:outline-none"
                            aria-label="Avatar transform controls help"
                          >
                            <Info className="h-3.5 w-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent
                          side="top"
                          sideOffset={6}
                          className="max-w-xs"
                        >
                          {AVATAR_TRANSFORM_CONTROLS_TOOLTIP}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <p className="text-muted-foreground text-xs">
                      Allow camera orbit/zoom and avatar transform editing in
                      the avatar canvas.
                    </p>
                  </div>
                  <Switch
                    checked={avatarTransformControlsEnabled}
                    onCheckedChange={handleAvatarTransformControlsChange}
                    disabled={isBusy}
                    aria-label="Enable avatar transform controls"
                  />
                </div>
              </section>
            </>
          ) : null}
        </SectionedModalFrame>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
