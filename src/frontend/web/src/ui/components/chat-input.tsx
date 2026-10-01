"use client";

import { useAnima } from "@/query/hooks/useAnima";
import { useModelProviders } from "@/query/hooks/useModelProviders";
import { useRuntimeCapabilities } from "@/query/hooks/useRuntimeCapabilities";
import { useUpdateAnimaChatProfile } from "@/query/mutations/useUpdateAnimaChatProfile";
import {
  formatFileSize,
  USER_FILE_UPLOAD_ACCEPT,
} from "@/lib/user-files/uploads";
import { Button } from "@/ui/components/button";
import { Checkbox } from "@/ui/components/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/ui/components/command";
import { LiveWaveform, SyntheticWaveform } from "@/ui/components/live-waveform";
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorLogo,
  ModelSelectorName,
  ModelSelectorTrigger,
} from "@/ui/components/model-selector";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/ui/components/popover";
import { RadioGroup, RadioGroupItem } from "@/ui/components/radio-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/ui/components/tooltip";
import { useSettings } from "@/ui/settings/SettingsProvider";
import { cn } from "@/lib/utils";
import type { UserFileUploadUppy } from "@/hooks/useUserFileUpload";
import {
  UppyContextProvider,
  useFileInput,
  useUppyContext,
  useUppyState,
} from "@uppy/react";
import type {
  PyChatResponse,
  PyModelProviderCatalogItem,
  PyUserFileResponse,
} from "@/lib/content/catalogTypes";
import type { WebSearchCapability } from "@animama/runtime-contracts/api-types";
import { chatModelSendGate } from "@/lib/chat/model-provider-compatibility";
import {
  selectableNativeTools,
  WEB_SEARCH_TOOL,
  webSearchAvailability,
  withWebSearch,
} from "@/lib/chat/model-provider-native-tools";
import {
  FileText,
  Loader2,
  Mic,
  MicOff,
  Paperclip,
  Settings2,
  TriangleAlert,
  Upload,
} from "lucide-react";
import {
  modelConnectionLabel,
  modelOptionDetail,
  modelOptionLabel,
  selectableChatModels,
} from "@/lib/chat/model-catalog";
import type React from "react";
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import {
  ChatInput,
  ChatInputTextArea,
  ChatInputSubmit,
  ChatInputContext,
} from "@animama/product-ui/components";

type ChatInputFileUploadButtonProps = Omit<
  React.ComponentProps<typeof Button>,
  "children"
> & {
  existingFiles: readonly PyUserFileResponse[];
  existingFilesError?: boolean;
  existingFilesLoading?: boolean;
  onToggleExistingFile: (file: PyUserFileResponse) => void;
  selectedExistingFileIds: readonly string[];
  uppy: UserFileUploadUppy;
};

function ChatInputFileUploadButton({
  uppy,
  existingFiles,
  existingFilesError,
  existingFilesLoading,
  onToggleExistingFile,
  selectedExistingFileIds,
  className,
  disabled,
  ...props
}: ChatInputFileUploadButtonProps) {
  return (
    <UppyContextProvider uppy={uppy}>
      <ChatInputFileUploadButtonInner
        uppy={uppy}
        existingFiles={existingFiles}
        existingFilesError={existingFilesError}
        existingFilesLoading={existingFilesLoading}
        onToggleExistingFile={onToggleExistingFile}
        selectedExistingFileIds={selectedExistingFileIds}
        className={className}
        disabled={disabled}
        {...props}
      />
    </UppyContextProvider>
  );
}

function ChatInputFileUploadButtonInner({
  uppy,
  existingFiles,
  existingFilesError,
  existingFilesLoading,
  onToggleExistingFile,
  selectedExistingFileIds,
  className,
  disabled,
  ...props
}: ChatInputFileUploadButtonProps) {
  const fileInputOptions = useMemo(
    () => ({ multiple: true, accept: USER_FILE_UPLOAD_ACCEPT }),
    [],
  );
  const { getButtonProps, getInputProps } = useFileInput(fileInputOptions);
  const { status, progress } = useUppyContext();
  const uppyFiles = useUppyState(uppy, (state) => state.files);
  const [open, setOpen] = useState(false);
  const buttonProps = getButtonProps();
  const inputProps = getInputProps();
  const isUploading = status === "uploading";
  const label = isUploading
    ? `Uploading ${Math.round(progress)}%`
    : "Add files";
  const isDisabled = Boolean(disabled);
  const selectedFileIds = useMemo(
    () => new Set(selectedExistingFileIds),
    [selectedExistingFileIds],
  );
  const uppyBackendFileIds = useMemo(
    () =>
      new Set(
        Object.values(uppyFiles)
          .map((file) => file.meta.file_id)
          .filter(
            (fileId): fileId is string =>
              typeof fileId === "string" && fileId.trim().length > 0,
          )
          .map((fileId) => fileId.trim()),
      ),
    [uppyFiles],
  );

  return (
    <>
      <input {...inputProps} className="sr-only" tabIndex={-1} />
      <Popover
        open={open}
        onOpenChange={(nextOpen) => setOpen(isDisabled ? false : nextOpen)}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                {...props}
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={isDisabled}
                className={cn(
                  "text-muted-foreground hover:text-foreground rounded-full",
                  className,
                )}
              >
                {isUploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Paperclip className="h-4 w-4" />
                )}
                <span className="sr-only">{label}</span>
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent avoidCollisions={false} side="bottom">
            {label}
          </TooltipContent>
        </Tooltip>
        <PopoverContent
          align="start"
          side="top"
          className="w-[min(22rem,calc(100vw-2rem))] p-1"
        >
          <Button
            type="button"
            variant="ghost"
            className="h-auto w-full justify-start gap-2 px-2 py-2 font-normal"
            onClick={() => {
              setOpen(false);
              buttonProps.onClick();
            }}
          >
            <Upload className="size-4" aria-hidden="true" />
            Upload from computer
          </Button>
          <div className="bg-border mx-1 my-1 h-px" />
          <Command>
            <CommandInput placeholder="Search uploaded files…" />
            <CommandList className="max-h-64">
              {existingFilesLoading ? (
                <div className="text-muted-foreground flex items-center gap-2 px-3 py-5 text-sm">
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Loading uploaded files…
                </div>
              ) : existingFilesError ? (
                <div className="text-destructive px-3 py-5 text-sm">
                  Uploaded files could not be loaded.
                </div>
              ) : (
                <>
                  <CommandEmpty>No ready uploaded files found.</CommandEmpty>
                  <CommandGroup heading="Files">
                    {existingFiles.map((file) => {
                      const selected = selectedFileIds.has(file.file_id);
                      const representedByUppy = uppyBackendFileIds.has(
                        file.file_id,
                      );
                      const attached = selected || representedByUppy;
                      return (
                        <CommandItem
                          key={file.file_id}
                          value={`${file.original_filename} ${file.normalized_extension} ${file.file_id}`}
                          disabled={representedByUppy}
                          data-checked={attached}
                          aria-pressed={attached}
                          onSelect={() => onToggleExistingFile(file)}
                          className="items-start py-2"
                        >
                          <FileText
                            className="mt-0.5 size-4"
                            aria-hidden="true"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">
                              {file.original_filename}
                            </span>
                            <span className="text-muted-foreground block truncate text-xs">
                              {formatFileSize(
                                file.stored_size_bytes ??
                                  file.declared_size_bytes,
                              )}
                              {" · "}
                              {file.chunk_count ?? 0} chunks
                              {" · "}
                              {file.status === "ready"
                                ? "Ready"
                                : "Keyword only"}
                            </span>
                          </span>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </>
  );
}

ChatInputFileUploadButton.displayName = "ChatInputFileUploadButton";

function groupModelOptions(items: PyModelProviderCatalogItem[]) {
  const groups = new Map<string, PyModelProviderCatalogItem[]>();
  for (const item of items) {
    const key = modelConnectionLabel(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return Array.from(groups, ([providerLabel, models]) => ({
    providerLabel,
    models,
  }));
}

type WebSearchState = WebSearchCapability | null | undefined;

function supportedNativeTools(
  item: PyModelProviderCatalogItem | null,
  webSearch: WebSearchState,
) {
  return selectableNativeTools(item, webSearch);
}

function supportedReasoningEfforts(item: PyModelProviderCatalogItem | null) {
  return Array.isArray(item?.supported_reasoning_efforts)
    ? item.supported_reasoning_efforts.filter(
        (effort) => typeof effort === "string",
      )
    : [];
}

function defaultReasoningEffort(item: PyModelProviderCatalogItem | null) {
  return supportedReasoningEfforts(item)[0] ?? null;
}

/** Every available tool starts on, including web search. */
function defaultNativeTools(
  item: PyModelProviderCatalogItem | null,
  webSearch: WebSearchState,
) {
  return supportedNativeTools(item, webSearch);
}

function hasModelSettingsMenu(
  item: PyModelProviderCatalogItem,
  webSearch: WebSearchState,
) {
  return (
    supportedNativeTools(item, webSearch).length > 0 ||
    webSearchAvailability(item, webSearch) !== null ||
    (item.supports_reasoning === true &&
      supportedReasoningEfforts(item).length > 0)
  );
}

function nativeToolLabel(tool: string) {
  if (tool === "web_search") return "Web search";
  return tool.replaceAll("_", " ");
}

type ChatInputModelSelectorProps = React.ComponentProps<typeof Button> & {
  animaId: string;
  activeChat?: PyChatResponse | null;
  closeSignal?: number;
  disabled?: boolean;
  onIncompatibleModelSelect?: (item: PyModelProviderCatalogItem) => void;
  onModelChange?: () => void;
};

type SelectModelResult = {
  ok: boolean;
  // Settings-only interactions can target the already-active model. Treat those
  // as successful but unchanged so they do not reset request-scoped options or
  // trigger broader model refresh side effects.
  changed: boolean;
};

function ChatInputModelSelector({
  activeChat = null,
  animaId,
  className,
  closeSignal = 0,
  disabled: disabledProp,
  onIncompatibleModelSelect,
  onModelChange,
  ...props
}: ChatInputModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const { data: anima } = useAnima(animaId);
  const { data: catalog = [], isSuccess: catalogLoaded } = useModelProviders();
  const updateAnimaChatProfile = useUpdateAnimaChatProfile();
  const webSearch = useRuntimeCapabilities().data?.web_search;
  const { chatRequestOptions, setChatRequestOverrides } = useSettings();
  const skipNextActiveItemResetRef = useRef(false);
  // Track the model id instead of the full catalog object. Query refreshes can
  // replace model objects without changing the active model, and those refreshes
  // should not overwrite the user's per-request tool/reasoning selections.
  const lastActiveItemIdRef = useRef<string | null>(null);
  const activeItemId = anima?.chat_profile?.default_model_provider_id ?? null;
  // Embedding models never appear; hidden ones only while they are the choice.
  const models = useMemo(
    () => selectableChatModels(catalog, activeItemId),
    [activeItemId, catalog],
  );
  const activeItem = useMemo(
    () => models.find((item) => item.id === activeItemId) ?? null,
    [activeItemId, models],
  );
  // A removed model (or connection) leaves the Anima's choice unavailable.
  const activeUnavailable =
    Boolean(activeItemId) && catalogLoaded && !activeItem;
  const modelGroups = useMemo(() => groupModelOptions(models), [models]);
  const selectedNativeTools = useMemo(() => {
    const supported = new Set(supportedNativeTools(activeItem, webSearch));
    const requested = Array.isArray(chatRequestOptions?.native_tools)
      ? chatRequestOptions.native_tools
      : defaultNativeTools(activeItem, webSearch);
    return new Set(requested.filter((tool) => supported.has(tool)));
  }, [activeItem, chatRequestOptions?.native_tools, webSearch]);
  const selectedReasoningEffort =
    chatRequestOptions?.reasoning_effort ?? defaultReasoningEffort(activeItem);
  const isDisabled = Boolean(
    disabledProp || updateAnimaChatProfile.isPending || !anima?.chat_profile,
  );
  const tooltipLabel = activeItem
    ? modelOptionLabel(activeItem)
    : activeUnavailable
      ? "Model unavailable. Select another model."
      : anima?.chat_profile
        ? "Select model"
        : "No chat profile";

  const resetChatRequestSettingsForModel = useCallback(
    (item: PyModelProviderCatalogItem) => {
      const nativeTools = defaultNativeTools(item, webSearch);
      setChatRequestOverrides((current) => ({
        ...current,
        native_tools: nativeTools.length ? nativeTools : undefined,
        reasoning_effort: defaultReasoningEffort(item) ?? undefined,
      }));
    },
    [setChatRequestOverrides, webSearch],
  );

  const stopSettingsMenuEvent = useCallback((event: React.SyntheticEvent) => {
    // The popover sits inside a selectable model row. Without this, checkbox or
    // radio events also select the row, which resets settings back to defaults.
    event.stopPropagation();
  }, []);

  const selectModel = useCallback(
    async (item: PyModelProviderCatalogItem): Promise<SelectModelResult> => {
      if (isDisabled) return { ok: false, changed: false };

      const gate = chatModelSendGate(activeChat, item);
      if (!gate.ok) {
        if (gate.reason === "api_standard_mismatch") {
          onIncompatibleModelSelect?.(item);
        } else if (gate.reason === "unsupported_model") {
          toast.error("This model is not available for direct chat yet.");
        } else {
          toast.error("Select a model before chatting.");
        }
        return { ok: false, changed: false };
      }
      if (item.id === activeItemId) {
        return { ok: true, changed: false };
      }

      try {
        await updateAnimaChatProfile.mutateAsync({
          animaId,
          body: {
            default_model_provider_id: item.id,
          },
        });
        return { ok: true, changed: true };
      } catch {
        toast.error("Failed to update model");
        return { ok: false, changed: false };
      }
    },
    [
      activeChat,
      activeItemId,
      isDisabled,
      animaId,
      onIncompatibleModelSelect,
      updateAnimaChatProfile,
    ],
  );

  const handleSelect = useCallback(
    (item: PyModelProviderCatalogItem) => {
      void selectModel(item).then((result) => {
        if (result.ok) {
          setOpen(false);
        }
        if (result.ok && result.changed) {
          resetChatRequestSettingsForModel(item);
          onModelChange?.();
        }
      });
    },
    [onModelChange, resetChatRequestSettingsForModel, selectModel],
  );

  const applySettingsForModel = useCallback(
    async (
      item: PyModelProviderCatalogItem,
      patch: {
        nativeTools?: string[];
        reasoningEffort?: string;
      },
    ) => {
      const willSelectInactiveModel = item.id !== activeItemId;
      if (willSelectInactiveModel) {
        // Selecting an inactive row from its settings popover causes the active
        // model to change first. The effect below would normally reset the new
        // model to defaults, so skip that one reset and apply the user's chosen
        // override in this callback instead.
        skipNextActiveItemResetRef.current = true;
      }
      const result = await selectModel(item);
      if (!result.ok) {
        if (willSelectInactiveModel) {
          skipNextActiveItemResetRef.current = false;
        }
        return;
      }
      if (willSelectInactiveModel && !result.changed) {
        skipNextActiveItemResetRef.current = false;
      }

      const supportedTools = new Set(supportedNativeTools(item, webSearch));
      const supportedReasoning = supportedReasoningEfforts(item);
      const fallbackReasoning = defaultReasoningEffort(item);
      const fallbackNativeTools = defaultNativeTools(item, webSearch);
      setChatRequestOverrides((current) => {
        const currentNativeTools =
          Array.isArray(current.native_tools) && !willSelectInactiveModel
            ? current.native_tools
            : fallbackNativeTools;
        const nextNativeTools = (
          patch.nativeTools ?? currentNativeTools
        ).filter((tool) => supportedTools.has(tool));
        const requestedReasoning =
          patch.reasoningEffort ??
          (typeof current.reasoning_effort === "string"
            ? current.reasoning_effort
            : undefined);
        const nextReasoningEffort = supportedReasoning.includes(
          requestedReasoning ?? "",
        )
          ? requestedReasoning
          : fallbackReasoning;

        return {
          ...current,
          // Preserve an explicit empty array. It means the user turned a
          // default-on native tool off for future chat requests.
          native_tools: nextNativeTools,
          reasoning_effort: nextReasoningEffort ?? undefined,
        };
      });
      if (result.changed) {
        onModelChange?.();
      }
    },
    [
      activeItemId,
      onModelChange,
      selectModel,
      setChatRequestOverrides,
      webSearch,
    ],
  );

  const handleNativeToolChange = useCallback(
    (item: PyModelProviderCatalogItem, tool: string, checked: boolean) => {
      const activeTools =
        item.id === activeItemId
          ? Array.from(selectedNativeTools)
          : defaultNativeTools(item, webSearch);
      const nextTools = checked
        ? Array.from(new Set([...activeTools, tool]))
        : activeTools.filter((activeTool) => activeTool !== tool);
      void applySettingsForModel(item, { nativeTools: nextTools });
    },
    [activeItemId, applySettingsForModel, selectedNativeTools, webSearch],
  );

  const handleReasoningChange = useCallback(
    (item: PyModelProviderCatalogItem, effort: string) => {
      void applySettingsForModel(item, { reasoningEffort: effort });
    },
    [applySettingsForModel],
  );

  useEffect(() => {
    if (closeSignal > 0) {
      setOpen(false);
    }
  }, [closeSignal]);

  useLayoutEffect(() => {
    if (!activeItem || !activeItemId) return;
    if (lastActiveItemIdRef.current === activeItemId) return;
    lastActiveItemIdRef.current = activeItemId;
    if (skipNextActiveItemResetRef.current) {
      skipNextActiveItemResetRef.current = false;
      return;
    }
    resetChatRequestSettingsForModel(activeItem);
  }, [activeItem, activeItemId, resetChatRequestSettingsForModel]);

  // Search availability can change while the same model stays selected: the
  // capability loads after the catalog, or the owner configures or removes
  // the backend. Follow the default then (on when available) without
  // touching the model's other options.
  const activeSearchState = webSearchAvailability(activeItem, webSearch)?.state;
  const lastSearchStateRef = useRef<{ id: string; state?: string } | null>(
    null,
  );
  useEffect(() => {
    if (!activeItemId) return;
    const previous = lastSearchStateRef.current;
    lastSearchStateRef.current = { id: activeItemId, state: activeSearchState };
    if (previous?.id !== activeItemId || previous.state === activeSearchState)
      return;
    const available =
      activeSearchState === "hosted" || activeSearchState === "application";
    setChatRequestOverrides((current) => ({
      ...current,
      native_tools: withWebSearch(current.native_tools, available),
    }));
  }, [activeItemId, activeSearchState, setChatRequestOverrides]);

  return (
    <ModelSelector
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen && isDisabled) return;
        setOpen(nextOpen);
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <ModelSelectorTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn(
                "text-muted-foreground hover:text-foreground rounded-full",
                className,
              )}
              disabled={isDisabled}
              {...props}
            >
              {updateAnimaChatProfile.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : activeUnavailable ? (
                <TriangleAlert className="text-destructive size-4" />
              ) : activeItem?.logo_provider ? (
                <ModelSelectorLogo
                  provider={activeItem.logo_provider}
                  className="size-4"
                />
              ) : (
                <span className="size-4" aria-hidden="true" />
              )}
              <span className="sr-only">{tooltipLabel}</span>
            </Button>
          </ModelSelectorTrigger>
        </TooltipTrigger>
        <TooltipContent avoidCollisions={false} side="bottom">
          {tooltipLabel}
        </TooltipContent>
      </Tooltip>
      <ModelSelectorContent title="Select model">
        <ModelSelectorInput placeholder="Search models..." />
        <ModelSelectorList>
          <ModelSelectorEmpty>No models found.</ModelSelectorEmpty>
          {modelGroups.map((group) => (
            <ModelSelectorGroup
              key={group.providerLabel}
              heading={group.providerLabel}
            >
              {group.models.map((item) => {
                const isActive = item.id === activeItemId;
                const rowNativeTools = supportedNativeTools(item, webSearch);
                const rowReasoningEfforts = supportedReasoningEfforts(item);
                const rowSelectedNativeTools = isActive
                  ? selectedNativeTools
                  : new Set(defaultNativeTools(item, webSearch));
                const rowSelectedReasoningEffort = isActive
                  ? selectedReasoningEffort
                  : defaultReasoningEffort(item);
                const showSettingsMenu = hasModelSettingsMenu(item, webSearch);
                const rowSearch = webSearchAvailability(item, webSearch);
                const rowGate = chatModelSendGate(activeChat, item);
                const rowUnsupported =
                  !rowGate.ok && rowGate.reason === "unsupported_model";
                // Owner models need a context window before they can chat.
                const rowNeedsWindow =
                  item.source === "owner" && item.context_window_tokens == null;
                const modelName = item.model_label || item.model;
                const providerName = modelOptionDetail(item);
                return (
                  <ModelSelectorItem
                    key={item.id}
                    // The id keeps values unique when one model is listed twice.
                    value={`${providerName} ${modelName} ${item.model} ${item.id}`}
                    disabled={
                      updateAnimaChatProfile.isPending ||
                      rowUnsupported ||
                      rowNeedsWindow
                    }
                    data-checked={isActive}
                    onSelect={() => handleSelect(item)}
                    className="gap-2"
                  >
                    {item.logo_provider ? (
                      <ModelSelectorLogo provider={item.logo_provider} />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <ModelSelectorName className="block">
                        {modelName}
                      </ModelSelectorName>
                      <span className="text-muted-foreground block truncate text-xs">
                        {rowUnsupported
                          ? "Not available for direct chat yet"
                          : rowNeedsWindow
                            ? "Set its context window in App Settings → Models"
                            : providerName}
                      </span>
                    </div>
                    {showSettingsMenu ? (
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            aria-label={`${modelName} settings`}
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            disabled={updateAnimaChatProfile.isPending}
                            className="text-muted-foreground hover:text-foreground size-7 rounded-full"
                            onClick={(event) => {
                              event.stopPropagation();
                            }}
                            onPointerDown={(event) => {
                              event.stopPropagation();
                            }}
                          >
                            <Settings2 className="h-4 w-4" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent
                          align="end"
                          side="right"
                          sideOffset={8}
                          className="w-56 p-3"
                          onClick={stopSettingsMenuEvent}
                          onPointerDown={stopSettingsMenuEvent}
                          onKeyDown={stopSettingsMenuEvent}
                          onOpenAutoFocus={(event) => {
                            event.preventDefault();
                          }}
                        >
                          <div className="space-y-3">
                            {rowSearch?.state === "unavailable" ? (
                              <div className="space-y-1">
                                <label className="text-muted-foreground flex items-center gap-2 text-sm">
                                  <Checkbox
                                    checked={false}
                                    disabled
                                    aria-describedby={`${item.id}-web-search-reason`}
                                  />
                                  <span>
                                    {nativeToolLabel(WEB_SEARCH_TOOL)}
                                  </span>
                                </label>
                                <p
                                  id={`${item.id}-web-search-reason`}
                                  className="text-muted-foreground text-xs"
                                >
                                  {rowSearch.reason}
                                </p>
                              </div>
                            ) : null}
                            {rowNativeTools.length > 0 ? (
                              <div className="space-y-2">
                                {rowNativeTools.map((tool) => (
                                  <label
                                    key={tool}
                                    className="flex cursor-pointer items-center gap-2 text-sm"
                                  >
                                    <Checkbox
                                      checked={rowSelectedNativeTools.has(tool)}
                                      disabled={
                                        updateAnimaChatProfile.isPending
                                      }
                                      onCheckedChange={(checked) => {
                                        handleNativeToolChange(
                                          item,
                                          tool,
                                          checked === true,
                                        );
                                      }}
                                    />
                                    <span>{nativeToolLabel(tool)}</span>
                                  </label>
                                ))}
                              </div>
                            ) : null}
                            {rowReasoningEfforts.length > 0 ? (
                              <div className="space-y-2">
                                <div className="text-muted-foreground text-xs font-medium">
                                  Reasoning
                                </div>
                                <RadioGroup
                                  value={rowSelectedReasoningEffort ?? ""}
                                  onValueChange={(effort) => {
                                    handleReasoningChange(item, effort);
                                  }}
                                >
                                  {rowReasoningEfforts.map((effort) => (
                                    <label
                                      key={effort}
                                      className="flex cursor-pointer items-center gap-2 text-sm"
                                    >
                                      <RadioGroupItem
                                        value={effort}
                                        disabled={
                                          updateAnimaChatProfile.isPending
                                        }
                                      />
                                      <span>{effort}</span>
                                    </label>
                                  ))}
                                </RadioGroup>
                              </div>
                            ) : null}
                          </div>
                        </PopoverContent>
                      </Popover>
                    ) : null}
                  </ModelSelectorItem>
                );
              })}
            </ModelSelectorGroup>
          ))}
        </ModelSelectorList>
      </ModelSelectorContent>
    </ModelSelector>
  );
}

ChatInputModelSelector.displayName = "ChatInputModelSelector";

type ChatInputDictationProps = React.ComponentProps<typeof Button>;

function ChatInputDictation({ className, ...props }: ChatInputDictationProps) {
  const context = useContext(ChatInputContext);
  const activeMicMode = context.activeMicMode ?? null;
  const isMicCaptureActive = context.isMicCaptureActive ?? false;
  const isDictationPreparing = context.isDictationPreparing ?? false;
  const isUserSpeaking = context.isUserSpeaking ?? false;
  const isVoiceMicMuted = context.isVoiceMicMuted ?? false;
  const onDictationStart = context.onDictationStart;
  const onMicSessionStop = context.onMicSessionStop;
  const onVoiceMicToggle = context.onVoiceMicToggle;
  const dictationStream = context.dictationStream;
  const hasDictationStream = Boolean(dictationStream);
  const micWaveformMode =
    context.micWaveformMode ??
    (context.showMicWaveform === false ? "none" : "live");
  const showMicWaveform = micWaveformMode !== "none";

  if (activeMicMode) {
    const isVoiceMode = activeMicMode === "voice";
    const actionLabel = isVoiceMode
      ? isVoiceMicMuted
        ? "Unmute Mic"
        : "Mute Mic"
      : "Stop dictation";
    const actionIcon = isVoiceMode ? (
      isVoiceMicMuted ? (
        <MicOff className="h-4 w-4" />
      ) : (
        <Mic className="h-4 w-4" />
      )
    ) : (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-label="Stop"
      >
        <title>Stop</title>
        <rect x="6" y="6" width="12" height="12" />
      </svg>
    );
    const handleClick = isVoiceMode ? onVoiceMicToggle : onMicSessionStop;

    return (
      <div className="flex items-center gap-2">
        {showMicWaveform || isDictationPreparing ? (
          isDictationPreparing ? (
            <div className="text-muted-foreground flex h-12 w-12 items-center justify-center">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : micWaveformMode === "synthetic" ? (
            <SyntheticWaveform
              active={isUserSpeaking && isMicCaptureActive && !isVoiceMicMuted}
              muted={!isMicCaptureActive || isVoiceMicMuted}
              height={48}
              className="text-muted-foreground w-12"
            />
          ) : (
            <LiveWaveform
              active={hasDictationStream && isMicCaptureActive}
              processing={isMicCaptureActive && !hasDictationStream}
              mode="static"
              height={48}
              stream={dictationStream ?? undefined}
              className="text-muted-foreground w-12"
            />
          )
        ) : null}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn(
                "border-border text-muted-foreground hover:text-foreground rounded-full border-1",
                isVoiceMode &&
                  isVoiceMicMuted &&
                  "border-red-500/30 bg-red-500/10 text-red-500 hover:bg-red-500/15 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300",
                className,
              )}
              onClick={handleClick}
              {...props}
            >
              {actionIcon}
              <span className="sr-only">{actionLabel}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent avoidCollisions={false} side="bottom">
            {actionLabel}
          </TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn(
            "text-muted-foreground hover:text-foreground rounded-full",
            className,
          )}
          onClick={onDictationStart}
          {...props}
        >
          <Mic className="h-4 w-4" />
          <span className="sr-only">Dictate</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent avoidCollisions={false} side="bottom">
        Dictate
      </TooltipContent>
    </Tooltip>
  );
}
ChatInputDictation.displayName = "ChatInputDictation";

export {
  ChatInput,
  ChatInputTextArea,
  ChatInputSubmit,
  ChatInputFileUploadButton,
  ChatInputModelSelector,
  ChatInputDictation,
};
