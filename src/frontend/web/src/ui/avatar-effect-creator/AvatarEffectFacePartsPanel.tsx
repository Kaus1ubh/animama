import type { AvatarFacePartCorrection } from "@animama/runtime-contracts/api-types";
import {
  LoaderCircleIcon,
  MousePointerClickIcon,
  ScanEyeIcon,
} from "lucide-react";
import { useId, useMemo, useState, useSyncExternalStore } from "react";

import type { Avatar } from "@/lib/avatar";
import type { AvatarFacePartRole } from "@/lib/avatar/vfx/faceParts";
import { buildRuntimePrimitiveBindings } from "@/lib/avatar/vrmEditorInspection";
import { cn } from "@/lib/utils";
import { useAvatarFaceParts } from "@/query/hooks/useAvatarFaceParts";
import { useSaveAvatarFaceParts } from "@/query/mutations/useSaveAvatarFaceParts";
import { Button } from "@/ui/components/button";
import { Checkbox } from "@/ui/components/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/ui/components/popover";
import {
  facePartCorrection,
  facePartDraftProblem,
  facePartRows,
  toggleFacePartBinding,
  type FacePartPrimitive,
  type FacePartStatus,
} from "./facePartsPanel";
import { useFacePartDraft } from "./useFacePartDraft";

const STATUS_CLASS: Record<FacePartStatus, string> = {
  detected:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  uncertain:
    "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  corrected: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  missing: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200",
};

/**
 * The Avatar's detected face and eye parts, and where to correct them. A
 * part is corrected by ticking mesh parts in a list or by clicking the avatar
 * while picking. Save stores the correction with the Avatar, then the preview
 * rebuilds with it.
 */
export function AvatarEffectFacePartsPanel({
  avatar,
  itemId,
  modelName,
  version,
  pickingRole,
  pickedKey,
  onPickingRoleChange,
  onApplied,
}: {
  avatar: Avatar | null;
  /** The Avatar catalog item the correction is saved to. */
  itemId: string | null;
  modelName: string;
  /** Changes whenever the Avatar's part map is rebuilt. */
  version: number;
  pickingRole: AvatarFacePartRole | null;
  /** The last mesh part clicked while picking, with a unique sequence. */
  pickedKey: { key: string; sequence: number } | null;
  onPickingRoleChange: (role: AvatarFacePartRole | null) => void;
  onApplied: (correction: AvatarFacePartCorrection | null) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const {
    editing,
    setEditing,
    draft,
    setDraft,
    lastPick,
    setLastPick,
    error,
    setError,
  } = useFacePartDraft(
    avatar?.vrmSha256 ? `${itemId ?? ""}:${avatar.vrmSha256}` : null,
    pickedKey?.sequence ?? null,
  );
  const wide = useMinWidth(1024);
  const headingId = useId();
  const query = useAvatarFaceParts(itemId);
  const save = useSaveAvatarFaceParts(itemId);
  const map = avatar?.facePartMap ?? null;

  const primitives = useMemo<FacePartPrimitive[]>(() => {
    void version;
    if (!avatar?.vrm) return [];
    return buildRuntimePrimitiveBindings(avatar).entries.map((entry) => ({
      key: entry.bindingKey,
      name: `${entry.materialName ?? entry.objectName ?? "Mesh"} (${entry.bindingKey})`,
    }));
  }, [avatar, version]);

  // A pick on the avatar toggles that mesh part for the part being edited.
  if (
    pickedKey &&
    pickedKey.sequence !== lastPick &&
    editing &&
    pickingRole === editing &&
    map
  ) {
    setLastPick(pickedKey.sequence);
    setDraft(toggleFacePartBinding(map, draft, editing, pickedKey.key));
  }

  const rows = map ? facePartRows(map, primitives, draft) : [];
  const dirty = Object.keys(draft).length > 0;
  const problem = map
    ? facePartDraftProblem(
        map,
        draft,
        avatar?.vrmSha256 ?? null,
        primitives.map((primitive) => primitive.key),
      )
    : null;
  const corrected = Boolean(query.data?.face_parts);
  const busy = save.isPending;

  const stopEditing = () => {
    setEditing(null);
    onPickingRoleChange(null);
  };
  const commit = async (correction: AvatarFacePartCorrection | null) => {
    if (!query.data) return;
    setError(null);
    try {
      const state = await save.mutateAsync({
        expectedRevision: query.data.revision,
        faceParts: correction,
      });
      await onApplied(state.face_parts ?? null);
      setDraft({});
      stopEditing();
    } catch (cause) {
      // A conflict means the Avatar changed: read its current revision so a
      // retry is fenced against it.
      void query.refetch();
      setError(
        cause instanceof Error
          ? cause.message
          : "The correction could not be saved.",
      );
    }
  };

  return (
    <Popover
      open={open}
      modal={false}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) onPickingRoleChange(null);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8 gap-1.5 px-2 text-xs"
          disabled={!avatar}
          aria-label="Face parts"
        >
          <ScanEyeIcon />
          <span className="hidden sm:inline">Face parts</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        // Below the controls on narrow layouts, where the preview is above.
        side={wide ? "top" : "bottom"}
        className="flex max-h-[min(70vh,560px,var(--radix-popover-content-available-height))] w-[min(92vw,380px)] flex-col gap-3 overflow-y-auto p-3"
        aria-labelledby={headingId}
        // While picking, clicks on the avatar must not close the panel.
        onInteractOutside={(event) => {
          if (pickingRole) event.preventDefault();
        }}
      >
        <div>
          <h2 id={headingId} className="text-sm font-semibold">
            Face parts on {modelName}
          </h2>
          <p
            hidden={Boolean(pickingRole)}
            className="text-muted-foreground text-xs"
          >
            Effects find the face and eyes through these parts. If an effect is
            missing or lands on the wrong place, correct the part here. The
            correction is saved with this Avatar and used everywhere.
          </p>
        </div>
        {!map ? (
          <p className="text-muted-foreground text-xs">
            {avatar ? "This Avatar has no detected face parts." : "Loading…"}
          </p>
        ) : (
          <ul className="space-y-2" aria-label="Face parts">
            {/* While picking, only the part being edited shows, so the
                panel stays small and the avatar stays clickable. */}
            {rows
              .filter((row) => !pickingRole || row.role === pickingRole)
              .map((row) => (
                <li
                  key={row.role}
                  className={cn(
                    "border-border/70 rounded-lg border p-2",
                    editing === row.role && "border-primary",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="flex-1 text-xs font-medium">
                      {row.label}
                      {row.required ? "" : " (optional)"}
                    </span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[11px]",
                        STATUS_CLASS[row.status],
                      )}
                    >
                      {row.statusLabel}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      aria-label={`Edit ${row.label.toLowerCase()}`}
                      aria-expanded={editing === row.role}
                      onClick={() => {
                        onPickingRoleChange(null);
                        setEditing(editing === row.role ? null : row.role);
                      }}
                    >
                      {editing === row.role ? "Done" : "Edit"}
                    </Button>
                  </div>
                  <p className="text-muted-foreground mt-1 truncate text-[11px]">
                    {row.bindings.length
                      ? row.bindings.map((binding) => binding.name).join(", ")
                      : "No mesh part"}
                  </p>
                  {editing === row.role ? (
                    <div className="mt-2 space-y-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={
                          pickingRole === row.role ? "default" : "outline"
                        }
                        className="h-7 w-full text-xs"
                        aria-pressed={pickingRole === row.role}
                        onClick={() =>
                          onPickingRoleChange(
                            pickingRole === row.role ? null : row.role,
                          )
                        }
                      >
                        <MousePointerClickIcon />
                        {pickingRole === row.role
                          ? "Click the avatar to add or remove a part"
                          : "Pick on the avatar"}
                      </Button>
                      <ul
                        hidden={pickingRole === row.role}
                        className="max-h-36 space-y-1 overflow-y-auto"
                        aria-label={`Mesh parts for ${row.label.toLowerCase()}`}
                      >
                        {primitives.map((primitive) => {
                          const checked = row.bindings.some(
                            (binding) => binding.key === primitive.key,
                          );
                          const id = `${headingId}-${row.role}-${primitive.key}`;
                          return (
                            <li
                              key={primitive.key}
                              className="flex items-center gap-2"
                            >
                              <Checkbox
                                id={id}
                                checked={checked}
                                onCheckedChange={() =>
                                  setDraft(
                                    toggleFacePartBinding(
                                      map,
                                      draft,
                                      row.role,
                                      primitive.key,
                                    ),
                                  )
                                }
                              />
                              <label htmlFor={id} className="truncate text-xs">
                                {primitive.name}
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : null}
                </li>
              ))}
          </ul>
        )}
        {problem && dirty ? (
          <p className="text-destructive text-xs" role="alert">
            {problem}
          </p>
        ) : null}
        {error ? (
          <p className="text-destructive text-xs" role="alert">
            {error}
          </p>
        ) : null}
        {query.isError ? (
          <p className="text-destructive text-xs" role="alert">
            The saved correction for this Avatar could not be read.
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {busy ? (
            <LoaderCircleIcon
              className="text-muted-foreground size-4 animate-spin"
              aria-label="Saving"
            />
          ) : null}
          {corrected && !dirty ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy || !query.data}
              onClick={() => void commit(null)}
            >
              Use detected parts
            </Button>
          ) : null}
          {dirty ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setDraft({});
                  stopEditing();
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={busy || Boolean(problem) || !query.data || !map}
                onClick={() => {
                  if (!map || !avatar?.vrmSha256) return;
                  void commit(
                    facePartCorrection({
                      map,
                      draft,
                      vrmSha256: avatar.vrmSha256,
                      previous: query.data?.face_parts ?? null,
                    }),
                  );
                }}
              >
                Save correction
              </Button>
            </>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Whether the viewport is at least `px` wide (the creator's desktop layout). */
function useMinWidth(px: number): boolean {
  const query = `(min-width: ${px}px)`;
  return useSyncExternalStore(
    (listener) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", listener);
      return () => media.removeEventListener("change", listener);
    },
    () => window.matchMedia(query).matches,
    () => true,
  );
}
