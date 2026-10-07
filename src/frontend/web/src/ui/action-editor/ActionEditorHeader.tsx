"use client";

import {
  ClapperboardIcon,
  Code2Icon,
  CopyIcon,
  DownloadIcon,
  FilePlus2Icon,
  FolderOpenIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PencilIcon,
  Redo2Icon,
  SaveIcon,
  Undo2Icon,
  UploadIcon,
  WandSparklesIcon,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import type { PyGesture, PyReaction } from "@/lib/content/catalogTypes";
import { cn } from "@/lib/utils";
import { useRuntimePlatform } from "@/platform/RuntimePlatformProvider";
import { useGestures, useReactions } from "@/query/hooks/useActions";
import { usePoseCreatorStore } from "@/stores/pose-creator-store";
import { Button } from "@/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/components/dropdown-menu";
import { Input } from "@/ui/components/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/ui/components/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/select";
import { Tabs, TabsList, TabsTrigger } from "@/ui/components/tabs";
import { Textarea } from "@/ui/components/textarea";
import { CreatorValidationIndicator } from "@/ui/content-creator/CreatorValidationIndicator";
import { CreatorHeaderDocument } from "@/ui/content-creator/CreatorHeaderDocument";
import { ContentHealth } from "@/ui/content-health/ContentHealth";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/ui/components/tooltip";
import {
  getCreatorHistoryShortcutLabels,
  type CreatorHistoryController,
} from "@/ui/creator-history/CreatorHistory";
import { PosePrimaryActions } from "@/ui/pose-creator/PosePrimaryActions";
import { PoseCreatorLibrarySection } from "@/ui/pose-creator/PoseCreatorLibrarySection";
import { actionValidationMessages } from "./actionValidationMessages";
import { renameActionDocument } from "./actionDocument";
import { isCustomizableStarterAction } from "./actionDocumentLoader";
import {
  createActionProject,
  parseActionImport,
  actionJsonFilename,
  unresolvedActionReferences,
} from "./actionProject";
import { savedActionSequence } from "./actionPersistence";
import { useActionEditorWorkspace } from "./ActionEditorWorkspaceContext";
import type { ActionEditorMode } from "./actionEditorCapabilities";

type HeaderHistory = Pick<
  CreatorHistoryController<unknown>,
  "canRedo" | "canUndo" | "redo" | "undo"
>;

export type ActionHeaderStatus = {
  state: "saved" | "unsaved" | "saving";
  label: string;
};

/** Derive one stable status contract for the centered document indicator. */
export function actionHeaderStatus(input: {
  dirty: boolean;
  hasReadyItem: boolean;
  stage: "idle" | "preparing" | "uploading" | "saving" | "updating_animas";
}): ActionHeaderStatus {
  if (input.stage === "preparing")
    return { state: "saving", label: "Preparing" };
  if (input.stage === "uploading")
    return { state: "saving", label: "Uploading" };
  if (input.stage === "saving") return { state: "saving", label: "Saving" };
  if (input.stage === "updating_animas")
    return { state: "saving", label: "Updating Animas" };
  return input.hasReadyItem && !input.dirty
    ? { state: "saved", label: "Saved" }
    : { state: "unsaved", label: "Unsaved" };
}

/** Prevent duplicate saves and block only genuinely in-flight workflows. */
export function actionSaveDisabled(input: {
  busy: boolean;
  hasReadyItem: boolean;
  dirty: boolean;
}): boolean {
  return input.busy || (input.hasReadyItem && !input.dirty);
}

/** Include the corrective Save detail in the compact indicator's name. */
export function actionSaveErrorLabel(error: string): string {
  return `Save failed: ${error}`;
}

function HeaderTooltip({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

/** Responsive creator toolbar connected to typed Gesture and Reaction workflows. */
export function ActionEditorHeader({
  history,
  onModeChange,
}: {
  history: HeaderHistory;
  onModeChange: (mode: ActionEditorMode) => void;
}) {
  const workspace = useActionEditorWorkspace();
  const platform = useRuntimePlatform();
  const shortcuts = getCreatorHistoryShortcutLabels(platform.os);
  const timelineBased = workspace.document.implementation === "anima_clip";
  const pose =
    workspace.document.intent === "gesture" &&
    timelineBased &&
    workspace.mode === "pose";
  const status = actionHeaderStatus({
    dirty: workspace.dirty,
    hasReadyItem: Boolean(workspace.itemId),
    stage: workspace.saveStage,
  });

  const startNew = () => {
    if (
      (workspace.dirty || workspace.identityExists) &&
      !window.confirm("Discard this draft and start a new one?")
    ) {
      return;
    }
    void workspace.startNew();
  };

  return (
    <header className="bg-background relative z-40 shrink-0 px-2 py-2 backdrop-blur-xl sm:px-3 lg:absolute lg:inset-x-0 lg:top-0 lg:bg-transparent lg:py-3 lg:pr-4 lg:pl-[calc(var(--app-shell-sidebar-inset)+1rem)] lg:backdrop-blur-none lg:transition-[padding-left] lg:duration-150 lg:ease-in-out xl:pr-8 xl:pl-[calc(var(--app-shell-sidebar-inset)+2rem)]">
      <div
        className={cn(
          "grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] grid-rows-[auto_auto] items-center gap-2 lg:grid-rows-1 lg:items-start lg:gap-1.5 2xl:gap-3",
          "lg:grid-cols-[auto_auto_auto_auto_minmax(120px,1fr)_auto]",
        )}
      >
        <ActionModeControl onModeChange={onModeChange} />

        {pose ? (
          <>
            <PoseCreatorLibrarySection variant="toolbar" />
            <PosePrimaryActions busy={workspace.busy} />
          </>
        ) : (
          <>
            <ActionNewButton busy={workspace.busy} onNew={startNew} />
            <ActionLoadButton />
            <ActionDocumentActions
              busy={workspace.busy}
              history={history}
              shortcuts={shortcuts}
              onNew={startNew}
            />
            <ActionDocumentField status={status} />
            <ActionPrimaryActions />
          </>
        )}
      </div>
    </header>
  );
}

function ActionModeControl({
  onModeChange,
}: {
  onModeChange: (mode: ActionEditorMode) => void;
}) {
  const workspace = useActionEditorWorkspace();
  const gesture = workspace.document.intent === "gesture";
  const timeline = workspace.document.implementation === "anima_clip";
  if (!gesture || !timeline) {
    return (
      <div className="border-border/70 bg-background col-start-1 row-start-1 flex h-11 min-w-[112px] items-center justify-center gap-2 rounded-xl border px-3 text-sm font-medium shadow-sm lg:h-12">
        {gesture ? (
          <ClapperboardIcon className="size-4" />
        ) : (
          <WandSparklesIcon className="size-4" />
        )}
        {gesture ? "Gesture" : "Reaction"}
      </div>
    );
  }
  return (
    <Tabs
      className="col-start-1 row-start-1 min-w-0 shrink-0 lg:min-w-max"
      value={workspace.mode === "pose" ? "pose" : "clip"}
      onValueChange={(value) =>
        onModeChange(value === "pose" ? "pose" : "clip")
      }
    >
      <TabsList className="border-border/70 bg-background grid h-11 w-full max-w-[184px] grid-cols-2 rounded-xl border p-1 shadow-sm lg:h-12 lg:w-[184px] 2xl:w-[218px] 2xl:max-w-[218px]">
        <TabsTrigger
          className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground h-9 gap-1.5 rounded-lg px-2 text-xs transition-none data-[state=active]:shadow-none sm:text-sm lg:h-10 2xl:px-4"
          value="pose"
        >
          <span
            aria-hidden="true"
            className="flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-current text-2xs leading-none font-extrabold"
          >
            1
          </span>
          Pose
        </TabsTrigger>
        <TabsTrigger
          className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground h-9 gap-1.5 rounded-lg px-2 text-xs transition-none data-[state=active]:shadow-none sm:text-sm lg:h-10 2xl:px-4"
          value="clip"
        >
          <span
            aria-hidden="true"
            className="flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-current text-2xs leading-none font-extrabold"
          >
            2
          </span>
          Clip
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

function ActionNewButton({
  busy,
  onNew,
}: {
  busy: boolean;
  onNew: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      aria-label="New"
      title="New"
      className="bg-background dark:bg-background dark:hover:bg-accent disabled:text-muted-foreground col-start-2 row-start-1 hidden size-12 rounded-xl p-0 shadow-sm disabled:opacity-100 lg:inline-flex 2xl:w-auto 2xl:min-w-[82px] 2xl:px-3"
      disabled={busy}
      onClick={onNew}
    >
      <FilePlus2Icon className="size-4" />
      <span className="hidden 2xl:inline">New</span>
    </Button>
  );
}

function ActionDocumentActions({
  busy,
  history,
  shortcuts,
  onNew,
}: {
  busy: boolean;
  history: HeaderHistory;
  shortcuts: { undo: string; redo: string };
  onNew: () => void;
}) {
  const [importOpen, setImportOpen] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  return (
    <>
      <div className="border-border/70 bg-background col-start-4 row-start-1 hidden h-12 shrink-0 items-center rounded-xl border px-1 shadow-sm lg:flex">
        <IconAction
          label="Import"
          onClick={() => setImportOpen(true)}
          disabled={busy}
        >
          <UploadIcon className="size-3.5" />
        </IconAction>
        <IconAction label="View JSON" onClick={() => setJsonOpen(true)}>
          <Code2Icon className="size-3.5" />
        </IconAction>
        <IconAction
          label={`Undo · ${shortcuts.undo}`}
          onClick={history.undo}
          disabled={busy || !history.canUndo}
        >
          <Undo2Icon className="size-3.5" />
        </IconAction>
        <IconAction
          label={`Redo · ${shortcuts.redo}`}
          onClick={history.redo}
          disabled={busy || !history.canRedo}
        >
          <Redo2Icon className="size-3.5" />
        </IconAction>
      </div>
      <MobileActions
        busy={busy}
        history={history}
        onNew={onNew}
        onImport={() => setImportOpen(true)}
        onJson={() => setJsonOpen(true)}
      />
      <ActionImportDialog open={importOpen} onOpenChange={setImportOpen} />
      <ActionJsonDialog open={jsonOpen} onOpenChange={setJsonOpen} />
    </>
  );
}

function IconAction({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <HeaderTooltip label={label}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={disabled}
        onClick={onClick}
        aria-label={label}
      >
        {children}
      </Button>
    </HeaderTooltip>
  );
}

function MobileActions({
  busy,
  history,
  onNew,
  onImport,
  onJson,
}: {
  busy: boolean;
  history: HeaderHistory;
  onNew: () => void;
  onImport: () => void;
  onJson: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="bg-background dark:bg-background dark:hover:bg-accent disabled:text-muted-foreground col-start-3 row-start-2 size-11 rounded-xl p-0 shadow-sm disabled:opacity-100 lg:hidden"
          aria-label="More creator actions"
        >
          <MoreHorizontalIcon className="size-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-60 rounded-xl p-1.5"
      >
        <MenuAction
          icon={FilePlus2Icon}
          label="New"
          onSelect={onNew}
          disabled={busy}
        />
        <MenuAction
          icon={UploadIcon}
          label="Import"
          onSelect={onImport}
          disabled={busy}
        />
        <MenuAction icon={Code2Icon} label="View JSON" onSelect={onJson} />
        <MenuAction
          icon={Undo2Icon}
          label="Undo"
          onSelect={history.undo}
          disabled={busy || !history.canUndo}
        />
        <MenuAction
          icon={Redo2Icon}
          label="Redo"
          onSelect={history.redo}
          disabled={busy || !history.canRedo}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MenuAction({
  icon: Icon,
  label,
  disabled,
  onSelect,
}: {
  icon: typeof FilePlus2Icon;
  label: string;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem
      className="min-h-11 gap-3 rounded-lg"
      disabled={disabled}
      onSelect={onSelect}
    >
      <Icon className="size-4" /> {label}
    </DropdownMenuItem>
  );
}

function ActionDocumentField({ status }: { status: ActionHeaderStatus }) {
  const workspace = useActionEditorWorkspace();
  const gesture = workspace.document.intent === "gesture";
  const nameInputRef = useRef<HTMLInputElement>(null);
  const nameInvalid =
    workspace.errorField === "name" ||
    (workspace.validationAttempted &&
      workspace.issues.some((issue) => issue.field === "name"));
  const aiDescriptionInvalid =
    workspace.validationAttempted &&
    workspace.issues.some((issue) => issue.field === "aiDescription");
  useEffect(() => {
    if (workspace.errorField === "name") nameInputRef.current?.focus();
  }, [workspace.errorField]);
  return (
    <CreatorHeaderDocument
      className="col-span-2 col-start-1 row-start-2 flex min-w-0 justify-center lg:col-span-1 lg:col-start-5 lg:row-start-1"
      widthClassName={
        gesture
          ? "w-full min-w-0 lg:max-w-[460px]"
          : "w-full min-w-0 lg:max-w-[380px]"
      }
    >
      <div
        className={cn(
          "border-border/70 bg-background flex w-full min-w-0 items-center rounded-xl border px-3 shadow-sm",
          gesture ? "h-14 lg:h-16" : "h-11 lg:h-12",
        )}
      >
        <div className="flex min-w-0 flex-1 flex-col justify-center">
          <div
            className={cn(
              "flex min-w-0 items-center rounded-sm",
              nameInvalid && "bg-destructive/5",
            )}
          >
            <span
              className={cn(
                "text-muted-foreground ml-1 inline-flex shrink-0 items-center gap-1 text-2xs font-medium",
                nameInvalid && "text-destructive",
              )}
            >
              <PencilIcon className="size-3" />
              Name&nbsp;&nbsp;&nbsp;&nbsp;
            </span>
            <Input
              ref={nameInputRef}
              value={workspace.document.name}
              onChange={(event) => {
                workspace.clearSaveErrorField("name");
                workspace.setDocument((value) =>
                  renameActionDocument(
                    value,
                    event.target.value,
                    !workspace.identityExists,
                  ),
                );
              }}
              placeholder={`New ${gesture ? "Gesture" : "Reaction"}`}
              aria-label={`${workspace.document.intent} name`}
              aria-invalid={nameInvalid}
              className={cn(
                "h-7 min-w-0 flex-1 border-0 bg-transparent px-2 text-sm font-medium shadow-none focus-visible:ring-0 dark:bg-transparent",
                nameInvalid &&
                  "text-destructive placeholder:text-destructive/70",
              )}
            />
            <ActionDocumentIndicators status={status} />
          </div>
          {gesture ? (
            <div
              className={cn(
                "border-border/60 flex min-w-0 items-center rounded-sm border-t",
                aiDescriptionInvalid && "bg-destructive/5",
              )}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className={cn(
                      "text-muted-foreground ml-1 inline-flex shrink-0 items-center gap-1 text-2xs font-medium",
                      aiDescriptionInvalid && "text-destructive",
                    )}
                    aria-label="AI selection guidance"
                  >
                    <WandSparklesIcon className="size-3" />
                    AI Desc.
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  Description of Gesture used by AI to determine{" "}
                  <strong>when</strong> to invoke this gesture while chatting.
                </TooltipContent>
              </Tooltip>
              <Input
                value={workspace.document.aiDescription}
                onChange={(event) =>
                  workspace.setDocument((value) => ({
                    ...value,
                    aiDescription: event.target.value,
                  }))
                }
                placeholder="Description of Gesture"
                aria-label="AI selection description"
                aria-invalid={aiDescriptionInvalid}
                className={cn(
                  "h-7 min-w-0 flex-1 border-0 bg-transparent px-2 text-sm font-medium shadow-none focus-visible:ring-0 dark:bg-transparent",
                  aiDescriptionInvalid &&
                    "text-destructive placeholder:text-destructive/70",
                )}
              />
            </div>
          ) : null}
        </div>
      </div>
    </CreatorHeaderDocument>
  );
}

/** Compact workflow feedback anchored to the far edge of the Name row. */
function ActionDocumentIndicators({ status }: { status: ActionHeaderStatus }) {
  const workspace = useActionEditorWorkspace();
  const clipIssues = usePoseCreatorStore(
    (state) => state.clipDraft.validationIssues,
  );
  const diagnostics = usePoseCreatorStore(
    (state) => state.clipPreviewDiagnostics,
  );
  const timeline = workspace.document.implementation === "anima_clip";
  const messages = actionValidationMessages(
    workspace.validationAttempted,
    workspace.issues,
    timeline ? clipIssues : [],
    timeline ? diagnostics : null,
    workspace.error,
  );
  return (
    <div className="ml-2 flex shrink-0 items-center gap-1.5 leading-none">
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="inline-flex size-5 items-center justify-center"
            role="status"
            aria-label={status.label}
            title={status.label}
          >
            {status.state === "saving" ? (
              <Loader2Icon className="text-primary size-3.5 animate-spin motion-reduce:animate-none" />
            ) : (
              <span
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  status.state === "saved" ? "bg-success" : "bg-primary",
                )}
              />
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">{status.label}</TooltipContent>
      </Tooltip>
      <CreatorValidationIndicator messages={messages} />
      <ContentHealth compact />
    </div>
  );
}

function ActionLoadButton() {
  const workspace = useActionEditorWorkspace();
  const [open, setOpen] = useState(false);
  const [loadingItemId, setLoadingItemId] = useState<string | null>(null);
  const ownedGestures = useGestures({
    origin: "owned",
    enabled: workspace.document.intent === "gesture" && open,
  });
  const starterGestures = useGestures({
    origin: "builtin",
    enabled: workspace.document.intent === "gesture" && open,
  });
  const ownedReactions = useReactions({
    origin: "owned",
    enabled: workspace.document.intent === "reaction" && open,
  });
  const starterReactions = useReactions({
    origin: "builtin",
    enabled: workspace.document.intent === "reaction" && open,
  });
  const ownedQuery =
    workspace.document.intent === "gesture" ? ownedGestures : ownedReactions;
  const starterQuery =
    workspace.document.intent === "gesture"
      ? starterGestures
      : starterReactions;
  const ownedRows = useMemo(() => {
    const items: Array<PyGesture | PyReaction> =
      workspace.document.intent === "gesture"
        ? (ownedGestures.data?.pages.flatMap((page) => page.items) ?? [])
        : (ownedReactions.data?.pages.flatMap((page) => page.items) ?? []);
    return items.filter((item) => item.state === "ready" && item.source);
  }, [ownedGestures.data, ownedReactions.data, workspace.document.intent]);
  const starterRows = useMemo(() => {
    const items: Array<PyGesture | PyReaction> =
      workspace.document.intent === "gesture"
        ? (starterGestures.data?.pages.flatMap((page) => page.items) ?? [])
        : (starterReactions.data?.pages.flatMap((page) => page.items) ?? []);
    return items.filter(
      (item) =>
        item.state === "ready" &&
        item.source &&
        isCustomizableStarterAction(item, workspace.document.intent),
    );
  }, [starterGestures.data, starterReactions.data, workspace.document.intent]);
  const loadOwned = async (item: (typeof ownedRows)[number]) => {
    if (
      (workspace.dirty || workspace.identityExists) &&
      !window.confirm(`Discard the current changes and load “${item.name}”?`)
    ) {
      return;
    }
    setLoadingItemId(item.item_id);
    try {
      await workspace.loadOwned(item);
      setOpen(false);
    } catch {
      // The workspace owns the visible, recoverable load error.
    } finally {
      setLoadingItemId(null);
    }
  };
  const customizeStarter = async (item: (typeof starterRows)[number]) => {
    if (
      (workspace.dirty || workspace.identityExists) &&
      !window.confirm(
        `Discard the current changes and customize “${item.name}” as a new ${workspace.document.intent}?`,
      )
    ) {
      return;
    }
    setLoadingItemId(item.item_id);
    try {
      await workspace.loadStarter(item);
      setOpen(false);
    } catch {
      // The workspace owns the visible, recoverable load error.
    } finally {
      setLoadingItemId(null);
    }
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="bg-background dark:bg-background dark:hover:bg-accent disabled:text-muted-foreground col-start-2 row-start-1 size-11 rounded-xl p-0 shadow-sm disabled:opacity-100 lg:col-start-3 lg:h-12 2xl:w-auto 2xl:min-w-[88px] 2xl:px-4"
          aria-label={`Load ${workspace.document.intent}`}
        >
          <FolderOpenIcon className="size-4" />
          <span className="hidden 2xl:inline">Load</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        avoidSidebar
        align="end"
        sideOffset={12}
        className="w-[420px] rounded-xl p-3"
      >
        <div className="mb-3">
          <p className="text-sm font-semibold">
            Load {workspace.document.intent}
          </p>
          <p className="text-muted-foreground text-xs">
            Open your content or customize an immutable Starter clip.
          </p>
        </div>
        <div className="max-h-80 space-y-4 overflow-y-auto pr-1">
          <ActionLoadGroup
            label="Mine"
            rows={ownedRows.map((item) => ({
              item,
              detail: "Editable Local content",
              loading: loadingItemId === item.item_id,
              onSelect: () => void loadOwned(item),
            }))}
            pending={ownedQuery.isPending}
            empty={`No ready ${workspace.document.intent}s yet.`}
            moreLabel="Load more of mine"
            hasNextPage={Boolean(ownedQuery.hasNextPage)}
            fetchingNextPage={ownedQuery.isFetchingNextPage}
            fetchNextPage={() => void ownedQuery.fetchNextPage()}
            disabled={workspace.busy || loadingItemId !== null}
          />
          <ActionLoadGroup
            label="Starter"
            rows={starterRows.map((item) => ({
              item,
              detail: "Included · Customize as new",
              loading: loadingItemId === item.item_id,
              onSelect: () => void customizeStarter(item),
            }))}
            pending={starterQuery.isPending}
            empty="No customizable Starter Anima Pose Clips."
            moreLabel="Load more Starter clips"
            hasNextPage={Boolean(starterQuery.hasNextPage)}
            fetchingNextPage={starterQuery.isFetchingNextPage}
            fetchNextPage={() => void starterQuery.fetchNextPage()}
            disabled={workspace.busy || loadingItemId !== null}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ActionLoadGroup({
  label,
  rows,
  pending,
  empty,
  moreLabel,
  hasNextPage,
  fetchingNextPage,
  fetchNextPage,
  disabled,
}: {
  label: string;
  rows: Array<{
    item: { item_id: string; name: string };
    detail: string;
    loading: boolean;
    onSelect: () => void;
  }>;
  pending: boolean;
  empty: string;
  moreLabel: string;
  hasNextPage: boolean;
  fetchingNextPage: boolean;
  fetchNextPage: () => void;
  disabled: boolean;
}) {
  return (
    <section>
      <p className="text-muted-foreground mb-1 px-2 text-2xs font-semibold tracking-[0.14em] uppercase">
        {label}
      </p>
      <div className="space-y-1">
        {rows.map(({ item, detail, loading, onSelect }) => (
          <Button
            key={item.item_id}
            type="button"
            variant="ghost"
            className="h-auto w-full justify-start px-2 py-2 text-left"
            disabled={disabled}
            onClick={onSelect}
          >
            {loading ? (
              <Loader2Icon className="mr-2 size-3.5 animate-spin motion-reduce:animate-none" />
            ) : null}
            <span className="min-w-0">
              <span className="block truncate text-sm">{item.name}</span>
              <span className="text-muted-foreground block text-2xs">
                {detail}
              </span>
            </span>
          </Button>
        ))}
        {pending ? (
          <p className="text-muted-foreground p-3 text-xs">Loading…</p>
        ) : null}
        {!pending && !rows.length ? (
          <p className="text-muted-foreground rounded-lg border border-dashed p-3 text-center text-xs">
            {empty}
          </p>
        ) : null}
        {hasNextPage ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full"
            disabled={fetchingNextPage || disabled}
            onClick={fetchNextPage}
          >
            {moreLabel}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function ActionPrimaryActions() {
  const workspace = useActionEditorWorkspace();
  const disabled = actionSaveDisabled({
    busy: workspace.busy,
    hasReadyItem: Boolean(workspace.itemId),
    dirty: workspace.dirty,
  });
  return (
    <div className="col-start-3 row-start-1 flex h-11 items-center gap-1.5 lg:col-start-6 lg:h-12">
      <Button
        type="button"
        variant="outline"
        className="bg-background dark:bg-background dark:hover:bg-accent disabled:text-muted-foreground size-11 rounded-xl p-0 shadow-sm disabled:opacity-100 lg:h-12 lg:w-auto lg:min-w-[88px] lg:px-3"
        disabled={disabled}
        onClick={() => void workspace.save()}
        aria-label="Save content"
      >
        {workspace.saveStage !== "idle" ? (
          <Loader2Icon className="size-4 animate-spin motion-reduce:animate-none" />
        ) : (
          <SaveIcon className="size-4" />
        )}
        <span className="hidden lg:inline">Save</span>
      </Button>
      <Button
        type="button"
        className="hover:bg-primary disabled:text-muted-foreground size-11 rounded-xl p-0 shadow-sm disabled:opacity-100 lg:h-12 lg:w-auto lg:min-w-[160px] lg:px-3"
        disabled={disabled}
        variant="default"
        onClick={() => void workspace.saveAndEquip()}
        aria-label="Save and equip content"
      >
        <WandSparklesIcon className="size-4" />
        <span className="hidden lg:inline">Save &amp; Equip</span>
      </Button>
    </div>
  );
}

function ActionImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const workspace = useActionEditorWorkspace();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [text, setText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const unresolved = useMemo(
    () =>
      unresolvedActionReferences(
        workspace.document.sequence,
        workspace.document.dependencies,
      ),
    [workspace.document.dependencies, workspace.document.sequence],
  );
  const apply = (raw: string) => {
    try {
      const imported = parseActionImport(
        JSON.parse(raw) as unknown,
        workspace.document.intent,
      );
      workspace.applyImport(imported);
      setMessage(
        imported.kind === "clip"
          ? "Anima Pose Clip imported. Map any unresolved effects or sounds below."
          : "Typed project imported with exact dependency pins.",
      );
      toast.success(
        imported.kind === "clip"
          ? "Anima Pose Clip imported."
          : "Typed project imported.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The JSON could not be imported.",
      );
    }
  };
  const readFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    const raw = await file.text();
    setText(raw);
    apply(raw);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-border border-b px-5 py-4 pr-12">
          <DialogTitle>Import</DialogTitle>
          <DialogDescription>
            Open an animaPoseClip/2.0 or 1.0 file directly or restore an Animama
            typed project with exact dependency pins.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 overflow-y-auto p-4 sm:p-5">
          {workspace.document.intent === "gesture" ? (
            <label className="grid gap-2 rounded-lg border p-3 text-sm font-medium">
              VRMA animation (experimental)
              <span className="text-muted-foreground text-xs font-normal">
                Not fully supported or tested. Importing switches this gesture
                from timeline authoring to VRMA.
              </span>
              <Input
                type="file"
                accept=".vrma,model/gltf-binary"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (!file) return;
                  workspace.setDocument((value) => ({
                    ...value,
                    implementation: "vrma",
                    dependencies: [],
                  }));
                  workspace.setVrma(file);
                  onOpenChange(false);
                }}
              />
            </label>
          ) : null}

          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(event) => void readFile(event)}
          />
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => fileRef.current?.click()}
          >
            <UploadIcon className="size-4" /> Choose JSON file
          </Button>
          <Textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder='{"schema":"animaPoseClip/2.0",…}'
            className="min-h-48 font-mono text-xs"
            aria-label="Creator JSON import"
          />
          <Button
            type="button"
            className="w-full"
            disabled={!text.trim()}
            onClick={() => apply(text)}
          >
            Import pasted JSON
          </Button>
          {message ? (
            <p
              className={cn(
                "text-xs",
                message.includes("imported")
                  ? "text-muted-foreground"
                  : "text-destructive",
              )}
              role="status"
            >
              {message}
            </p>
          ) : null}
          {unresolved.length ? (
            <section className="space-y-3 rounded-xl border p-3">
              <div>
                <p className="text-sm font-semibold">
                  Repair referenced components
                </p>
                <p className="text-muted-foreground text-xs">
                  Map each clip alias to an exact content item, or remove its
                  events.
                </p>
              </div>
              <Input
                value={workspace.dependencyQuery}
                onChange={(event) =>
                  workspace.setDependencyQuery(event.target.value)
                }
                placeholder="Search effects and sounds"
              />
              {unresolved.map((reference) => {
                const section = workspace.dependencySections.find(
                  (candidate) =>
                    candidate.contentType === reference.contentType,
                );
                return (
                  <div
                    key={reference.alias}
                    className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(120px,1fr)_auto] sm:items-center"
                  >
                    <div>
                      <p className="font-mono text-xs font-medium">
                        {reference.alias}
                      </p>
                      <p className="text-muted-foreground text-2xs">
                        {section?.label ?? reference.contentType}
                      </p>
                    </div>
                    <Select
                      onValueChange={(itemId) => {
                        const item = section?.items.find(
                          (candidate) => candidate.item_id === itemId,
                        );
                        if (item)
                          workspace.mapDependency(
                            reference.alias,
                            item,
                            reference.contentType,
                          );
                      }}
                    >
                      <SelectTrigger aria-label={`Map ${reference.alias}`}>
                        <SelectValue placeholder="Choose exact content" />
                      </SelectTrigger>
                      <SelectContent>
                        {section?.items
                          .filter((item) => item.source)
                          .map((item) => (
                            <SelectItem key={item.item_id} value={item.item_id}>
                              {item.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        workspace.removeDependency(reference.alias)
                      }
                    >
                      Remove event
                    </Button>
                  </div>
                );
              })}
            </section>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ActionJsonDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const workspace = useActionEditorWorkspace();
  const [kind, setKind] = useState<"clip" | "project">("clip");
  const json = useMemo(() => {
    try {
      return JSON.stringify(
        kind === "clip"
          ? workspace.document.implementation === "anima_clip"
            ? // The clip as Save writes it (2.0).
              savedActionSequence(
                workspace.document.sequence,
                workspace.document.intent,
              )
            : workspace.document.sequence
          : createActionProject(workspace.document),
        null,
        2,
      );
    } catch {
      return "";
    }
  }, [kind, workspace.document]);
  const copy = async () => {
    await navigator.clipboard.writeText(json);
    toast.success(`${kind === "clip" ? "Clip" : "Project"} JSON copied.`);
  };
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([json], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = actionJsonFilename(workspace.document.name, kind);
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-border border-b px-5 py-4 pr-12">
          <DialogTitle>Creator JSON</DialogTitle>
          <DialogDescription>
            Clip JSON is portable animaPoseClip/2.0. Typed project JSON also
            retains exact effect and sound references.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 overflow-y-auto p-4 sm:p-5">
          <Select
            value={kind}
            onValueChange={(value) => setKind(value as typeof kind)}
          >
            <SelectTrigger aria-label="JSON format">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="clip">Clip JSON</SelectItem>
              <SelectItem value="project">Typed project JSON</SelectItem>
            </SelectContent>
          </Select>
          <Textarea
            value={json}
            readOnly
            className="min-h-[300px] font-mono text-xs"
            aria-label="Creator JSON preview"
          />
          {!json ? (
            <p className="text-destructive text-xs">
              This implementation does not have Anima Pose Clip JSON.
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!json}
              onClick={() => void copy()}
            >
              <CopyIcon className="size-4" /> Copy
            </Button>
            <Button type="button" disabled={!json} onClick={download}>
              <DownloadIcon className="size-4" /> Download
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
