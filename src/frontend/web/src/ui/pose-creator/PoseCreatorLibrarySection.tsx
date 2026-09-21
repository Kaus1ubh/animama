"use client";

import { CreatorHeaderDocument } from "@/ui/content-creator/CreatorHeaderDocument";

import {
  Code2Icon,
  CopyIcon,
  DownloadIcon,
  FileJsonIcon,
  FilePlus2Icon,
  FolderOpenIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Redo2Icon,
  SaveIcon,
  SplitIcon,
  Trash2Icon,
  Undo2Icon,
  UploadIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/components/dropdown-menu";
import {
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import { AVATAR_POSE_IDS, parseAnimaPose, type AnimaPose } from "@/lib/avatar";
import { cn } from "@/lib/utils";
import { useRuntimePlatform } from "@/platform/RuntimePlatformProvider";
import {
  DEFAULT_POSE_CREATOR_BASE_POSE,
  POSE_CREATOR_VRM_T_POSE_BASE_POSE_ID,
  getPoseCreatorBasePoseLabel,
  isPoseCreatorBasePose,
  selectCanRedoClip,
  selectCanRedoPose,
  selectCanUndoClip,
  selectCanUndoPose,
  type PoseCreatorSavedDraft,
  type PoseCreatorSavedDraftSource,
  usePoseCreatorStore,
} from "@/stores/pose-creator-store";
import { Button } from "@/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/ui/components/dialog";
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
import { Textarea } from "@/ui/components/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/ui/components/tooltip";
import { PoseCreatorPanelSection } from "./PoseCreatorPanelSection";
import { confirmPoseCreatorDirtyReplacement } from "./poseCreatorDirtyGuard";
import { getPoseCreatorHistoryShortcutLabels } from "./poseCreatorUndo";
import {
  bakePoseCreatorAnimaPose,
  applyPoseCreatorBasePose,
  buildPoseCreatorAnimaPose,
  buildPoseCreatorAnimaPoseForExport,
  createUniquePoseCreatorBranchName,
  formatPoseCreatorAnimaPoseJson,
  replacePoseCreatorDraftWithAnimaPose,
  type PoseCreatorPoseExportMode,
} from "./poseCreatorAuthoring";

function formatSavedDraftDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getSavedDraftSourceLabel(source: PoseCreatorSavedDraftSource): string {
  return `${source.displayName} · ${source.sourceLabel}`;
}

function sanitizeJsonFileName(value: string): string {
  return `${
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "pose"
  }.json`;
}

function parsePoseJson(rawValue: string): AnimaPose {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    throw new Error("Import JSON is empty.");
  }
  return parseAnimaPose(JSON.parse(trimmed) as unknown);
}

function getImportPoseParent(pose: AnimaPose): string {
  const parent = pose.parent;
  if (!parent) return POSE_CREATOR_VRM_T_POSE_BASE_POSE_ID;
  if (parent.inheritHumanoid === false || parent.inheritExpressions === true) {
    throw new Error(
      "Parented pose imports currently require humanoid inheritance on and expression inheritance off.",
    );
  }
  if (!AVATAR_POSE_IDS.includes(parent.ref)) {
    throw new Error(
      `Parent pose "${parent.ref}" is unavailable in the compatibility pose resolver.`,
    );
  }
  return parent.ref;
}

function PoseDataActionTooltip({
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

type SavedDraftRowProps = {
  draft: PoseCreatorSavedDraft;
  isCurrent: boolean;
  onLoad: (draft: PoseCreatorSavedDraft) => void;
  onCreateBranch: (draft: PoseCreatorSavedDraft) => void;
  onDelete: (draft: PoseCreatorSavedDraft) => void;
};

function SavedDraftRow({
  draft,
  isCurrent,
  onLoad,
  onCreateBranch,
  onDelete,
}: SavedDraftRowProps) {
  return (
    <div className="border-border/70 bg-background group relative min-h-20 rounded-md border px-3 py-2 lg:min-h-0">
      <button
        type="button"
        className="hover:bg-muted/50 focus-visible:ring-ring absolute inset-0 rounded-md transition-colors focus-visible:ring-[3px] focus-visible:outline-none"
        onClick={() => onLoad(draft)}
        aria-label={`Load ${draft.name}`}
      >
        <span className="sr-only">Load {draft.name}</span>
      </button>
      <div className="pointer-events-none relative z-[1] flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <p className="text-foreground truncate text-xs font-medium">
              {draft.name}
            </p>
            {isCurrent ? (
              <span className="bg-primary/10 text-primary rounded px-1.5 py-0.5 text-[10px]">
                Current
              </span>
            ) : null}
          </div>
          <p className="text-muted-foreground mt-0.5 truncate text-[10px]">
            {getSavedDraftSourceLabel(draft.source)} / Base:{" "}
            {getPoseCreatorBasePoseLabel(draft.basePose)}
          </p>
          <p className="text-muted-foreground mt-0.5 text-[10px]">
            Updated {formatSavedDraftDate(draft.updatedAt)}
          </p>
        </div>
        <div className="pointer-events-auto flex shrink-0 items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-11 px-2 text-xs lg:h-7"
            onClick={() => onCreateBranch(draft)}
          >
            <SplitIcon className="size-3.5" />
            Branch
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive h-11 px-2 text-xs lg:h-7"
            onClick={() => onDelete(draft)}
            aria-label={`Delete ${draft.name}`}
          >
            <Trash2Icon className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function SavedDraftLoadButton({
  savedDrafts,
  selectedSavedDraftId,
  onLoad,
  onCreateBranch,
  onDelete,
}: {
  savedDrafts: PoseCreatorSavedDraft[];
  selectedSavedDraftId: string | null;
  onLoad: (draft: PoseCreatorSavedDraft) => void;
  onCreateBranch: (draft: PoseCreatorSavedDraft) => void;
  onDelete: (draft: PoseCreatorSavedDraft) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="col-start-2 row-start-1 size-11 rounded-xl p-0 shadow-sm lg:col-start-3 lg:h-12 lg:w-auto lg:min-w-[88px] lg:px-4"
          aria-label="Load pose"
        >
          <FolderOpenIcon className="size-4" />
          <span className="hidden lg:inline">Load</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={12}
        className="w-[calc(100vw-1rem)] max-w-[520px] rounded-xl p-3"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Saved pose drafts</p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              Stored in this browser
            </p>
          </div>
          <span className="text-muted-foreground text-xs">
            {savedDrafts.length}
          </span>
        </div>
        {savedDrafts.length > 0 ? (
          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {savedDrafts.map((draft) => (
              <SavedDraftRow
                key={draft.id}
                draft={draft}
                isCurrent={draft.id === selectedSavedDraftId}
                onLoad={(selectedDraft) => {
                  setOpen(false);
                  onLoad(selectedDraft);
                }}
                onCreateBranch={onCreateBranch}
                onDelete={onDelete}
              />
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-6 text-center text-xs">
            Save a named pose to add it here.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function PoseCreatorLibrarySection({
  variant = "panel",
}: {
  variant?: "panel" | "toolbar";
}) {
  const runtimePlatform = useRuntimePlatform();
  const historyShortcuts = getPoseCreatorHistoryShortcutLabels(
    runtimePlatform.os,
  );
  const jsonFileInputRef = useRef<HTMLInputElement | null>(null);
  const [importText, setImportText] = useState("");
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [jsonDialogOpen, setJsonDialogOpen] = useState(false);
  const [exportMode, setExportMode] =
    useState<PoseCreatorPoseExportMode>("inherited");
  const selectedSource = usePoseCreatorStore((state) => state.selectedSource);
  const basePose = usePoseCreatorStore((state) => state.basePose);
  const activeAvatar = usePoseCreatorStore((state) => state.activeAvatar);
  const boneDrafts = usePoseCreatorStore((state) => state.boneDrafts);
  const expressionDrafts = usePoseCreatorStore(
    (state) => state.expressionDrafts,
  );
  const draftName = usePoseCreatorStore((state) => state.draftName);
  const savedDrafts = usePoseCreatorStore((state) => state.savedDrafts);
  const selectedSavedDraftId = usePoseCreatorStore(
    (state) => state.selectedSavedDraftId,
  );
  const importError = usePoseCreatorStore((state) => state.importError);
  const isDirty = usePoseCreatorStore((state) => state.isDirty);
  const setDraftName = usePoseCreatorStore((state) => state.setDraftName);
  const setImportError = usePoseCreatorStore((state) => state.setImportError);
  const saveLocalDraft = usePoseCreatorStore((state) => state.saveLocalDraft);
  const deleteLocalDraft = usePoseCreatorStore(
    (state) => state.deleteLocalDraft,
  );
  const loadSavedDraft = usePoseCreatorStore((state) => state.loadSavedDraft);
  const replaceDraftFromImport = usePoseCreatorStore(
    (state) => state.replaceDraftFromImport,
  );
  const startNewPose = usePoseCreatorStore((state) => state.startNewPose);
  const isInlineClipPose = usePoseCreatorStore((state) =>
    Boolean(state.clipInlineEdit),
  );
  const canUndoStandalonePose = usePoseCreatorStore(selectCanUndoPose);
  const undoStandalonePose = usePoseCreatorStore((state) => state.undoPose);
  const canRedoStandalonePose = usePoseCreatorStore(selectCanRedoPose);
  const redoStandalonePose = usePoseCreatorStore((state) => state.redoPose);
  const canUndoInlinePose = usePoseCreatorStore(selectCanUndoClip);
  const undoInlinePose = usePoseCreatorStore((state) => state.undoClip);
  const canRedoInlinePose = usePoseCreatorStore(selectCanRedoClip);
  const redoInlinePose = usePoseCreatorStore((state) => state.redoClip);
  const canUndoPose = isInlineClipPose
    ? canUndoInlinePose
    : canUndoStandalonePose;
  const undoPose = isInlineClipPose ? undoInlinePose : undoStandalonePose;
  const canRedoPose = isInlineClipPose
    ? canRedoInlinePose
    : canRedoStandalonePose;
  const redoPose = isInlineClipPose ? redoInlinePose : redoStandalonePose;
  const currentInheritedPose = useMemo(
    () =>
      buildPoseCreatorAnimaPose(boneDrafts, expressionDrafts, {
        id: selectedSavedDraftId,
        name: draftName,
        parentPose: basePose,
      }),
    [basePose, boneDrafts, draftName, expressionDrafts, selectedSavedDraftId],
  );
  const currentExportPose = useMemo(
    () =>
      buildPoseCreatorAnimaPoseForExport(boneDrafts, expressionDrafts, {
        id: selectedSavedDraftId,
        name: draftName,
        parentPose: basePose,
        mode: exportMode,
      }),
    [
      basePose,
      boneDrafts,
      draftName,
      exportMode,
      expressionDrafts,
      selectedSavedDraftId,
    ],
  );
  const currentJson = useMemo(
    () =>
      currentExportPose
        ? formatPoseCreatorAnimaPoseJson(currentExportPose)
        : null,
    [currentExportPose],
  );
  const canSaveDraft = Boolean(selectedSource && currentInheritedPose);

  const saveCurrentPoseDraft = (): PoseCreatorSavedDraft | null => {
    if (!selectedSource) {
      setImportError("Select an Avatar Model before saving a local draft.");
      return null;
    }
    if (!currentInheritedPose) {
      setImportError(
        "Choose a parent or adjust bones or expressions before saving a draft.",
      );
      return null;
    }
    const savedDraft = saveLocalDraft({
      source: selectedSource,
      basePose,
      pose: currentInheritedPose,
    });
    const latestError = usePoseCreatorStore.getState().importError;
    if (latestError) {
      toast.error(latestError);
      return null;
    }
    return savedDraft;
  };

  const handleSaveDraft = () => {
    if (saveCurrentPoseDraft()) toast.success("Local pose draft saved.");
  };

  const handleCopyJson = async () => {
    if (!currentJson) return;
    try {
      if (!navigator.clipboard) {
        throw new Error("Clipboard unavailable.");
      }
      await navigator.clipboard.writeText(currentJson);
      toast.success("Pose JSON copied.");
    } catch {
      setImportError("Could not copy pose JSON to the clipboard.");
      toast.error("Could not copy pose JSON.");
    }
  };

  const handleDownloadJson = () => {
    if (!currentJson || !currentExportPose) return;
    const blob = new Blob([currentJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = sanitizeJsonFileName(
      currentExportPose.id || currentExportPose.name,
    );
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const replaceFromPose = (pose: AnimaPose) => {
    if (!activeAvatar) {
      setImportError("Load a VRM before importing pose JSON.");
      return;
    }

    let nextBasePose: string;
    try {
      nextBasePose = getImportPoseParent(pose);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not validate the imported pose parent.";
      setImportError(message);
      toast.error("Could not import pose parent.");
      return;
    }

    if (!confirmPoseCreatorDirtyReplacement(isDirty)) return;

    try {
      const drafts = replacePoseCreatorDraftWithAnimaPose(
        activeAvatar,
        pose,
        nextBasePose,
      );
      replaceDraftFromImport({
        draftName: pose.name,
        basePose: nextBasePose,
        boneDrafts: drafts.boneDrafts,
        expressionDrafts: drafts.expressionDrafts,
        importError: null,
      });
      setImportText("");
      toast.success("Pose JSON imported.");
    } catch {
      setImportError("Could not apply the imported pose to this avatar.");
      toast.error("Could not apply imported pose.");
    }
  };

  const handleImportText = () => {
    try {
      const pose = parsePoseJson(importText);
      replaceFromPose(pose);
    } catch {
      setImportError("Import JSON must be a valid animaPose/1.0 payload.");
    }
  };

  const handleJsonFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = "";
    if (!file) return;

    try {
      const pose = parsePoseJson(await file.text());
      replaceFromPose(pose);
    } catch {
      setImportError("Import file must contain valid animaPose/1.0 JSON.");
    }
  };

  const handleLoadSavedDraft = (draft: PoseCreatorSavedDraft) => {
    if (!activeAvatar) {
      setImportError("Load a VRM before loading a saved draft.");
      return;
    }
    if (!confirmPoseCreatorDirtyReplacement(isDirty)) return;

    const nextBasePose = isPoseCreatorBasePose(draft.basePose)
      ? draft.basePose
      : basePose;
    try {
      const drafts = replacePoseCreatorDraftWithAnimaPose(
        activeAvatar,
        draft.pose,
        nextBasePose,
      );
      const loadedDraft = loadSavedDraft(draft.id, {
        basePose: nextBasePose,
        boneDrafts: drafts.boneDrafts,
        expressionDrafts: drafts.expressionDrafts,
      });
      if (loadedDraft) {
        toast.success("Local pose draft loaded.");
      }
    } catch {
      setImportError("Could not load the saved draft into this avatar.");
      toast.error("Could not load saved draft.");
    }
  };

  /** Creates an independent, unsaved pose snapshot from the supplied pose. */
  const createPoseBranch = (
    pose: AnimaPose,
    sourceName: string,
    successMessage = "New unsaved pose branch created.",
  ) => {
    if (!activeAvatar) {
      setImportError("Load a VRM before branching a pose.");
      return false;
    }

    try {
      const bakedPose = bakePoseCreatorAnimaPose(pose);
      const drafts = replacePoseCreatorDraftWithAnimaPose(
        activeAvatar,
        bakedPose,
        POSE_CREATOR_VRM_T_POSE_BASE_POSE_ID,
      );
      replaceDraftFromImport({
        draftName: createUniquePoseCreatorBranchName(
          sourceName,
          savedDrafts.map((draft) => draft.name),
        ),
        basePose: POSE_CREATOR_VRM_T_POSE_BASE_POSE_ID,
        boneDrafts: drafts.boneDrafts,
        expressionDrafts: drafts.expressionDrafts,
        importError: null,
      });
      toast.success(successMessage);
      return true;
    } catch {
      setImportError("Could not resolve this pose into a branch.");
      toast.error("Could not create pose branch.");
      return false;
    }
  };

  const handleCreateBranch = (draft: PoseCreatorSavedDraft) => {
    if (
      !confirmPoseCreatorDirtyReplacement(
        isDirty,
        "Discard unsaved pose changes and branch from this saved pose?",
      )
    ) {
      return;
    }
    createPoseBranch(draft.pose, draft.name);
  };

  const handleSaveAndBranch = () => {
    const savedDraft = saveCurrentPoseDraft();
    if (!savedDraft) return;
    createPoseBranch(
      savedDraft.pose,
      savedDraft.name,
      "Pose saved and new branch created.",
    );
  };

  const handleDeleteSavedDraft = (draft: PoseCreatorSavedDraft) => {
    if (!window.confirm(`Delete "${draft.name}" from local drafts?`)) return;
    deleteLocalDraft(draft.id);
    const latestError = usePoseCreatorStore.getState().importError;
    if (latestError) {
      toast.error(latestError);
      return;
    }
    toast.success("Local pose draft deleted.");
  };

  const handleNewPose = () => {
    if (
      !confirmPoseCreatorDirtyReplacement(
        isDirty,
        "Discard unsaved pose changes and start a new pose?",
      )
    ) {
      return;
    }
    startNewPose();
    applyPoseCreatorBasePose(activeAvatar, DEFAULT_POSE_CREATOR_BASE_POSE);
    activeAvatar?.clearAllExpressionOverrides();
  };

  if (variant === "toolbar") {
    const isSaved = Boolean(selectedSavedDraftId) && !isDirty;
    return (
      <>
        <CreatorHeaderDocument
          className="col-span-2 col-start-1 row-start-2 flex min-w-0 justify-center lg:col-span-1 lg:col-start-5 lg:row-start-1"
          widthClassName="w-full min-w-0 lg:max-w-[300px] 2xl:max-w-[380px]"
        >
          <form
            id="pose-creator-pose-save-form"
            className="border-border/70 bg-background flex h-11 w-full min-w-0 items-center rounded-xl border px-3 shadow-sm lg:h-12"
            onSubmit={(event) => {
              event.preventDefault();
              const submitter = (event.nativeEvent as SubmitEvent)
                .submitter as HTMLButtonElement | null;
              if (submitter?.value === "save-and-branch") {
                handleSaveAndBranch();
              } else {
                handleSaveDraft();
              }
            }}
          >
            <span className="text-muted-foreground ml-1 inline-flex shrink-0 items-center gap-1 text-[10px] font-medium">
              <PencilIcon className="size-3" />
              Name&nbsp;&nbsp;&nbsp;&nbsp;
            </span>
            <Input
              value={draftName}
              onChange={(event) => setDraftName(event.currentTarget.value)}
              placeholder="New Pose"
              aria-label="Pose name"
              className="h-7 min-w-0 flex-1 border-0 bg-transparent px-2 text-sm font-medium shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
            <PoseDataActionTooltip label={isSaved ? "Saved" : "Unsaved"}>
              <span
                className="ml-2 inline-flex size-5 shrink-0 items-center justify-center"
                role="status"
                aria-label={isSaved ? "Saved" : "Unsaved"}
                title={isSaved ? "Saved" : "Unsaved"}
              >
                <span
                  className={cn(
                    "size-2 rounded-full",
                    isSaved ? "bg-emerald-500" : "bg-primary",
                  )}
                />
              </span>
            </PoseDataActionTooltip>
          </form>
        </CreatorHeaderDocument>

        <Button
          type="button"
          variant="outline"
          className="col-start-2 row-start-1 hidden h-12 min-w-[82px] rounded-xl px-3 shadow-sm lg:inline-flex"
          onClick={handleNewPose}
        >
          <FilePlus2Icon className="size-4" />
          New
        </Button>

        <div className="col-start-4 row-start-1 hidden shrink-0 items-center gap-2 lg:flex">
          <div className="border-border/70 bg-background flex h-12 items-center rounded-xl border px-1 shadow-sm">
            <PoseDataActionTooltip label="Import pose JSON">
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                onClick={() => setImportDialogOpen(true)}
                disabled={!activeAvatar}
                aria-label="Import pose JSON"
              >
                <UploadIcon className="size-3.5" />
              </Button>
            </PoseDataActionTooltip>
            <PoseDataActionTooltip label="View pose JSON">
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                onClick={() => setJsonDialogOpen(true)}
                disabled={!currentJson}
                aria-label="View pose JSON"
              >
                <Code2Icon className="size-3.5" />
              </Button>
            </PoseDataActionTooltip>
            <PoseDataActionTooltip
              label={`Undo last pose edit · ${historyShortcuts.undo}`}
            >
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                onClick={undoPose}
                disabled={!canUndoPose}
                aria-label="Undo last pose edit"
              >
                <Undo2Icon className="size-3.5" />
              </Button>
            </PoseDataActionTooltip>
            <PoseDataActionTooltip
              label={`Redo last pose edit · ${historyShortcuts.redo}`}
            >
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                onClick={redoPose}
                disabled={!canRedoPose}
                aria-label="Redo last pose edit"
              >
                <Redo2Icon className="size-3.5" />
              </Button>
            </PoseDataActionTooltip>
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className="col-start-3 row-start-2 size-11 rounded-xl p-0 shadow-sm lg:hidden"
              aria-label="More pose actions"
            >
              <MoreHorizontalIcon className="size-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={8}
            className="w-56 rounded-xl p-1.5"
          >
            <DropdownMenuItem
              className="min-h-11 gap-3 rounded-lg"
              onSelect={handleNewPose}
            >
              <FilePlus2Icon className="size-4" />
              New pose
            </DropdownMenuItem>
            <DropdownMenuItem
              className="min-h-11 gap-3 rounded-lg"
              disabled={!activeAvatar}
              onSelect={() => setImportDialogOpen(true)}
            >
              <UploadIcon className="size-4" />
              Import pose JSON
            </DropdownMenuItem>
            <DropdownMenuItem
              className="min-h-11 gap-3 rounded-lg"
              disabled={!currentJson}
              onSelect={() => setJsonDialogOpen(true)}
            >
              <Code2Icon className="size-4" />
              View pose JSON
            </DropdownMenuItem>
            <DropdownMenuItem
              className="min-h-11 gap-3 rounded-lg"
              disabled={!canUndoPose}
              onSelect={undoPose}
            >
              <Undo2Icon className="size-4" />
              Undo last pose edit
            </DropdownMenuItem>
            <DropdownMenuItem
              className="min-h-11 gap-3 rounded-lg"
              disabled={!canRedoPose}
              onSelect={redoPose}
            >
              <Redo2Icon className="size-4" />
              Redo last pose edit
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <SavedDraftLoadButton
          savedDrafts={savedDrafts}
          selectedSavedDraftId={selectedSavedDraftId}
          onLoad={handleLoadSavedDraft}
          onCreateBranch={handleCreateBranch}
          onDelete={handleDeleteSavedDraft}
        />

        <input
          ref={jsonFileInputRef}
          className="hidden"
          type="file"
          accept=".json,application/json"
          onChange={handleJsonFileChange}
        />

        <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
          <DialogContent className="max-h-[calc(100dvh-1rem)] gap-0 overflow-hidden p-0 sm:max-w-xl">
            <DialogHeader className="border-border/70 border-b px-5 py-4 pr-12">
              <DialogTitle>Import pose JSON</DialogTitle>
              <DialogDescription>
                Choose an animaPose/1.0 file or paste its JSON payload.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 overflow-y-auto p-4 sm:p-5">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => jsonFileInputRef.current?.click()}
              >
                <UploadIcon className="size-4" />
                Choose JSON file
              </Button>
              <div className="flex items-center gap-3">
                <span className="bg-border h-px flex-1" />
                <span className="text-muted-foreground text-[11px] uppercase">
                  or paste JSON
                </span>
                <span className="bg-border h-px flex-1" />
              </div>
              <Textarea
                value={importText}
                onChange={(event) => setImportText(event.currentTarget.value)}
                placeholder='{"schema":"animaPose/1.0","humanoid":{…}}'
                className="min-h-52 resize-none font-mono text-xs"
                aria-label="Import animaPose JSON"
              />
              {importError ? (
                <p className="text-destructive text-xs" role="alert">
                  {importError}
                </p>
              ) : null}
              <Button
                type="button"
                className="w-full"
                onClick={handleImportText}
                disabled={!activeAvatar || importText.trim().length === 0}
              >
                <FileJsonIcon className="size-4" />
                Import pasted JSON
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={jsonDialogOpen} onOpenChange={setJsonDialogOpen}>
          <DialogContent className="max-h-[calc(100dvh-1rem)] gap-0 overflow-hidden p-0 sm:max-w-2xl">
            <DialogHeader className="border-border/70 border-b px-5 py-4 pr-12">
              <DialogTitle>Pose JSON</DialogTitle>
              <DialogDescription>
                Preview the exact animaPose/1.0 payload for this draft.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 overflow-y-auto p-4 sm:p-5">
              <label className="grid gap-1.5">
                <span className="text-muted-foreground text-xs font-medium">
                  Export mode
                </span>
                <Select
                  value={exportMode}
                  onValueChange={(mode) =>
                    setExportMode(mode as PoseCreatorPoseExportMode)
                  }
                >
                  <SelectTrigger aria-label="Pose export mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inherited">
                      Inherited sparse JSON
                    </SelectItem>
                    <SelectItem value="baked">Baked standalone JSON</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <Textarea
                value={currentJson ?? ""}
                readOnly
                className="min-h-[240px] resize-none font-mono text-xs sm:min-h-[360px]"
                aria-label="Pose JSON preview"
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCopyJson}
                  disabled={!currentJson}
                >
                  <CopyIcon className="size-4" />
                  Copy JSON
                </Button>
                <Button
                  type="button"
                  onClick={handleDownloadJson}
                  disabled={!currentJson}
                >
                  <DownloadIcon className="size-4" />
                  Download
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <PoseCreatorPanelSection
      title="Browser Pose Drafts"
      subtitle={`${savedDrafts.length} browser-only drafts`}
      defaultOpen
    >
      <div className="space-y-1.5">
        <label className="text-muted-foreground text-xs font-medium">
          Draft name
        </label>
        <Input
          value={draftName}
          onChange={(event) => setDraftName(event.currentTarget.value)}
          placeholder="Standing wave"
          aria-label="Draft name"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          size="sm"
          onClick={handleSaveDraft}
          disabled={!canSaveDraft}
          className="h-8"
        >
          <SaveIcon className="size-3.5" />
          {selectedSavedDraftId ? "Update" : "Save"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={handleCopyJson}
          disabled={!currentJson}
          className="h-8"
        >
          <CopyIcon className="size-3.5" />
          Copy JSON
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={handleDownloadJson}
          disabled={!currentJson}
          className="h-8"
        >
          <DownloadIcon className="size-3.5" />
          Download
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => jsonFileInputRef.current?.click()}
          disabled={!activeAvatar}
          className="h-8"
        >
          <UploadIcon className="size-3.5" />
          Import file
        </Button>
      </div>

      <label className="grid gap-1.5">
        <span className="text-muted-foreground text-xs font-medium">
          Export mode
        </span>
        <Select
          value={exportMode}
          onValueChange={(mode) =>
            setExportMode(mode as PoseCreatorPoseExportMode)
          }
        >
          <SelectTrigger className="w-full" aria-label="Pose export mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="inherited">Inherited sparse JSON</SelectItem>
            <SelectItem value="baked">Baked standalone JSON</SelectItem>
          </SelectContent>
        </Select>
      </label>

      <input
        ref={jsonFileInputRef}
        className="hidden"
        type="file"
        accept=".json,application/json"
        onChange={handleJsonFileChange}
      />

      <div className="space-y-1.5">
        <label className="text-muted-foreground text-xs font-medium">
          Import JSON
        </label>
        <Textarea
          value={importText}
          onChange={(event) => setImportText(event.currentTarget.value)}
          placeholder='{"schema":"animaPose/1.0","humanoid":{"rightHand":{"rotationEulerDegrees":[0,0,0]}}}'
          className="min-h-24 font-mono text-xs"
          aria-label="Import animaPose JSON"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={handleImportText}
          disabled={!activeAvatar || importText.trim().length === 0}
          className="h-8 w-full"
        >
          <FileJsonIcon className="size-3.5" />
          Import pasted JSON
        </Button>
      </div>

      {importError ? (
        <p className="text-destructive text-xs">{importError}</p>
      ) : null}

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground text-xs font-medium">
            Saved drafts
          </span>
          <span className="text-muted-foreground text-[10px]">
            Browser local
          </span>
        </div>
        {savedDrafts.length > 0 ? (
          <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
            {savedDrafts.map((draft) => (
              <SavedDraftRow
                key={draft.id}
                draft={draft}
                isCurrent={draft.id === selectedSavedDraftId}
                onLoad={handleLoadSavedDraft}
                onCreateBranch={handleCreateBranch}
                onDelete={handleDeleteSavedDraft}
              />
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">
            Saved pose drafts will appear here.
          </p>
        )}
      </div>
    </PoseCreatorPanelSection>
  );
}
