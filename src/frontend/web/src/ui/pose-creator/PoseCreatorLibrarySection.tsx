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
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import { AVATAR_POSE_IDS, parseAnimaPose, type AnimaPose } from "@/lib/avatar";
import type { PyPose } from "@animama/runtime-contracts/api-types";
import { ContentSaveApiError } from "@/lib/content/contentSaveErrors";
import { fetchPoseNames, usePoses } from "@/query/hooks/usePoses";
import { createUniqueContentName } from "@/lib/content/uniqueContentName";
import { usePoseContentActions } from "@/query/mutations/usePoseContentActions";
import {
  preparePoseSaveAttempt,
  poseSavedIdentity,
  type PoseSaveAttempt,
} from "@/lib/content/poseContent";
import { editActionEditorSavedPose } from "@/ui/action-editor/actionEditorSavedPose";
import { cn } from "@/lib/utils";
import { useRuntimePlatform } from "@/platform/RuntimePlatformProvider";
import {
  DEFAULT_POSE_CREATOR_BASE_POSE,
  POSE_CREATOR_VRM_T_POSE_BASE_POSE_ID,
  selectCanRedoClip,
  selectCanRedoPose,
  selectCanUndoClip,
  selectCanUndoPose,
  capturePoseCreatorSubmittedDraft,
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
  buildPoseCreatorAnimaPoseForExport,
  createUniquePoseCreatorBranchName,
  formatPoseCreatorAnimaPoseJson,
  hasPoseCreatorDraftContent,
  replacePoseCreatorDraftWithAnimaPose,
  type PoseCreatorPoseExportMode,
} from "./poseCreatorAuthoring";

// One transient editor session survives toolbar remounts (for example switching to Clip).
// Retain ambiguous Save requests so an identical retry cannot create a second Local item.
let poseSaveAttempt: {
  sessionToken: string;
  attempt: PoseSaveAttempt;
  submittedDraft: ReturnType<typeof capturePoseCreatorSubmittedDraft>;
} | null = null;

// These domain errors confirm that the attempted mutation did not commit.
// Unknown operations/timeouts retain their receipt even when delivered as 4xx.
const REJECTED_POSE_SAVE_CODES = new Set([
  "content_path_exists",
  "invalid_entry_name",
  "content_path_invalid",
  "content_invalid",
  "catalog_revision_conflict",
  "content_destination_mismatch",
  "content_not_found",
  "saved_content_invalid",
  "content_descriptor_too_large",
]);

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
  draft: PyPose;
  isCurrent: boolean;
  onLoad: (draft: PyPose) => void;
  onCreateBranch: (draft: PyPose) => void;
  onDelete: (draft: PyPose) => void;
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
        aria-label={`Edit ${draft.name}`}
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
              <span className="bg-primary/10 text-primary rounded px-1.5 py-0.5 text-2xs">
                Current
              </span>
            ) : null}
          </div>
          <p className="text-muted-foreground mt-0.5 text-2xs">
            {draft.source === "included" ? "Included" : "Local"}
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
            {draft.source === "included" ? "Edit" : "Copy"}
          </Button>
          {draft.source === "local" ? (
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
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SavedDraftLoadButton({
  savedDrafts,
  pending,
  error,
  onRetry,
  selectedSavedDraftId,
  onLoad,
  onCreateBranch,
  onDelete,
}: {
  savedDrafts: PyPose[];
  pending?: boolean;
  error?: string | null;
  onRetry?: () => void;
  selectedSavedDraftId: string | null;
  onLoad: (draft: PyPose) => void;
  onCreateBranch: (draft: PyPose) => void;
  onDelete: (draft: PyPose) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="bg-background dark:bg-background dark:hover:bg-accent disabled:text-muted-foreground col-start-2 row-start-1 size-11 rounded-xl p-0 shadow-sm disabled:opacity-100 lg:col-start-3 lg:h-12 2xl:w-auto 2xl:min-w-[88px] 2xl:px-4"
          aria-label="Load pose"
        >
          <FolderOpenIcon className="size-4" />
          <span className="hidden 2xl:inline">Load</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        avoidSidebar
        side="bottom"
        align="end"
        sideOffset={12}
        className="w-[520px] rounded-xl p-3"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Pose Library</p>
          </div>
          <span className="text-muted-foreground text-xs">
            {savedDrafts.length}
          </span>
        </div>
        {pending ? (
          <p className="text-muted-foreground text-xs">Loading poses…</p>
        ) : error ? (
          <div role="alert" className="text-destructive text-xs">
            {error}
            <Button onClick={onRetry} variant="ghost">
              Try again
            </Button>
          </div>
        ) : savedDrafts.length > 0 ? (
          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {savedDrafts.map((draft) => (
              <SavedDraftRow
                key={draft.item_id}
                draft={draft}
                isCurrent={draft.item_id === selectedSavedDraftId}
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
            No Included or Local poses are available.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function PoseCreatorLibrarySection({
  variant = "panel",
  hideNew = false,
}: {
  variant?: "panel" | "toolbar";
  /** Item editing in Library does not introduce another New Pose entry. */
  hideNew?: boolean;
}) {
  const runtimePlatform = useRuntimePlatform();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const historyShortcuts = getPoseCreatorHistoryShortcutLabels(
    runtimePlatform.os,
  );
  const jsonFileInputRef = useRef<HTMLInputElement | null>(null);
  const [importText, setImportText] = useState("");
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [jsonDialogOpen, setJsonDialogOpen] = useState(false);
  const [exportMode, setExportMode] =
    useState<PoseCreatorPoseExportMode>("inherited");
  const showJson = variant === "panel" || jsonDialogOpen;
  const selectedSource = usePoseCreatorStore((state) => state.selectedSource);
  const basePose = usePoseCreatorStore((state) => state.basePose);
  const activeAvatar = usePoseCreatorStore((state) => state.activeAvatar);
  // Hidden export UI must not rebuild the toolbar on every gizmo movement.
  const boneDrafts = usePoseCreatorStore((state) =>
    showJson ? state.boneDrafts : null,
  );
  const expressionDrafts = usePoseCreatorStore((state) =>
    showJson ? state.expressionDrafts : null,
  );
  const hasPoseContent = usePoseCreatorStore((state) =>
    hasPoseCreatorDraftContent(
      state.boneDrafts,
      state.expressionDrafts,
      state.basePose,
    ),
  );
  const draftName = usePoseCreatorStore((state) => state.draftName);
  const posesQuery = usePoses();
  const savedDrafts = posesQuery.data?.items ?? [];
  const { savePose, deletePose } = usePoseContentActions();
  const pendingSave = useRef(false);
  const savedPoseIdentity = usePoseCreatorStore(
    (state) => state.savedPoseIdentity,
  );
  const selectedSavedDraftId = savedPoseIdentity?.itemId ?? null;
  const importError = usePoseCreatorStore((state) => state.importError);
  const isDirty = usePoseCreatorStore((state) => state.isDirty);
  const setDraftName = usePoseCreatorStore((state) => state.setDraftName);
  const setImportError = usePoseCreatorStore((state) => state.setImportError);
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
  const currentExportPose = useMemo(
    () =>
      boneDrafts && expressionDrafts
        ? buildPoseCreatorAnimaPoseForExport(boneDrafts, expressionDrafts, {
            id: savedPoseIdentity?.poseId,
            name: draftName,
            parentPose: basePose,
            mode: exportMode,
          })
        : null,
    [
      basePose,
      boneDrafts,
      draftName,
      exportMode,
      expressionDrafts,
      savedPoseIdentity?.poseId,
    ],
  );
  const currentJson = useMemo(
    () =>
      currentExportPose
        ? formatPoseCreatorAnimaPoseJson(currentExportPose)
        : null,
    [currentExportPose],
  );
  const canSaveDraft = Boolean(
    selectedSource &&
    hasPoseContent &&
    (!savedPoseIdentity || isDirty) &&
    !savePose.isPending,
  );

  const saveCurrentPoseDraft = async () => {
    const current = usePoseCreatorStore.getState();
    if (
      pendingSave.current ||
      !current.selectedSource ||
      (current.savedPoseIdentity && !current.isDirty)
    )
      return null;
    const submittedDraft = capturePoseCreatorSubmittedDraft(current);
    const sessionToken = current.poseSessionToken;
    pendingSave.current = true;
    setImportError(null);
    try {
      const previous =
        poseSaveAttempt?.sessionToken === sessionToken ? poseSaveAttempt : null;
      const name =
        submittedDraft.draftName.trim() ||
        (previous && !previous.submittedDraft.draftName.trim()
          ? previous.attempt.input.name
          : createUniqueContentName("New Pose", await fetchPoseNames()));
      if (usePoseCreatorStore.getState().poseSessionToken !== sessionToken)
        return null;
      const pose = buildPoseCreatorAnimaPoseForExport(
        submittedDraft.boneDrafts,
        submittedDraft.expressionDrafts,
        {
          id: current.savedPoseIdentity?.poseId,
          name,
          parentPose: submittedDraft.basePose,
          mode: "baked",
        },
      );
      if (!pose) {
        setImportError(
          "Choose a base or adjust bones or expressions before saving a pose.",
        );
        return null;
      }
      let attempt = preparePoseSaveAttempt(
        {
          name,
          pose,
          identity: current.savedPoseIdentity ?? undefined,
        },
        previous?.attempt,
      );
      if (previous && attempt !== previous.attempt) {
        // A failed response may hide a committed Save. Resolve its exact receipt
        // before changing the command, then update that same durable identity.
        const recovered = await savePose.mutateAsync(previous.attempt.input);
        const recoveredIdentity = poseSavedIdentity(recovered);
        if (
          !usePoseCreatorStore.getState().acknowledgePoseSave({
            sessionToken,
            submittedDraft: previous.submittedDraft,
            savedIdentity: recoveredIdentity,
          })
        )
          return null;
        poseSaveAttempt = null;
        attempt = preparePoseSaveAttempt({
          name,
          pose: { ...pose, id: recoveredIdentity.poseId },
          identity: recoveredIdentity,
        });
      }
      poseSaveAttempt = { sessionToken, attempt, submittedDraft };
      const saved = await savePose.mutateAsync(attempt.input);
      const applied = usePoseCreatorStore.getState().acknowledgePoseSave({
        sessionToken,
        submittedDraft,
        savedIdentity: poseSavedIdentity(saved),
      });
      if (!applied) return null;
      poseSaveAttempt = null;
      toast.success("Pose saved to Local content.");
      return { item: saved, pose: attempt.input.pose, sessionToken };
    } catch (error) {
      if (usePoseCreatorStore.getState().poseSessionToken === sessionToken) {
        if (
          error instanceof ContentSaveApiError &&
          error.status !== null &&
          error.status >= 400 &&
          error.status < 500 &&
          error.code !== null &&
          REJECTED_POSE_SAVE_CODES.has(error.code) &&
          poseSaveAttempt?.sessionToken === sessionToken
        ) {
          poseSaveAttempt = null;
        }
        const message =
          error instanceof Error
            ? error.message
            : "Could not save this pose. Your draft is preserved.";
        setImportError(message);
        toast.error(message);
      }
      return null;
    } finally {
      pendingSave.current = false;
    }
  };

  const handleSaveDraft = () => saveCurrentPoseDraft();

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

  const handleLoadSavedDraft = (item: PyPose) => {
    void editActionEditorSavedPose(item, { isCurrent: () => alive.current });
  };

  /** Creates an independent, unsaved pose snapshot from the supplied pose. */
  const createPoseBranch = async (
    pose: AnimaPose,
    sourceName: string,
    successMessage = "New unsaved pose branch created.",
  ) => {
    if (!activeAvatar) {
      setImportError("Load a VRM before branching a pose.");
      return false;
    }

    const captured = usePoseCreatorStore.getState();
    try {
      const existingNames = await fetchPoseNames();
      const current = usePoseCreatorStore.getState();
      if (
        !alive.current ||
        current.poseSessionToken !== captured.poseSessionToken ||
        current.activeAvatar !== captured.activeAvatar ||
        current.draftName !== captured.draftName ||
        current.boneDrafts !== captured.boneDrafts ||
        current.expressionDrafts !== captured.expressionDrafts
      )
        return false;
      const bakedPose = bakePoseCreatorAnimaPose(pose);
      const drafts = replacePoseCreatorDraftWithAnimaPose(
        activeAvatar,
        bakedPose,
        POSE_CREATOR_VRM_T_POSE_BASE_POSE_ID,
      );
      replaceDraftFromImport({
        draftName: createUniquePoseCreatorBranchName(sourceName, existingNames),
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

  const handleCreateBranch = (item: PyPose) => {
    void editActionEditorSavedPose(item, {
      customize: true,
      isCurrent: () => alive.current,
    });
  };

  const handleSaveAndBranch = async () => {
    const saved = await saveCurrentPoseDraft();
    if (!saved) return;
    const current = usePoseCreatorStore.getState();
    // Edits made during Save must remain in the current draft.
    if (current.poseSessionToken !== saved.sessionToken || current.isDirty)
      return;
    await createPoseBranch(
      saved.pose,
      saved.item.name,
      "Pose saved and a Local copy started.",
    );
  };

  const handleDeleteSavedDraft = async (item: PyPose) => {
    if (item.source !== "local" || deletePose.isPending) return;
    if (!window.confirm(`Delete "${item.name}" from Local content?`)) return;
    try {
      await deletePose.mutateAsync(item);
      const current = usePoseCreatorStore.getState();
      if (current.savedPoseIdentity?.itemId === item.item_id) {
        current.loadPoseDocument(
          null,
          capturePoseCreatorSubmittedDraft(current),
        );
      }
      toast.success("Local pose deleted.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not delete this pose.",
      );
    }
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
                return handleSaveAndBranch();
              } else {
                return handleSaveDraft();
              }
            }}
          >
            <span className="text-muted-foreground ml-1 inline-flex shrink-0 items-center gap-1 text-2xs font-medium">
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
                    isSaved ? "bg-success" : "bg-primary",
                  )}
                />
              </span>
            </PoseDataActionTooltip>
          </form>
        </CreatorHeaderDocument>

        {!hideNew ? (
          <Button
            type="button"
            variant="outline"
            aria-label="New"
            title="New"
            className="bg-background dark:bg-background dark:hover:bg-accent disabled:text-muted-foreground col-start-2 row-start-1 hidden size-12 rounded-xl p-0 shadow-sm disabled:opacity-100 lg:inline-flex 2xl:w-auto 2xl:min-w-[82px] 2xl:px-3"
            onClick={handleNewPose}
          >
            <FilePlus2Icon className="size-4" />
            <span className="hidden 2xl:inline">New</span>
          </Button>
        ) : null}

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
                disabled={!hasPoseContent}
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
              className="bg-background dark:bg-background dark:hover:bg-accent disabled:text-muted-foreground col-start-3 row-start-2 size-11 rounded-xl p-0 shadow-sm disabled:opacity-100 lg:hidden"
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
            {!hideNew ? (
              <DropdownMenuItem
                className="min-h-11 gap-3 rounded-lg"
                onSelect={handleNewPose}
              >
                <FilePlus2Icon className="size-4" />
                New pose
              </DropdownMenuItem>
            ) : null}
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
              disabled={!hasPoseContent}
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

        {importError ? (
          <p role="alert" className="text-destructive col-span-full text-xs">
            {importError}
          </p>
        ) : null}
        {posesQuery.isError ? (
          <p role="alert" className="text-destructive col-span-full text-xs">
            Could not load poses.{" "}
            <button type="button" onClick={() => void posesQuery.refetch()}>
              Try again
            </button>
          </p>
        ) : null}
        <SavedDraftLoadButton
          pending={posesQuery.isPending}
          error={posesQuery.error?.message}
          onRetry={() => void posesQuery.refetch()}
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
                <span className="text-muted-foreground text-2xs uppercase">
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
      title="Pose Library"
      subtitle={`${savedDrafts.length} Included and Local poses`}
      defaultOpen
    >
      <div className="space-y-1.5">
        <label className="text-muted-foreground text-xs font-medium">
          Draft name
        </label>
        <Input
          value={draftName}
          onChange={(event) => setDraftName(event.currentTarget.value)}
          placeholder="New Pose"
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
            Poses
          </span>
          <span className="text-muted-foreground text-2xs">
            Included / Local
          </span>
        </div>
        {savedDrafts.length > 0 ? (
          <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
            {savedDrafts.map((draft) => (
              <SavedDraftRow
                key={draft.item_id}
                draft={draft}
                isCurrent={draft.item_id === selectedSavedDraftId}
                onLoad={handleLoadSavedDraft}
                onCreateBranch={handleCreateBranch}
                onDelete={handleDeleteSavedDraft}
              />
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">
            Pose Library will appear here.
          </p>
        )}
      </div>
    </PoseCreatorPanelSection>
  );
}
