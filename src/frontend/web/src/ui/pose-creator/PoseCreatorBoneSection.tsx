"use client";

import {
  ArrowLeftRightIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  ChevronsDownIcon,
  ChevronsUpIcon,
  MinusIcon,
  RotateCcwIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";
import type {
  PoseCreatorBoneDraft,
  PoseCreatorRotationAxis,
  PoseCreatorRotationDegrees,
} from "@/stores/pose-creator-store";
import {
  POSE_CREATOR_VRM_T_POSE_BASE_POSE_ID,
  usePoseCreatorStore,
} from "@/stores/pose-creator-store";
import { Button } from "@/ui/components/button";
import { Checkbox } from "@/ui/components/checkbox";
import { Input } from "@/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/select";
import { Slider } from "@/ui/components/slider";
import { Switch } from "@/ui/components/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/ui/components/tooltip";
import { PoseCreatorPanelSection } from "./PoseCreatorPanelSection";
import { PoseCreatorHelpersToggle } from "./PoseCreatorHelpersToggle";
import {
  buildPoseCreatorBoneTree,
  clampRotationDegrees,
  cloneRotationDegrees,
  createZeroRotationDegrees,
  getBoneDraftBaseDegrees,
  getPoseCreatorMirrorBoneName,
  getPoseCreatorBoneAncestorNames,
  readPoseCreatorBoneRows,
  restoreBoneBaseQuaternion,
  type PoseCreatorBoneRow,
  type PoseCreatorBoneTreeNode,
} from "./poseCreatorAuthoring";
import { usePoseCreatorBoneRotation } from "./usePoseCreatorBoneRotation";
import { usePoseCreatorUndoGrouping } from "./usePoseCreatorUndoGrouping";

const ROTATION_AXES: Array<{
  axis: PoseCreatorRotationAxis;
  label: string;
}> = [
  { axis: "x", label: "X" },
  { axis: "y", label: "Y" },
  { axis: "z", label: "Z" },
];

function formatRowDegrees(row: PoseCreatorBoneRow): string {
  const value = row.currentEulerDegrees;
  if (!value) return "Missing";
  return `${value.x.toFixed(0)} / ${value.y.toFixed(0)} / ${value.z.toFixed(0)}`;
}

function formatRotationInputValue(value: number): string {
  return clampRotationDegrees(value).toFixed(1);
}

function isIncompleteNumberInput(value: string): boolean {
  return value === "" || value === "-" || value === "+" || value === ".";
}

function getSelectedRotationDegrees(
  draft: PoseCreatorBoneDraft | null,
  selectedRow: PoseCreatorBoneRow | null,
): PoseCreatorRotationDegrees {
  if (draft) return cloneRotationDegrees(draft.rotationDegrees);
  if (selectedRow?.currentEulerDegrees) {
    return cloneRotationDegrees(selectedRow.currentEulerDegrees);
  }
  return createZeroRotationDegrees();
}

function getSelectedBaseRotationDegrees(
  draft: PoseCreatorBoneDraft | null,
  selectedRow: PoseCreatorBoneRow | null,
): PoseCreatorRotationDegrees {
  if (draft) return getBoneDraftBaseDegrees(draft);
  if (selectedRow?.currentEulerDegrees) {
    return cloneRotationDegrees(selectedRow.currentEulerDegrees);
  }
  return createZeroRotationDegrees();
}

type BoneTreeProps = {
  tree: PoseCreatorBoneTreeNode[];
  expandedBoneNames: Set<string>;
  selectedBone: string | null;
  onToggleBone: (boneName: string) => void;
  onSelectBone: (boneName: string) => void;
  variant?: "panel" | "workspace" | "mobile";
};

const BoneTree = memo(function BoneTree({
  tree,
  expandedBoneNames,
  selectedBone,
  onToggleBone,
  onSelectBone,
  variant = "panel",
}: BoneTreeProps) {
  return (
    <div
      className={cn(
        "overflow-y-auto",
        variant === "panel"
          ? "border-border/60 max-h-72 rounded-md border"
          : variant === "mobile"
            ? "min-h-0 flex-1 pr-1"
            : "max-h-[calc(100vh-18rem)] pr-1",
      )}
    >
      {tree.map((node) => (
        <BoneTreeRow
          key={node.boneName}
          node={node}
          expandedBoneNames={expandedBoneNames}
          selectedBone={selectedBone}
          onToggleBone={onToggleBone}
          onSelectBone={onSelectBone}
          variant={variant}
        />
      ))}
    </div>
  );
});

function BoneTreeRow({
  node,
  expandedBoneNames,
  selectedBone,
  onToggleBone,
  onSelectBone,
  variant,
}: {
  node: PoseCreatorBoneTreeNode;
  expandedBoneNames: Set<string>;
  selectedBone: string | null;
  onToggleBone: (boneName: string) => void;
  onSelectBone: (boneName: string) => void;
  variant: "panel" | "workspace" | "mobile";
}) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedBoneNames.has(node.boneName);
  const isSelected = node.boneName === selectedBone;
  const isDrafted = Boolean(node.draft);
  const ToggleIcon = isExpanded ? ChevronDownIcon : ChevronRightIcon;

  return (
    <>
      <div
        className={cn(
          variant === "panel"
            ? "text-2xs grid grid-cols-[1.5rem_minmax(0,1fr)_5rem] items-stretch gap-1 border-b last:border-b-0"
            : "grid grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-1 rounded-lg text-xs",
          node.available
            ? "hover:bg-muted/70"
            : "text-muted-foreground opacity-60",
          isSelected &&
            (variant === "workspace"
              ? "bg-primary/10 text-primary"
              : "bg-muted"),
        )}
        style={{
          paddingLeft: `${
            variant === "workspace" ? node.depth * 0.45 : node.depth * 0.75
          }rem`,
        }}
      >
        <button
          type="button"
          className={cn(
            "text-muted-foreground flex items-center justify-center",
            variant === "panel" ? "min-h-11" : "h-8",
            hasChildren
              ? "hover:text-foreground cursor-pointer"
              : "cursor-default opacity-0",
          )}
          aria-label={isExpanded ? "Collapse bone group" : "Expand bone group"}
          aria-expanded={hasChildren ? isExpanded : undefined}
          onClick={() => hasChildren && onToggleBone(node.boneName)}
          disabled={!hasChildren}
        >
          <ToggleIcon className="size-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={cn(
            "min-w-0 text-left",
            "focus-visible:outline-none",
            variant === "panel" ? "py-1.5" : "py-2",
            node.available ? "cursor-pointer" : "cursor-not-allowed",
          )}
          onClick={() => node.available && onSelectBone(node.boneName)}
          disabled={!node.available}
        >
          <span
            className={cn(
              "block truncate",
              variant === "panel" ? "text-foreground font-mono" : "font-medium",
            )}
          >
            {variant === "workspace"
              ? formatBoneLabel(node.boneName)
              : node.boneName}
          </span>
          {variant === "panel" ? (
            <span className="text-muted-foreground block truncate">
              {node.normalizedNodeName ?? "Unavailable"}
            </span>
          ) : null}
        </button>
        {variant === "panel" ? (
          <span
            className={cn(
              "text-muted-foreground flex items-center justify-end pr-2 text-right font-mono tabular-nums",
              isDrafted && "text-primary",
            )}
          >
            {formatRowDegrees(node)}
          </span>
        ) : null}
      </div>
      {hasChildren && isExpanded
        ? node.children.map((child) => (
            <BoneTreeRow
              key={child.boneName}
              node={child}
              expandedBoneNames={expandedBoneNames}
              selectedBone={selectedBone}
              onToggleBone={onToggleBone}
              onSelectBone={onSelectBone}
              variant={variant}
            />
          ))
        : null}
    </>
  );
}

function formatBoneLabel(boneName: string): string {
  const withSpaces = boneName
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ");
  return withSpaces.replace(/\b\w/g, (character) => character.toUpperCase());
}

function filterBoneTree(
  tree: PoseCreatorBoneTreeNode[],
  query: string,
): PoseCreatorBoneTreeNode[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return tree;

  return tree.flatMap((node) => {
    const children = filterBoneTree(node.children, normalizedQuery);
    const matches =
      node.boneName.toLowerCase().includes(normalizedQuery) ||
      formatBoneLabel(node.boneName).toLowerCase().includes(normalizedQuery);
    return matches || children.length > 0 ? [{ ...node, children }] : [];
  });
}

function collectExpandableBoneNames(tree: PoseCreatorBoneTreeNode[]): string[] {
  return tree.flatMap((node) => [
    ...(node.children.length > 0 ? [node.boneName] : []),
    ...collectExpandableBoneNames(node.children),
  ]);
}

export function PoseCreatorBoneSection({
  variant = "panel",
  onCollapse,
  browserExpanded = true,
  handToggle,
}: {
  variant?: "panel" | "workspace" | "mobile";
  onCollapse?: () => void;
  /** Keep the authoring controls mounted while compacting the bone browser. */
  browserExpanded?: boolean;
  /** Supplied only by Gesture Pose mode; other shared editors keep their tools. */
  handToggle?: ReactNode;
}) {
  const activeAvatar = usePoseCreatorStore((state) => state.activeAvatar);
  const basePose = usePoseCreatorStore((state) => state.basePose);
  const selectedBone = usePoseCreatorStore((state) => state.selectedBone);
  const selectedBoneFocusRequest = usePoseCreatorStore(
    (state) => state.selectedBoneFocusRequest,
  );
  const boneDrafts = usePoseCreatorStore((state) => state.boneDrafts);
  const setSelectedBone = usePoseCreatorStore((state) => state.setSelectedBone);
  const focusBone = usePoseCreatorStore((state) => state.focusBone);
  const boneHelperNodesVisible = usePoseCreatorStore(
    (state) => state.boneHelperNodesVisible,
  );
  const setBoneHelperNodesVisible = usePoseCreatorStore(
    (state) => state.setBoneHelperNodesVisible,
  );
  const {
    mirrorOppositeBone,
    resetSelectedBoneRotation,
    setMirrorOppositeBoneEnabled,
    updateSelectedBoneRotation,
  } = usePoseCreatorBoneRotation();
  const { beginUndoGroup, endUndoGroup } = usePoseCreatorUndoGrouping();

  const rows = useMemo(
    () => readPoseCreatorBoneRows(activeAvatar, boneDrafts),
    [activeAvatar, boneDrafts],
  );
  // Workspace/mobile lists show bone metadata only. Keep that tree stable as
  // the selected bone's live rotation controls update during a drag.
  const browserRows = useMemo(
    () => readPoseCreatorBoneRows(activeAvatar, {}),
    [activeAvatar],
  );
  const treeRows = variant === "panel" ? rows : browserRows;
  const boneTree = useMemo(
    () => buildPoseCreatorBoneTree(treeRows),
    [treeRows],
  );
  const expandableBoneNames = useMemo(
    () => collectExpandableBoneNames(boneTree),
    [boneTree],
  );
  const [expandedBoneNames, setExpandedBoneNames] = useState<Set<string>>(
    () => new Set(),
  );
  const expandedAvatarRef = useRef<typeof activeAvatar>(null);
  const [boneSearch, setBoneSearch] = useState("");
  const [rotationInputValues, setRotationInputValues] = useState<
    Partial<Record<PoseCreatorRotationAxis, string>>
  >({});
  const availableRows = rows.filter((row) => row.available);
  const selectedRow = rows.find((row) => row.boneName === selectedBone) ?? null;
  const selectedDraft =
    selectedBone && boneDrafts[selectedBone] ? boneDrafts[selectedBone] : null;
  const mirroredBoneName = selectedBone
    ? getPoseCreatorMirrorBoneName(selectedBone)
    : null;
  const mirroredRow =
    rows.find((row) => row.boneName === mirroredBoneName) ?? null;
  const canMirrorSelectedBone = Boolean(
    mirroredBoneName && mirroredRow?.available,
  );
  const selectedRotationDegrees = getSelectedRotationDegrees(
    selectedDraft,
    selectedRow,
  );
  const selectedBaseRotationDegrees = getSelectedBaseRotationDegrees(
    selectedDraft,
    selectedRow,
  );
  const activeDraftCount = Object.keys(boneDrafts).length;
  const canSetNeutralOverride = Boolean(
    activeAvatar &&
    selectedBone &&
    selectedRow?.available &&
    basePose !== POSE_CREATOR_VRM_T_POSE_BASE_POSE_ID,
  );
  const filteredBoneTree = useMemo(
    () => filterBoneTree(boneTree, boneSearch),
    [boneSearch, boneTree],
  );
  const searchExpandedBoneNames = useMemo(
    () =>
      boneSearch.trim()
        ? new Set(browserRows.map((row) => row.boneName))
        : expandedBoneNames,
    [boneSearch, browserRows, expandedBoneNames],
  );

  useEffect(() => {
    setExpandedBoneNames(new Set());
    setBoneSearch("");
    expandedAvatarRef.current = null;
  }, [activeAvatar]);

  useEffect(() => {
    if (
      !activeAvatar ||
      expandedAvatarRef.current === activeAvatar ||
      expandableBoneNames.length === 0
    ) {
      return;
    }
    expandedAvatarRef.current = activeAvatar;
    setExpandedBoneNames(new Set(expandableBoneNames));
  }, [activeAvatar, expandableBoneNames]);

  const expandBoneAncestors = useCallback((boneName: string) => {
    const ancestors = getPoseCreatorBoneAncestorNames(boneName);
    if (ancestors.length === 0) return;
    setExpandedBoneNames((current) => {
      let hasChanges = false;
      const next = new Set(current);
      for (const boneName of ancestors) {
        if (!next.has(boneName)) {
          next.add(boneName);
          hasChanges = true;
        }
      }
      return hasChanges ? next : current;
    });
  }, []);

  useEffect(() => {
    if (!selectedBoneFocusRequest) return;
    expandBoneAncestors(selectedBoneFocusRequest.boneName);
  }, [expandBoneAncestors, selectedBoneFocusRequest]);

  useEffect(() => {
    setRotationInputValues({});
  }, [selectedBone]);

  const handleAxisChange = (axis: PoseCreatorRotationAxis, value: number) => {
    const nextRotationDegrees = {
      ...selectedRotationDegrees,
      [axis]: clampRotationDegrees(value),
    };
    updateSelectedBoneRotation(nextRotationDegrees);
  };

  const handleAxisInputChange = (
    axis: PoseCreatorRotationAxis,
    value: string,
  ) => {
    setRotationInputValues((current) => ({
      ...current,
      [axis]: value,
    }));
    if (isIncompleteNumberInput(value)) return;

    const parsedValue = Number(value);
    if (!Number.isFinite(parsedValue)) return;
    handleAxisChange(axis, parsedValue);
  };

  const handleAxisInputBlur = (axis: PoseCreatorRotationAxis) => {
    setRotationInputValues((current) => {
      const nextValues = { ...current };
      delete nextValues[axis];
      return nextValues;
    });
  };

  const handleResetAxis = (axis: PoseCreatorRotationAxis) => {
    handleAxisInputBlur(axis);
    handleAxisChange(axis, selectedBaseRotationDegrees[axis]);
  };

  const handleResetSelectedBone = () => {
    resetSelectedBoneRotation();
  };

  const handleSetSelectedBoneNeutral = () => {
    if (!canSetNeutralOverride) return;
    updateSelectedBoneRotation(createZeroRotationDegrees());
  };

  const handleResetAllBones = useCallback(() => {
    // The browser can stay memoized while rotations change. Read the current
    // drafts when the user resets them rather than capturing a stale pose.
    const { activeAvatar, boneDrafts, clearBoneDrafts } =
      usePoseCreatorStore.getState();
    if (!activeAvatar) return;
    for (const [boneName, draft] of Object.entries(boneDrafts)) {
      restoreBoneBaseQuaternion(activeAvatar, boneName, draft);
    }
    clearBoneDrafts();
  }, []);

  const handleToggleBone = useCallback((boneName: string) => {
    setExpandedBoneNames((current) => {
      const next = new Set(current);
      if (next.has(boneName)) {
        next.delete(boneName);
      } else {
        next.add(boneName);
      }
      return next;
    });
  }, []);

  const handleExpandAllBones = useCallback(() => {
    setExpandedBoneNames(new Set(expandableBoneNames));
  }, [expandableBoneNames]);

  const handleCollapseAllBones = useCallback(() => {
    setExpandedBoneNames(new Set());
  }, []);

  const handleSelectBone = useCallback(
    (boneName: string) => {
      if (variant !== "panel" && selectedBone === boneName) {
        setSelectedBone(null);
        return;
      }
      focusBone(boneName);
      expandBoneAncestors(boneName);
    },
    [expandBoneAncestors, focusBone, selectedBone, setSelectedBone, variant],
  );

  const handleMirrorOppositeBoneChange = (checked: boolean) => {
    setMirrorOppositeBoneEnabled(checked);
  };

  const hasSelectedRow = selectedRow !== null;
  const availableBoneCount = availableRows.length;
  const hasDraftedBones = activeDraftCount > 0;
  // The complete browser, including its tooltip portals, does not depend on
  // live rotation values. Only the authoring controls below update per drag.
  const boneBrowser = useMemo(() => {
    if (variant === "panel" || !browserExpanded) return null;
    return (
      <aside
        className={cn(
          "border-border/65 bg-background pointer-events-auto flex flex-col border p-4 backdrop-blur-xl",
          variant === "mobile"
            ? hasSelectedRow
              ? "hidden"
              : "h-full min-h-0 w-full border-0"
            : "absolute top-4 left-[calc(var(--app-shell-sidebar-inset)+1rem)] w-[248px] rounded-2xl shadow-xl shadow-black/8 transition-[left] duration-150 ease-in-out xl:left-[calc(var(--app-shell-sidebar-inset)+2rem)] xl:w-[288px] 2xl:w-[340px]",
        )}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Bones</h2>
            <p className="text-muted-foreground text-2xs mt-0.5">
              {availableBoneCount} available
            </p>
          </div>
          <div className="flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="text-muted-foreground size-7"
                  onClick={handleExpandAllBones}
                  disabled={
                    expandableBoneNames.length === 0 ||
                    expandableBoneNames.every((boneName) =>
                      expandedBoneNames.has(boneName),
                    )
                  }
                  aria-label="Expand all bone groups"
                >
                  <ChevronsDownIcon className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Expand all</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="text-muted-foreground size-7"
                  onClick={handleCollapseAllBones}
                  disabled={expandedBoneNames.size === 0}
                  aria-label="Collapse all bone groups"
                >
                  <ChevronsUpIcon className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Collapse all</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="text-muted-foreground size-7"
                  onClick={handleResetAllBones}
                  disabled={!hasDraftedBones}
                  aria-label="Reset all bone changes"
                >
                  <RotateCcwIcon className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Reset all changes</TooltipContent>
            </Tooltip>
            {variant === "workspace" && onCollapse ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className="text-muted-foreground size-7"
                    onClick={onCollapse}
                    aria-label="Collapse bone tools"
                  >
                    <ChevronUpIcon className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  Collapse bone tools
                </TooltipContent>
              </Tooltip>
            ) : null}
          </div>
        </div>
        <div className="mb-3 flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2" />
            <Input
              value={boneSearch}
              onChange={(event) => setBoneSearch(event.currentTarget.value)}
              placeholder="Search bones"
              aria-label="Search bones"
              className="bg-background h-9 rounded-lg pl-9 text-xs shadow-none"
            />
          </div>
          <PoseCreatorHelpersToggle
            checked={boneHelperNodesVisible}
            onCheckedChange={setBoneHelperNodesVisible}
          />
          {handToggle}
        </div>
        {filteredBoneTree.length > 0 ? (
          <BoneTree
            tree={filteredBoneTree}
            expandedBoneNames={searchExpandedBoneNames}
            selectedBone={selectedBone}
            onToggleBone={handleToggleBone}
            onSelectBone={handleSelectBone}
            variant={variant === "mobile" ? "mobile" : "workspace"}
          />
        ) : (
          <p className="text-muted-foreground py-8 text-center text-xs">
            No matching bones
          </p>
        )}
      </aside>
    );
  }, [
    availableBoneCount,
    boneHelperNodesVisible,
    boneSearch,
    browserExpanded,
    expandableBoneNames,
    expandedBoneNames,
    filteredBoneTree,
    handleCollapseAllBones,
    handleExpandAllBones,
    handleResetAllBones,
    handleSelectBone,
    handleToggleBone,
    hasDraftedBones,
    hasSelectedRow,
    handToggle,
    onCollapse,
    searchExpandedBoneNames,
    selectedBone,
    setBoneHelperNodesVisible,
    variant,
  ]);

  if (variant !== "panel") {
    const selectedBoneIsRest = Boolean(
      selectedDraft &&
      ROTATION_AXES.every(
        ({ axis }) => Math.abs(selectedRotationDegrees[axis]) < 0.05,
      ),
    );

    return (
      <>
        {boneBrowser}

        {selectedRow || variant === "workspace" ? (
          <aside
            className={cn(
              "border-border/65 bg-background pointer-events-auto border p-4 backdrop-blur-xl",
              variant === "mobile"
                ? "h-full min-h-0 w-full overflow-y-auto border-0 pb-[calc(1rem+env(safe-area-inset-bottom))]"
                : "absolute top-4 right-4 w-[248px] rounded-2xl shadow-xl shadow-black/8 xl:right-8 xl:w-[296px] 2xl:w-[308px]",
            )}
          >
            {variant === "mobile" && handToggle ? (
              <div className="mb-3 flex justify-end gap-2">
                <PoseCreatorHelpersToggle
                  checked={boneHelperNodesVisible}
                  onCheckedChange={setBoneHelperNodesVisible}
                />
                {handToggle}
              </div>
            ) : null}
            <div
              className={cn(
                "flex items-start justify-between gap-3",
                selectedRow && "mb-3",
              )}
            >
              <div className="min-w-0">
                <h2 className="text-sm font-semibold">Bone Authoring</h2>
                <p className="text-muted-foreground mt-1 truncate text-xs">
                  {selectedRow
                    ? formatBoneLabel(selectedRow.boneName)
                    : "Select a bone to edit its rotation"}
                </p>
              </div>
              {selectedRow ? (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="text-muted-foreground -mt-1 -mr-1 size-7"
                  onClick={() => setSelectedBone(null)}
                  aria-label="Clear selected bone"
                >
                  <XIcon className="size-4" />
                </Button>
              ) : null}
            </div>

            {selectedRow ? (
              <>
                <div className="space-y-3">
                  {ROTATION_AXES.map(({ axis, label }) => (
                    <div
                      key={axis}
                      className="grid grid-cols-[18px_minmax(0,1fr)_76px] items-center gap-2"
                    >
                      <span
                        className={cn(
                          "text-xs font-medium",
                          axis === "x" && "text-[#e27878]",
                          axis === "y" && "text-[#79aa8c]",
                          axis === "z" && "text-[#4d8fda]",
                        )}
                      >
                        {label}
                      </span>
                      <Slider
                        value={[selectedRotationDegrees[axis]]}
                        min={-180}
                        max={180}
                        step={1}
                        disabled={!activeAvatar || !selectedRow.available}
                        onValueChange={(values) => {
                          const [value] = values;
                          if (typeof value === "number") {
                            handleAxisInputBlur(axis);
                            handleAxisChange(axis, value);
                          }
                        }}
                        onPointerDown={beginUndoGroup}
                        onPointerUp={endUndoGroup}
                        onPointerCancel={endUndoGroup}
                        onKeyDown={beginUndoGroup}
                        onKeyUp={endUndoGroup}
                        onBlur={endUndoGroup}
                        className={cn(
                          "[&_[data-slot=slider-thumb]]:size-4 [&_[data-slot=slider-thumb]]:border-white [&_[data-slot=slider-thumb]]:shadow-md [&_[data-slot=slider-track]]:h-[3px] [&_[data-slot=slider-track]]:bg-[#d8d8d5]",
                          axis === "x" &&
                            "[&_[data-slot=slider-range]]:bg-[#e27878]",
                          axis === "y" &&
                            "[&_[data-slot=slider-range]]:bg-[#79aa8c]",
                          axis === "z" &&
                            "[&_[data-slot=slider-range]]:bg-[#4d8fda]",
                        )}
                        aria-label={`${label} rotation`}
                      />
                      <div className="relative">
                        <Input
                          type="number"
                          inputMode="decimal"
                          min={-180}
                          max={180}
                          step={0.1}
                          value={
                            rotationInputValues[axis] ??
                            formatRotationInputValue(
                              selectedRotationDegrees[axis],
                            )
                          }
                          disabled={!activeAvatar || !selectedRow.available}
                          onChange={(event) =>
                            handleAxisInputChange(
                              axis,
                              event.currentTarget.value,
                            )
                          }
                          onFocus={beginUndoGroup}
                          onBlur={() => {
                            handleAxisInputBlur(axis);
                            endUndoGroup();
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter")
                              event.currentTarget.blur();
                          }}
                          className="h-7 w-full [appearance:textfield] border-0 bg-transparent pr-3 pl-0 text-right font-mono text-xs tabular-nums shadow-none focus-visible:ring-0 dark:bg-transparent [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          aria-label={`${label} rotation degrees`}
                        />
                        <span className="text-muted-foreground text-2xs pointer-events-none absolute top-1/2 right-0 -translate-y-1/2">
                          °
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="border-border/60 mt-4 flex items-center justify-between gap-4 border-t pt-3">
                  <label className="flex items-center gap-3 text-xs">
                    <span className="text-muted-foreground">Inherit</span>
                    <Switch
                      checked={!selectedDraft}
                      onCheckedChange={(checked) => {
                        if (checked) handleResetSelectedBone();
                      }}
                      aria-label="Inherit selected bone rotation"
                    />
                  </label>
                  <label className="flex items-center gap-3 text-xs">
                    <span className="text-muted-foreground">Rest</span>
                    <Switch
                      checked={selectedBoneIsRest}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          handleSetSelectedBoneNeutral();
                        } else {
                          handleResetSelectedBone();
                        }
                      }}
                      disabled={!canSetNeutralOverride && !selectedBoneIsRest}
                      aria-label="Use neutral rest rotation"
                    />
                  </label>
                </div>

                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    handleMirrorOppositeBoneChange(!mirrorOppositeBone)
                  }
                  disabled={!canMirrorSelectedBone}
                  className={cn(
                    "mt-3 h-8 w-full rounded-lg text-xs",
                    mirrorOppositeBone &&
                      "border-primary/40 bg-primary/8 text-primary",
                  )}
                  aria-pressed={mirrorOppositeBone}
                >
                  <ArrowLeftRightIcon className="size-3.5" />
                  Mirror opposite bone
                </Button>
              </>
            ) : null}
          </aside>
        ) : null}
      </>
    );
  }

  return (
    <PoseCreatorPanelSection
      title="Bone Authoring"
      subtitle={`${availableRows.length} available / ${rows.length} standard bones`}
      openRequestKey={selectedBoneFocusRequest?.requestId ?? null}
      actions={
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={handleResetAllBones}
          disabled={activeDraftCount === 0}
          className="h-7 px-2 text-xs"
        >
          <RotateCcwIcon className="size-3.5" />
          Reset all
        </Button>
      }
    >
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground text-xs font-medium">
            Bones
          </span>
          <span className="text-muted-foreground text-2xs font-mono">
            X / Y / Z
          </span>
        </div>
        <BoneTree
          tree={boneTree}
          expandedBoneNames={expandedBoneNames}
          selectedBone={selectedBone}
          onToggleBone={handleToggleBone}
          onSelectBone={handleSelectBone}
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-muted-foreground text-xs font-medium">
          Selected bone
        </label>
        <Select
          value={selectedBone ?? ""}
          onValueChange={handleSelectBone}
          disabled={!activeAvatar || availableRows.length === 0}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select bone" />
          </SelectTrigger>
          <SelectContent>
            {rows.map((row) => (
              <SelectItem
                key={row.boneName}
                value={row.boneName}
                disabled={!row.available}
              >
                {row.boneName}
                {!row.available ? " (missing)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selectedRow ? (
        <div className="border-border/70 bg-muted/20 space-y-2 rounded-md border p-3 text-xs">
          <div className="grid grid-cols-[84px_minmax(0,1fr)] gap-2">
            <span className="text-muted-foreground">Raw node</span>
            <span
              className="text-foreground truncate"
              title={selectedRow.rawNodeName ?? "Unavailable"}
            >
              {selectedRow.rawNodeName ?? "Unavailable"}
            </span>
          </div>
          <div className="grid grid-cols-[84px_minmax(0,1fr)] gap-2">
            <span className="text-muted-foreground">Norm node</span>
            <span
              className="text-foreground truncate"
              title={selectedRow.normalizedNodeName ?? "Unavailable"}
            >
              {selectedRow.normalizedNodeName ?? "Unavailable"}
            </span>
          </div>
        </div>
      ) : null}

      <label
        className={cn(
          "border-border/70 bg-background flex items-start gap-2 rounded-md border p-3 text-xs",
          !canMirrorSelectedBone && "opacity-60",
        )}
      >
        <Checkbox
          checked={mirrorOppositeBone}
          onCheckedChange={(checked) =>
            handleMirrorOppositeBoneChange(checked === true)
          }
          disabled={!canMirrorSelectedBone}
          aria-label="Mirror opposite left or right bone"
        />
        <span className="min-w-0">
          <span className="text-foreground block font-medium">
            Mirror opposite bone
          </span>
          <span className="text-muted-foreground mt-0.5 block">
            {mirroredBoneName && mirroredRow?.available
              ? `Target: ${mirroredBoneName}`
              : "No opposite bone available."}
          </span>
        </span>
      </label>

      <div className="space-y-3">
        {ROTATION_AXES.map(({ axis, label }) => (
          <div key={axis} className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-foreground font-medium">{label}</span>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={-180}
                    max={180}
                    step={0.1}
                    value={
                      rotationInputValues[axis] ??
                      formatRotationInputValue(selectedRotationDegrees[axis])
                    }
                    disabled={!activeAvatar || !selectedRow?.available}
                    onChange={(event) =>
                      handleAxisInputChange(axis, event.currentTarget.value)
                    }
                    onFocus={beginUndoGroup}
                    onBlur={() => {
                      handleAxisInputBlur(axis);
                      endUndoGroup();
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.currentTarget.blur();
                      }
                    }}
                    className="h-7 w-20 px-2 text-right font-mono text-xs tabular-nums"
                    aria-label={`${label} rotation degrees`}
                  />
                  <span className="text-muted-foreground text-2xs">deg</span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-2xs h-5 px-1.5"
                  onClick={() => handleResetAxis(axis)}
                  disabled={!selectedDraft}
                >
                  Reset
                </Button>
              </div>
            </div>
            <Slider
              value={[selectedRotationDegrees[axis]]}
              min={-180}
              max={180}
              step={1}
              disabled={!activeAvatar || !selectedRow?.available}
              onValueChange={(values) => {
                const [value] = values;
                if (typeof value === "number") {
                  handleAxisInputBlur(axis);
                  handleAxisChange(axis, value);
                }
              }}
              onPointerDown={beginUndoGroup}
              onPointerUp={endUndoGroup}
              onPointerCancel={endUndoGroup}
              onKeyDown={beginUndoGroup}
              onKeyUp={endUndoGroup}
              onBlur={endUndoGroup}
              aria-label={`${label} rotation`}
            />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={handleResetSelectedBone}
          disabled={!selectedDraft}
          className="h-8"
        >
          <RotateCcwIcon className="size-3.5" />
          Inherit
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={handleSetSelectedBoneNeutral}
          disabled={!canSetNeutralOverride}
          className="h-8"
        >
          <MinusIcon className="size-3.5" />
          Neutral/rest
        </Button>
      </div>
    </PoseCreatorPanelSection>
  );
}
