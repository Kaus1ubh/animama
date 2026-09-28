"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  AudioLines,
  Brain,
  Database,
  Info,
  Keyboard,
  KeyRound,
  LifeBuoy,
  Palette,
  Settings2,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { SafetySettingsSection } from "@/ui/settings/SafetySettingsSection";

import {
  DEFAULT_ELEVENLABS_TTS_MODEL_ID,
  DEFAULT_ELEVENLABS_V3_FINALIZED_CHUNKING,
  DEFAULT_ANIMAMA_PREFERENCES,
  ELEVENLABS_TTS_MODEL_OPTIONS,
  ELEVENLABS_V3_FINALIZED_CHUNKING_OPTIONS,
  isElevenLabsFinalizedTtsModelId,
  isParakeetWebgpuPreferred,
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
import { useDesktopUpdates } from "@/hooks/useDesktopUpdates";
import {
  APPEARANCE_COLOR_GROUP_LABELS,
  APPEARANCE_COLOR_TOKENS,
} from "@/lib/theme/appearance-overrides";
import { BEHAVIOR_FLAGS } from "@/lib/settings/behavior-defaults";
import {
  AboutVersionSetting,
  CopyDiagnosticsSetting,
  OpenLogsSetting,
} from "@/ui/settings/AboutSettings";
import {
  AppBehaviorSetting,
  behaviorLabel,
  ResetAppSettingsSetting,
} from "@/ui/settings/BehaviorDataSettings";
import {
  DefaultAnimaSetting,
  DefaultChatModelSetting,
} from "@/ui/settings/GeneralDefaultsSettings";
import {
  MicrophoneDeviceSetting,
  MicrophoneSensitivitySetting,
  MicrophoneTestSetting,
} from "@/ui/settings/MicrophoneSettings";
import {
  AdvancedColorsToggleSetting,
  AppearanceColorSetting,
  ResetColorsSetting,
  AppearanceModeSetting,
} from "@/ui/settings/AppearanceSettings";
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
import { DialogOverlay } from "@/ui/components/dialog";
import { DisplayNameSettings } from "@/ui/profile/DisplayNameSettings";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/select";
import { useSettings } from "@/ui/settings/SettingsProvider";
import {
  DesktopCredentialsPanel,
  useDesktopCredentialsAvailable,
} from "@/ui/settings/DesktopCredentialsPanel";
import { DesktopFeaturePacksPanel } from "@/ui/settings/DesktopFeaturePacksPanel";
import { DesktopUpdatesPanel } from "@/ui/settings/DesktopUpdatesPanel";
import { ParakeetWebgpuDetails } from "@/ui/settings/ExperimentalSettings";
import {
  getSttSettingsOptions,
  getSttSettingsPreference,
  getSttSettingsSelection,
} from "@/lib/speech/stt-settings";
import {
  FLAT_SETTINGS_PANEL_CLASS_NAME,
  SettingsGroup,
  SettingsRow,
} from "@/ui/settings/SettingsLayout";
import { SettingsSearch } from "@/ui/settings/SettingsSearch";
import {
  availableSettingsSections,
  type SettingsSearchEntry,
} from "@/ui/settings/settings-search";
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
  description?: string;
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
    <SettingsRow
      label={label}
      description={description}
      control={
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
      }
    />
  );
}

const sections = [
  "General",
  "Appearance",
  "Voice",
  "Shortcuts",
  "Memory & Emotion",
  "Safety",
  "API Keys",
  "Data",
  "Advanced",
  "About",
] as const;
type ApplicationSettingsSection = (typeof sections)[number];

/**
 * One searchable setting. Consecutive entries sharing a `group` render inside
 * one SettingsGroup; entries without a group render a self-titled panel.
 */
type SettingEntry = SettingsSearchEntry<ApplicationSettingsSection> & {
  id: string;
  /** Hidden entries are neither rendered nor searchable (e.g. unavailable sub-options). */
  hidden?: boolean;
  /** Collapsed entries stay searchable but render only while expanded. */
  collapsed?: boolean;
  render: () => ReactNode;
};

const SECTION_ICONS: Record<ApplicationSettingsSection, LucideIcon> = {
  General: Settings2,
  Appearance: Palette,
  Voice: AudioLines,
  Shortcuts: Keyboard,
  "Memory & Emotion": Brain,
  Safety: LifeBuoy,
  "API Keys": KeyRound,
  Data: Database,
  Advanced: SlidersHorizontal,
  About: Info,
};

/** Delay before a search-revealed setting's highlight fades. */
const REVEAL_HIGHLIGHT_MS = 1600;

const GROUP_DESCRIPTIONS: Record<string, string> = {
  "Desktop shortcuts": "Press to talk also supports a mouse button.",
};

const SELECT_TRIGGER_CLASS_NAME = "w-56";

/** Render entries in order, merging consecutive same-group entries into one group. */
function renderSettingEntries(
  entries: readonly SettingEntry[],
  highlightedEntryId: string | null,
  section: ApplicationSettingsSection,
): ReactNode {
  // The wrapper is the search reveal target; it stays a direct child of the
  // group's divider list so row separators are unchanged.
  const renderItem = (item: SettingEntry) => (
    <div
      key={item.id}
      data-setting-id={item.id}
      className={cn(
        // empty:hidden collapses panels that render nothing in this runtime.
        "-mx-3 rounded-lg px-3 empty:hidden motion-safe:transition-colors motion-safe:duration-700",
        highlightedEntryId === item.id && "bg-primary/10",
      )}
    >
      {item.render()}
    </div>
  );
  // Theme controls form one continuous list, including expanded colours.
  if (section === "Appearance") {
    return <SettingsGroup>{entries.map(renderItem)}</SettingsGroup>;
  }

  const blocks: Array<{ key: string; group?: string; items: SettingEntry[] }> =
    [];
  for (const entry of entries) {
    const previous = blocks.at(-1);
    if (entry.group && previous?.group === entry.group) {
      previous.items.push(entry);
    } else {
      blocks.push({ key: entry.id, group: entry.group, items: [entry] });
    }
  }
  return (
    <div className="[&>*:not(:first-child)]:border-border/40 flex flex-col [&>*:not(:first-child)]:mt-6 [&>*:not(:first-child)]:border-t [&>*:not(:first-child)]:pt-6">
      {blocks.map((block) =>
        block.group ? (
          <SettingsGroup
            key={block.key}
            title={
              block.group === "Defaults for Animas" ? undefined : block.group
            }
            description={GROUP_DESCRIPTIONS[block.group]}
          >
            {block.items.map(renderItem)}
          </SettingsGroup>
        ) : (
          renderItem(block.items[0]!)
        ),
      )}
    </div>
  );
}

const OPENAI_RESPONSES_PROVIDER = "OpenAIResponsesHTTPAgent";
const SYSTEM_MEMORY_MANAGER_MODEL = "__system_default__";

const AVATAR_TRANSFORM_CONTROLS_TOOLTIP =
  "Press G to move, R to rotate, and S to scale the avatar. Press Esc to exit a transform mode. In avatar mode, drag or scroll the canvas to orbit and zoom. In avatar-chat mode, hold Ctrl while dragging to orbit and Ctrl + scroll to zoom.";

const shortcutRows: Array<{
  action: DesktopShortcutAction;
  description?: string;
  allowMouseShortcut?: boolean;
}> = [
  {
    action: "press_to_talk",
    description: "Temporarily unmute Voice Mode while held.",
    allowMouseShortcut: true,
  },
  {
    action: "quick_chat",
  },
  {
    action: "toggle_voice_mode",
  },
  {
    action: "toggle_voice_mute",
  },
  {
    action: "skip_tts",
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
  const [parakeetWebgpuPreferred, setParakeetWebgpuPreferred] = useState(
    isParakeetWebgpuPreferred(resolvedUserPreferences),
  );
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
  const [searchQuery, setSearchQuery] = useState("");
  const [advancedColorsOpen, setAdvancedColorsOpen] = useState(false);
  const [revealRequest, setRevealRequest] = useState<{
    id: string;
    nonce: number;
  } | null>(null);
  const [highlightedEntryId, setHighlightedEntryId] = useState<string | null>(
    null,
  );
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
  const savedParakeetWebgpuPreferred = isParakeetWebgpuPreferred(
    resolvedUserPreferences,
  );
  useEffect(() => {
    setParakeetWebgpuPreferred(savedParakeetWebgpuPreferred);
  }, [savedParakeetWebgpuPreferred]);
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
    setSearchQuery("");
    setAdvancedColorsOpen(false);
    setRevealRequest(null);
    setHighlightedEntryId(null);
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

  // After a search selection renders its section, scroll the setting into
  // view, move focus to its control and briefly highlight the row.
  useEffect(() => {
    if (!revealRequest) return;
    const target = document.querySelector<HTMLElement>(
      `[data-setting-id="${revealRequest.id}"]`,
    );
    if (!target) return;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    target.scrollIntoView({
      block: "center",
      behavior: reduceMotion ? "auto" : "smooth",
    });
    const control =
      target.querySelector<HTMLElement>(
        // Prefer visible controls over the transparent native colour picker.
        '[role="switch"]:not(:disabled), [role="combobox"]:not(:disabled), input:not(:disabled):not([type="color"])',
      ) ?? target.querySelector<HTMLElement>("button:not(:disabled)");
    control?.focus({ preventScroll: true });
    setHighlightedEntryId(revealRequest.id);
    const timer = window.setTimeout(
      () => setHighlightedEntryId(null),
      REVEAL_HIGHLIGHT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [revealRequest]);

  const sttProviderOptions = useMemo(
    () =>
      getSttSettingsOptions(getSttProviderOptions(parakeetAvailable, platform)),
    [parakeetAvailable, platform],
  );
  const ttsProviderOptions = useMemo(
    () => getTtsProviderOptions(platform),
    [platform],
  );

  const selectedSttOption = getSttSettingsSelection(
    selectedSttProvider,
    parakeetWebgpuPreferred,
  );
  const currentSttOption = sttProviderOptions.find(
    (option) => option.id === selectedSttOption,
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
      const nextSpeech = getSttSettingsPreference(value);
      if (!nextSpeech || isSaving || isInitializing) return;
      const nextProvider = nextSpeech.stt_provider;
      const nextOption = sttProviderOptions.find(
        (option) => option.id === value,
      );
      if (!nextOption || nextOption.disabled) {
        if (nextOption?.reason) {
          toast.error(nextOption.reason);
        }
        return;
      }
      const previousProvider = selectedSttProvider;
      const previousWebgpu = parakeetWebgpuPreferred;
      setSelectedSttProvider(nextProvider);
      setParakeetWebgpuPreferred(
        nextSpeech.stt_parakeet_webgpu ?? previousWebgpu,
      );
      setIsSaving(true);

      void updateUserPreferences({ speech: nextSpeech })
        .catch(() => {
          setSelectedSttProvider(previousProvider);
          setParakeetWebgpuPreferred(previousWebgpu);
          toast.error("Failed to update STT provider.");
        })
        .finally(() => setIsSaving(false));
    },
    [
      isInitializing,
      isSaving,
      selectedSttProvider,
      parakeetWebgpuPreferred,
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
  // The updates panel renders nothing while updates are unavailable (browser,
  // unpackaged or unsupported desktop), so its entry is hidden then too.
  const desktopUpdates = useDesktopUpdates();
  const credentialsAvailable = useDesktopCredentialsAvailable();
  const desktopShortcutsAvailable =
    platform.isDesktop && Boolean(platform.desktopBridge.shortcuts);
  const isAudioBusy = isBusy;

  const settingEntries: SettingEntry[] = [
    {
      id: "display-name",
      section: "General",
      group: "Profile",
      label: "Display name",
      keywords: ["name", "user", "profile"],
      render: () => (
        <DisplayNameSettings
          className={cn(FLAT_SETTINGS_PANEL_CLASS_NAME, "py-3")}
        />
      ),
    },
    {
      id: "default-anima",
      section: "General",
      group: "Defaults",
      label: "Default Anima",
      keywords: ["startup", "open", "pinned", "last opened"],
      render: () => <DefaultAnimaSetting disabled={isBusy} />,
    },
    {
      id: "default-chat-model",
      section: "General",
      group: "Defaults",
      label: "Default chat model",
      keywords: ["model", "llm", "new anima", "openai", "provider"],
      render: () => <DefaultChatModelSetting disabled={isBusy} />,
    },
    {
      id: "volume",
      section: "General",
      group: "Audio",
      label: "Volume",
      keywords: [
        "sound",
        "mute",
        "tts",
        "sfx",
        "sound effects",
        "bgm",
        "background music",
      ],
      render: () => (
        <AudioVolumePanel
          disabled={isAudioBusy}
          showTitle={false}
          showBgmDetail
          className="py-3"
          volumeCardClassName={FLAT_SETTINGS_PANEL_CLASS_NAME}
        />
      ),
    },
    {
      id: "provider-keys",
      section: "API Keys",
      label: "API keys",
      keywords: [
        "api key",
        "credentials",
        "openai",
        "deepseek",
        "hugging face",
        "gemini",
        "elevenlabs",
      ],
      hidden: !credentialsAvailable,
      render: () => (
        <DesktopCredentialsPanel
          className={FLAT_SETTINGS_PANEL_CLASS_NAME}
          showTitle={false}
        />
      ),
    },
    {
      id: "feature-packs",
      section: "General",
      label: "Optional feature packs",
      keywords: [
        "offline speech",
        "parakeet",
        "document processing",
        "included content",
        "download",
      ],
      hidden: !platform.isDesktop,
      render: () => (
        <DesktopFeaturePacksPanel className={FLAT_SETTINGS_PANEL_CLASS_NAME} />
      ),
    },
    {
      id: "about-version",
      section: "About",
      group: "Animama",
      label: "Version",
      keywords: ["about", "version", "platform", "build"],
      render: () => <AboutVersionSetting />,
    },
    {
      id: "updates",
      section: "About",
      label: "Desktop updates",
      keywords: ["update", "version", "upgrade", "restart"],
      hidden: desktopUpdates.status.state === "unavailable",
      render: () => (
        <DesktopUpdatesPanel className={FLAT_SETTINGS_PANEL_CLASS_NAME} />
      ),
    },
    {
      id: "open-logs",
      section: "About",
      group: "Diagnostics",
      label: "Open logs folder",
      keywords: ["logs", "troubleshooting", "debug", "support"],
      hidden: !platform.isDesktop || !platform.desktopBridge.runtime,
      render: () => <OpenLogsSetting />,
    },
    {
      id: "copy-diagnostics",
      section: "About",
      group: "Diagnostics",
      label: "Copy diagnostics summary",
      keywords: ["diagnostics", "bug report", "support", "troubleshooting"],
      render: () => <CopyDiagnosticsSetting />,
    },
    {
      id: "appearance-mode",
      section: "Appearance",
      group: "Theme",
      label: "Theme",
      keywords: ["theme", "mode", "dark", "light", "system", "dark mode"],
      render: () => <AppearanceModeSetting />,
    },
    ...APPEARANCE_COLOR_TOKENS.filter((token) => token.group === "basic").map(
      (token): SettingEntry => ({
        id: `appearance-${token.key}`,
        section: "Appearance",
        group: APPEARANCE_COLOR_GROUP_LABELS.basic,
        label: `${token.label} colour`,
        keywords: ["theme", "color", "colour", "override", "hex"],
        render: () => <AppearanceColorSetting token={token} />,
      }),
    ),
    {
      id: "appearance-reset-colours",
      section: "Appearance",
      group: APPEARANCE_COLOR_GROUP_LABELS.basic,
      label: "Reset colours",
      keywords: ["theme", "color", "colour", "reset", "default"],
      render: () => <ResetColorsSetting />,
    },
    {
      id: "appearance-advanced-toggle",
      section: "Appearance",
      label: "Advanced colours",
      keywords: ["theme", "color", "colour", "custom", "advanced"],
      render: () => (
        <AdvancedColorsToggleSetting
          open={advancedColorsOpen}
          onToggle={() => setAdvancedColorsOpen((value) => !value)}
        />
      ),
    },
    ...APPEARANCE_COLOR_TOKENS.filter((token) => token.group !== "basic").map(
      (token): SettingEntry => ({
        id: `appearance-${token.key}`,
        section: "Appearance",
        group: `Advanced · ${APPEARANCE_COLOR_GROUP_LABELS[token.group]}`,
        label: `${token.label} colour`,
        keywords: ["theme", "color", "colour", "advanced", "hex"],
        collapsed: true,
        render: () => <AppearanceColorSetting token={token} />,
      }),
    ),
    {
      id: "microphone-device",
      section: "Voice",
      group: "Microphone",
      label: "Microphone input device",
      keywords: ["mic", "microphone", "input", "device", "headset", "usb"],
      render: () => (
        <MicrophoneDeviceSetting
          usesSystemRecognizer={
            selectedSttProvider === "browser_external" ||
            selectedSttProvider === "browser_local"
          }
        />
      ),
    },
    {
      id: "microphone-sensitivity",
      section: "Voice",
      group: "Microphone",
      label: "Microphone sensitivity",
      keywords: ["mic", "voice detection", "vad", "noise", "quiet"],
      render: () => <MicrophoneSensitivitySetting disabled={isBusy} />,
    },
    {
      id: "microphone-test",
      section: "Voice",
      group: "Microphone",
      label: "Test microphone",
      keywords: ["mic", "level", "meter", "input level"],
      render: () => <MicrophoneTestSetting />,
    },
    {
      id: "stt-provider",
      section: "Voice",
      group: "Speech-to-Text",
      label: "Speech-to-Text provider",
      description: currentSttOption?.description,
      keywords: [
        "stt",
        "dictation",
        "microphone",
        "transcription",
        "parakeet",
        "voice mode",
        "cpu",
        "gpu",
        "webgpu",
        "experimental",
        "live previews",
      ],
      render: () => (
        <SettingsRow
          label="Provider"
          description={currentSttOption?.description}
          control={
            <Select
              value={selectedSttOption}
              onValueChange={handleSttProviderChange}
              disabled={isBusy}
            >
              <SelectTrigger
                className={SELECT_TRIGGER_CLASS_NAME}
                aria-label="Speech-to-Text provider"
              >
                <SelectValue placeholder="Select provider">
                  {selectedSttOption === "parakeet_webgpu"
                    ? "Parakeet (WebGPU)"
                    : currentSttOption?.label}
                </SelectValue>
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
          }
        >
          {currentSttOption?.reason ? (
            <p className="text-xs text-amber-600 dark:text-amber-500">
              {currentSttOption.reason}
            </p>
          ) : null}
          <ParakeetWebgpuDetails
            selected={selectedSttOption === "parakeet_webgpu"}
          />
          {parakeetAvailable === false ? (
            <DesktopFeaturePacksPanel
              only="parakeet-stt"
              className="bg-muted/20 rounded-lg border-0 p-4"
            />
          ) : null}
          {isInitializing ? (
            <p className="text-muted-foreground text-xs">
              Preparing provider defaults...
            </p>
          ) : null}
        </SettingsRow>
      ),
    },
    {
      id: "tts-enabled",
      section: "Voice",
      group: "Text-to-Speech",
      label: "Enable Text-to-Speech",
      keywords: ["tts", "text-to-speech", "speak", "voice output"],
      render: () => (
        <SettingsRow
          label="Enable Text-to-Speech"
          control={
            <Switch
              checked={ttsEnabled}
              onCheckedChange={handleTtsEnabledChange}
              disabled={isBusy}
              aria-label="Enable Text-to-Speech"
            />
          }
        />
      ),
    },
    {
      id: "tts-stream",
      section: "Voice",
      group: "Text-to-Speech",
      label: "Stream chunked Text-to-Speech",
      description: "Start speaking before the full response is ready.",
      keywords: ["tts", "streaming", "latency"],
      render: () => (
        <SettingsRow
          label="Stream chunked Text-to-Speech"
          description={
            selectedElevenLabsModelIsFinalized
              ? "Unavailable with Eleven v3."
              : "Start speaking before the full response is ready."
          }
          control={
            <Switch
              checked={
                selectedElevenLabsModelIsFinalized ? false : ttsStreamChunks
              }
              onCheckedChange={handleTtsStreamChunksChange}
              disabled={
                isBusy || !ttsEnabled || selectedElevenLabsModelIsFinalized
              }
              aria-label="Stream chunked Text-to-Speech"
            />
          }
        />
      ),
    },
    {
      id: "tts-provider",
      section: "Voice",
      group: "Text-to-Speech",
      label: "Text-to-Speech provider",
      keywords: ["tts", "text-to-speech", "pocket", "elevenlabs", "voice"],
      render: () => (
        <SettingsRow
          label="Provider"
          description={
            !ttsEnabled
              ? "Enable Text-to-Speech to select a provider."
              : currentTtsOption?.description
          }
          control={
            <Select
              value={selectedTtsProvider ?? undefined}
              onValueChange={handleTtsProviderChange}
              disabled={isBusy || !ttsEnabled}
            >
              <SelectTrigger
                className={SELECT_TRIGGER_CLASS_NAME}
                aria-label="Text-to-Speech provider"
              >
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
          }
        >
          {currentTtsOption?.reason && ttsEnabled ? (
            <p className="text-xs text-amber-600 dark:text-amber-500">
              {currentTtsOption.reason}
            </p>
          ) : null}
          {ttsEnabled && selectedTtsProvider === "pocket_tts" ? (
            <p className="text-muted-foreground text-xs">
              Choose a Pocket voice in Anima Settings.
            </p>
          ) : null}
        </SettingsRow>
      ),
    },
    {
      id: "elevenlabs-model",
      section: "Voice",
      group: "Text-to-Speech",
      label: "ElevenLabs model",
      keywords: ["tts", "eleven v3", "flash", "turbo"],
      hidden: !ttsEnabled || selectedTtsProvider !== "elevenlabs",
      render: () => (
        <SettingsRow
          label="ElevenLabs model"
          description={currentElevenLabsModelOption?.description}
          control={
            <Select
              value={selectedElevenLabsModelId}
              onValueChange={handleElevenLabsModelChange}
              disabled={isBusy}
            >
              <SelectTrigger
                className={SELECT_TRIGGER_CLASS_NAME}
                aria-label="ElevenLabs model"
              >
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
          }
        />
      ),
    },
    {
      id: "elevenlabs-audio-grouping",
      section: "Voice",
      group: "Text-to-Speech",
      label: "Audio grouping",
      keywords: ["tts", "elevenlabs", "eleven v3", "chunking", "sentence"],
      hidden: !ttsEnabled || !selectedElevenLabsModelIsFinalized,
      render: () => (
        <SettingsRow
          label="Audio grouping"
          description={
            currentElevenLabsV3FinalizedChunkingOption?.description ??
            "Sentence grouping starts fastest."
          }
          control={
            <Select
              value={selectedElevenLabsV3FinalizedChunking}
              onValueChange={handleElevenLabsV3FinalizedChunkingChange}
              disabled={isBusy}
            >
              <SelectTrigger
                className={SELECT_TRIGGER_CLASS_NAME}
                aria-label="Eleven v3 audio grouping"
              >
                <SelectValue placeholder="Select grouping" />
              </SelectTrigger>
              <SelectContent>
                {ELEVENLABS_V3_FINALIZED_CHUNKING_OPTIONS.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
      ),
    },
    ...shortcutRows.map(
      (row): SettingEntry => ({
        id: `shortcut-${row.action}`,
        section: "Shortcuts",
        group: "Desktop shortcuts",
        label: DESKTOP_SHORTCUT_ACTION_LABELS[row.action],
        description: row.description,
        keywords: ["shortcut", "hotkey", "keyboard", "key binding"],
        hidden: !desktopShortcutsAvailable,
        render: () => (
          <ShortcutRecorder
            label={DESKTOP_SHORTCUT_ACTION_LABELS[row.action]}
            description={row.description}
            shortcut={desktopShortcuts[row.action]}
            isRecording={recordingShortcutAction === row.action}
            disabled={isBusy}
            allowMouseShortcut={row.allowMouseShortcut === true}
            onStartRecording={() => handleShortcutRecordingStart(row.action)}
            onCancelRecording={() => setRecordingShortcutAction(null)}
            onKeyDown={(event) => handleShortcutKeyDown(row.action, event)}
          />
        ),
      }),
    ),
    ...BEHAVIOR_FLAGS.map(
      (flag): SettingEntry => ({
        id: `behavior-${flag}`,
        section: "Memory & Emotion",
        group: "Defaults for Animas",
        label: behaviorLabel(flag),
        keywords: ["memory", "emotion", "default", "inherit", "anima settings"],
        render: () => <AppBehaviorSetting flag={flag} disabled={isBusy} />,
      }),
    ),
    {
      id: "memory-manager-model",
      section: "Memory & Emotion",
      group: "Memory Manager",
      label: "Memory Manager model",
      keywords: ["openai", "responses", "llm"],
      render: () => (
        <SettingsRow
          label="Model"
          control={
            <Select
              value={savedMemoryManagerModel ?? SYSTEM_MEMORY_MANAGER_MODEL}
              onValueChange={handleMemoryManagerModelChange}
              disabled={isBusy}
            >
              <SelectTrigger
                className={SELECT_TRIGGER_CLASS_NAME}
                aria-label="Memory Manager model"
              >
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
          }
        >
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
        </SettingsRow>
      ),
    },
    {
      id: "safety",
      section: "Safety",
      label: "Crisis resources region and AI reminder",
      keywords: [
        "safety",
        "crisis",
        "help",
        "hotline",
        "988",
        "region",
        "reminder",
        "ai notice",
        "protocol",
      ],
      render: () => (
        <SafetySettingsSection
          safety={resolvedUserPreferences.safety}
          updateUserPreferences={updateUserPreferences}
          disabled={isBusy}
        />
      ),
    },
    {
      id: "reset-app-settings",
      section: "Data",
      group: "App data",
      label: "Reset app settings",
      keywords: ["reset", "defaults", "restore", "clear"],
      // Close so controls holding local copies reload the restored values.
      render: () => (
        <ResetAppSettingsSetting onReset={() => onOpenChange(false)} />
      ),
    },
    {
      id: "chat-markdown",
      section: "Advanced",
      group: "Messages",
      label: "Render assistant Markdown",
      keywords: ["chat", "formatting"],
      render: () => (
        <SettingsRow
          label="Render assistant Markdown"
          control={
            <Switch
              checked={chatMarkdownEnabled}
              onCheckedChange={setChatMarkdownEnabled}
              aria-label="Render assistant Markdown"
            />
          }
        />
      ),
    },
    {
      id: "avatar-transform-controls",
      section: "Advanced",
      group: "Avatar controls",
      label: "Enable avatar transform controls",
      keywords: ["move", "rotate", "scale", "orbit", "zoom", "camera"],
      render: () => (
        <SettingsRow
          label={
            <span className="flex items-center gap-2">
              Enable avatar transform controls
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
                <TooltipContent side="top" sideOffset={6} className="max-w-xs">
                  {AVATAR_TRANSFORM_CONTROLS_TOOLTIP}
                </TooltipContent>
              </Tooltip>
            </span>
          }
          control={
            <Switch
              checked={avatarTransformControlsEnabled}
              onCheckedChange={handleAvatarTransformControlsChange}
              disabled={isBusy}
              aria-label="Enable avatar transform controls"
            />
          }
        />
      ),
    },
  ];

  const visibleEntries = settingEntries.filter((entry) => !entry.hidden);
  // Sections without any available setting (e.g. About in a browser before it
  // gains browser-visible rows) are left out of navigation and search.
  const availableSections = availableSettingsSections(sections, visibleEntries);
  const shownSection = availableSections.includes(activeSection)
    ? activeSection
    : (availableSections[0] ?? "General");

  /** Dropdown selection: open the entry's section, then reveal and focus it. */
  const handleSearchSelectEntry = (entry: SettingEntry) => {
    if (entry.collapsed) setAdvancedColorsOpen(true);
    setActiveSection(entry.section);
    setRevealRequest({ id: entry.id, nonce: Date.now() });
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <DialogOverlay />
        <SectionedModalFrame<ApplicationSettingsSection>
          title="App Settings"
          description="Configure application-level voice and interface settings."
          closeLabel="Close App Settings"
          sidebarLabel="Application"
          sidebarTitle="App Settings"
          sections={availableSections}
          sectionIcons={SECTION_ICONS}
          activeSection={shownSection}
          onSectionChange={setActiveSection}
          avoidSidebar
          sidebarHeader={
            <SettingsSearch
              query={searchQuery}
              onQueryChange={setSearchQuery}
              entries={visibleEntries}
              sections={availableSections}
              sectionIcons={SECTION_ICONS}
              onSelectSection={setActiveSection}
              onSelectEntry={handleSearchSelectEntry}
            />
          }
          onEscapeKeyDown={(event) => {
            // Esc clears an active search first instead of closing the dialog.
            if (!searchQuery) return;
            event.preventDefault();
            setSearchQuery("");
          }}
          headerTitle={shownSection}
          gridClassName="md:grid-cols-[240px_minmax(0,1fr)]"
          contentClassName="gap-6"
        >
          {renderSettingEntries(
            visibleEntries.filter(
              (entry) =>
                entry.section === shownSection &&
                (!entry.collapsed || advancedColorsOpen),
            ),
            highlightedEntryId,
            shownSection,
          )}
        </SectionedModalFrame>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
