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
} from "@/ui/components/model-selector";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/ui/components/popover";
import { Slider } from "@/ui/components/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/ui/components/tooltip";
import { UnavailableAction } from "@/ui/components/unavailable-action";
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
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
  Mic,
  MicOff,
  Paperclip,
  RotateCcw,
  Settings2,
  TriangleAlert,
  Upload,
  Zap,
} from "lucide-react";
import {
  alternateModelIds,
  defaultReasoningEffort,
  modelConnectionLabel,
  modelDisplayName,
  modelOptionDetail,
  modelOptionLabel,
  selectableChatModels,
  supportedReasoningEfforts,
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

/**
 * The attach button where the runtime withholds chat uploads: it keeps its
 * familiar place, explains why, and has no uploader, picker or file list.
 */
function ChatInputFileUploadUnavailable({ reason }: { reason: string }) {
  return (
    <UnavailableAction reason={reason} side="bottom">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground rounded-full"
      >
        <Paperclip className="h-4 w-4" />
        <span className="sr-only">Add files</span>
      </Button>
    </UnavailableAction>
  );
}

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

/** Every available tool starts on, including web search. */
function defaultNativeTools(
  item: PyModelProviderCatalogItem | null,
  webSearch: WebSearchState,
) {
  return supportedNativeTools(item, webSearch);
}

/** Friendly labels without changing the catalog's supported effort values. */
function reasoningEffortLabel(effort: string) {
  if (effort === "xhigh") return "Extra high";
  return effort.charAt(0).toUpperCase() + effort.slice(1).replaceAll("_", " ");
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
  // Re-selecting the active model must preserve request-scoped options.
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
  const [effortOpen, setEffortOpen] = useState(false);
  const [featuresOpen, setFeaturesOpen] = useState(false);
  const effortTriggerRef = useRef<HTMLButtonElement>(null);
  const { data: anima } = useAnima(animaId);
  const { data: catalog = [], isSuccess: catalogLoaded } = useModelProviders();
  const updateAnimaChatProfile = useUpdateAnimaChatProfile();
  const webSearch = useRuntimeCapabilities().data?.web_search;
  const { chatRequestOptions, setChatRequestOverrides } = useSettings();
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
  // Rows sharing a name on one connection are told apart without naming APIs.
  const alternateIds = useMemo(() => alternateModelIds(models), [models]);
  const selectedNativeTools = useMemo(() => {
    const supported = new Set(supportedNativeTools(activeItem, webSearch));
    const requested = Array.isArray(chatRequestOptions?.native_tools)
      ? chatRequestOptions.native_tools
      : defaultNativeTools(activeItem, webSearch);
    return new Set(requested.filter((tool) => supported.has(tool)));
  }, [activeItem, chatRequestOptions?.native_tools, webSearch]);
  const reasoningEfforts = supportedReasoningEfforts(activeItem);
  const requestedEffort =
    chatRequestOptions?.reasoning_effort ?? defaultReasoningEffort(activeItem);
  const selectedReasoningEffort = reasoningEfforts.includes(
    requestedEffort ?? "",
  )
    ? requestedEffort
    : defaultReasoningEffort(activeItem);
  const selectedEffortIndex = Math.max(
    0,
    reasoningEfforts.indexOf(selectedReasoningEffort ?? ""),
  );
  const effortLabel = selectedReasoningEffort
    ? reasoningEffortLabel(selectedReasoningEffort)
    : "Model";
  const nativeTools = supportedNativeTools(activeItem, webSearch);
  const searchAvailability = webSearchAvailability(activeItem, webSearch);
  const isDisabled = Boolean(
    disabledProp || updateAnimaChatProfile.isPending || !anima?.chat_profile,
  );
  const tooltipLabel = activeItem
    ? modelOptionLabel(activeItem, alternateIds.has(activeItem.id))
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

  const handleNativeToolChange = (tool: string, checked: boolean) => {
    if (isDisabled || !activeItem || !nativeTools.includes(tool)) return;
    const nextTools = checked
      ? Array.from(new Set([...selectedNativeTools, tool]))
      : Array.from(selectedNativeTools).filter(
          (activeTool) => activeTool !== tool,
        );
    setChatRequestOverrides((current) => ({
      ...current,
      // An explicit empty array keeps default-on tools off for future requests.
      native_tools: nextTools,
    }));
  };

  const handleReasoningChange = (effort: string) => {
    if (isDisabled || !activeItem || !reasoningEfforts.includes(effort)) return;
    setChatRequestOverrides((current) => ({
      ...current,
      reasoning_effort: effort,
    }));
  };

  useEffect(() => {
    if (closeSignal > 0) {
      setOpen(false);
      setEffortOpen(false);
      setFeaturesOpen(false);
    }
  }, [closeSignal]);

  useLayoutEffect(() => {
    if (!activeItem || !activeItemId) return;
    if (lastActiveItemIdRef.current === activeItemId) return;
    lastActiveItemIdRef.current = activeItemId;
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
      <Popover
        open={effortOpen}
        onOpenChange={(nextOpen) => {
          setEffortOpen(nextOpen && !isDisabled);
          if (nextOpen) setFeaturesOpen(false);
        }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  "text-muted-foreground hover:text-foreground h-8 gap-1.5 rounded-full px-2.5 text-xs",
                  className,
                )}
                disabled={isDisabled}
                aria-label={`Model and reasoning: ${tooltipLabel}`}
                ref={effortTriggerRef}
                {...props}
              >
                {updateAnimaChatProfile.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : activeUnavailable ? (
                  <TriangleAlert className="text-destructive size-4" />
                ) : (
                  <Zap className="size-4" aria-hidden="true" />
                )}
                <span>{activeUnavailable ? "Unavailable" : effortLabel}</span>
                <ChevronDown className="size-3" aria-hidden="true" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent avoidCollisions={false} side="top">
            {tooltipLabel}
          </TooltipContent>
        </Tooltip>
        <PopoverContent
          align="end"
          side="top"
          sideOffset={8}
          className="w-[min(20rem,calc(100vw-2rem))] rounded-xl p-4"
          onCloseAutoFocus={(event) => {
            // Let the model chooser take focus when it replaces this popover.
            if (open) event.preventDefault();
          }}
        >
          <div className="flex items-start gap-2">
            <Zap
              className="text-primary mt-1 size-5 shrink-0"
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1 text-center">
              <p className="text-base font-medium">
                {selectedReasoningEffort ? effortLabel : "Select model"}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground h-auto max-w-full gap-1 px-2 py-1 text-xs font-normal"
                disabled={isDisabled}
                aria-label="Select model"
                onClick={() => {
                  setEffortOpen(false);
                  setOpen(true);
                }}
              >
                <span className="truncate">
                  {activeItem
                    ? modelDisplayName(
                        activeItem,
                        alternateIds.has(activeItem.id),
                      )
                    : activeUnavailable
                      ? "Model unavailable"
                      : "Choose a model"}
                </span>
                <ChevronRight className="size-3 shrink-0" aria-hidden="true" />
              </Button>
            </div>
            {selectedReasoningEffort ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground size-7 shrink-0 rounded-full"
                    aria-label="Reset reasoning to model default"
                    disabled={
                      isDisabled ||
                      selectedReasoningEffort ===
                        defaultReasoningEffort(activeItem)
                    }
                    onClick={() => {
                      const effort = defaultReasoningEffort(activeItem);
                      if (effort) handleReasoningChange(effort);
                    }}
                  >
                    <RotateCcw className="size-4" aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Reset reasoning to model default
                </TooltipContent>
              </Tooltip>
            ) : (
              <span className="size-7 shrink-0" aria-hidden="true" />
            )}
          </div>
          {reasoningEfforts.length > 1 ? (
            <div className="relative mt-4">
              <Slider
                min={0}
                max={reasoningEfforts.length - 1}
                step={1}
                value={[selectedEffortIndex]}
                disabled={isDisabled}
                onValueChange={([index]) => {
                  const effort = reasoningEfforts[index];
                  if (effort) handleReasoningChange(effort);
                }}
                thumbProps={{
                  "aria-label": "Reasoning effort",
                  "aria-valuetext": effortLabel,
                }}
                className="[&_[data-slot=slider-thumb]]:border-border h-8 [&_[data-slot=slider-thumb]]:size-8 [&_[data-slot=slider-track]]:h-7"
              />
              <div
                className="pointer-events-none absolute inset-x-4 top-1/2 flex -translate-y-1/2 justify-between"
                aria-hidden="true"
              >
                {reasoningEfforts.map((effort, index) => (
                  <span
                    key={effort}
                    className={cn(
                      "size-1 rounded-full",
                      index < selectedEffortIndex
                        ? "bg-primary-foreground/50"
                        : "bg-muted-foreground/50",
                      index === selectedEffortIndex && "opacity-0",
                    )}
                  />
                ))}
              </div>
            </div>
          ) : activeItem && reasoningEfforts.length === 0 ? (
            <p className="text-muted-foreground mt-3 text-center text-xs">
              This model has no adjustable reasoning.
            </p>
          ) : null}
        </PopoverContent>
      </Popover>
      <Popover
        open={featuresOpen}
        onOpenChange={(nextOpen) => {
          setFeaturesOpen(nextOpen && !isDisabled);
          if (nextOpen) setEffortOpen(false);
        }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-foreground rounded-full"
                disabled={isDisabled || !activeItem}
                aria-label="Chat features"
              >
                <Settings2 className="size-4" aria-hidden="true" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent avoidCollisions={false} side="top">
            Chat features
          </TooltipContent>
        </Tooltip>
        <PopoverContent
          align="end"
          side="top"
          sideOffset={8}
          className="w-64 space-y-3 rounded-xl p-4"
        >
          <p className="text-sm font-medium">Chat features</p>
          {searchAvailability?.state === "unavailable" ? (
            <div className="space-y-1">
              <label className="text-muted-foreground flex items-center gap-2 text-sm">
                <Checkbox
                  checked={false}
                  disabled
                  aria-describedby={`${animaId}-web-search-reason`}
                />
                <span>{nativeToolLabel(WEB_SEARCH_TOOL)}</span>
              </label>
              <p
                id={`${animaId}-web-search-reason`}
                className="text-muted-foreground text-xs"
              >
                {searchAvailability.reason}
              </p>
            </div>
          ) : null}
          {nativeTools.map((tool) => (
            <label
              key={tool}
              className="flex cursor-pointer items-center gap-2 text-sm"
            >
              <Checkbox
                checked={selectedNativeTools.has(tool)}
                disabled={isDisabled}
                onCheckedChange={(checked) =>
                  handleNativeToolChange(tool, checked === true)
                }
              />
              <span>{nativeToolLabel(tool)}</span>
            </label>
          ))}
          {nativeTools.length === 0 && !searchAvailability ? (
            <p className="text-muted-foreground text-xs">
              No optional features for this model.
            </p>
          ) : null}
        </PopoverContent>
      </Popover>
      <ModelSelectorContent
        title="Select model"
        onCloseAutoFocus={(event) => {
          // The chooser opens from a popover that has already closed.
          event.preventDefault();
          effortTriggerRef.current?.focus();
        }}
      >
        <ModelSelectorInput placeholder="Search models..." />
        <ModelSelectorList>
          <ModelSelectorEmpty>No models found.</ModelSelectorEmpty>
          {modelGroups.map((group) => (
            <ModelSelectorGroup
              key={group.providerLabel}
              heading={group.providerLabel}
            >
              {group.models.map((item, index) => {
                const isActive = item.id === activeItemId;
                const rowGate = chatModelSendGate(activeChat, item);
                const rowUnsupported =
                  !rowGate.ok && rowGate.reason === "unsupported_model";
                // Owner models need a context window before they can chat.
                const rowNeedsWindow =
                  item.source === "owner" && item.context_window_tokens == null;
                const modelName = modelDisplayName(
                  item,
                  alternateIds.has(item.id),
                );
                const providerName = modelOptionDetail(item);
                return (
                  <ModelSelectorItem
                    key={item.id}
                    // The index keeps values unique without making the
                    // row's internal id searchable.
                    value={`${providerName} ${modelName} ${item.model} ${index}`}
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
                    {isActive ? (
                      <Check
                        className="size-4 shrink-0"
                        aria-label="Selected"
                      />
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
  ChatInputFileUploadUnavailable,
  ChatInputModelSelector,
  ChatInputDictation,
};
