"use client";

import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { Play, Plus, X } from "lucide-react";
import { toast } from "sonner";

import {
  previewGesture,
  previewIdleStyle,
} from "@animama/runtime-contracts/sdk";
import type { PyGesture, PyIdleStyle } from "@/lib/content/catalogTypes";
import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
import { useContentSaveFailure } from "@/hooks/useContentSaveFailure";
import {
  localContentLogicalKey,
  saveCatalogItem,
} from "@/lib/content/catalogApi";
import { typedIdleStylePreview } from "@/lib/content/typedPreviewAdapters";
import {
  IDLE_INTENSITIES,
  idleStyleSpec,
  idleGestureIneligibilityMessage,
  readIdleStyleDocument,
  type IdleIntensity,
  type IdleStyleCell,
  type IdleStyleDocument,
} from "@/lib/content/idleStyleDocument";
import {
  clearContentEditRecovery,
  CONTENT_EDIT_RECOVERY_SCHEMA,
  loadContentEditRecovery,
  saveContentEditRecovery,
} from "@/lib/content/contentEditRecovery";
import { idleStylePreviewTarget } from "@/lib/content-preview/idleStylePreviewTarget";
import { TRACKED_EMOTIONS, type TrackedEmotion } from "@/lib/emotion";
import { useGestures } from "@/query/hooks/useActions";
import { useIdleStyle } from "@/query/hooks/useIdleStyles";
import { useIdleGesturePlayback } from "@/query/hooks/useIdleGesturePlayback";
import { queryKeys } from "@/query/keys";
import { useContentPreviewDock } from "@/ui/content-preview/ContentPreviewDockProvider";
import { ContentHealth } from "@/ui/content-health/ContentHealth";
import { Button } from "@/ui/components/button";
import { cn } from "@/lib/utils";

const fieldClass = "bg-background rounded-md border px-3 py-2";
const emotionLabel = (emotion: string) =>
  emotion[0]!.toUpperCase() + emotion.slice(1);
type SelectedCell = {
  emotion: TrackedEmotion;
  intensity: IdleIntensity;
} | null;

function readDependencyItemIds(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

/** Authored locator refs keep their admitted identity throughout this edit. */
function poolGesture(
  ref: string,
  gestures: PyGesture[],
  dependencyItemIds: Record<string, string>,
): PyGesture | undefined {
  const itemId = dependencyItemIds[ref];
  return gestures.find((gesture) =>
    itemId ? gesture.item_id === itemId : gesture.logical_key === ref,
  );
}

/** Wait for the source before creating the draft, so slow queries cannot erase edits. */
export function IdleStyleEditorPage({
  itemId,
  duplicate = false,
}: {
  itemId?: string;
  duplicate?: boolean;
}) {
  const existingQuery = useIdleStyle(itemId ?? null);
  if (itemId && existingQuery.isPending)
    return (
      <p className="p-6" role="status">
        Loading Idle Style…
      </p>
    );
  if (itemId && (existingQuery.isError || !existingQuery.data))
    return (
      <div className="space-y-3 p-6">
        <p role="alert">
          The Idle Style could not be loaded. Your existing content is
          unchanged.
        </p>
        <Button onClick={() => void existingQuery.refetch()}>Retry</Button>
      </div>
    );
  return (
    <IdleStyleEditor
      key={`${itemId ?? "new"}:${duplicate}`}
      existing={existingQuery.data}
      duplicate={duplicate}
    />
  );
}

/** A Style owns the pools; Gesture editing remains the normal Action workflow. */
function IdleStyleEditor({
  existing,
  duplicate,
}: {
  existing?: PyIdleStyle;
  duplicate: boolean;
}) {
  const userId = useRuntimeOwnerId();
  const documentKey = `${existing?.item_id ?? "new"}${duplicate ? ":copy" : ""}`;
  const recovery = useMemo(
    () =>
      userId
        ? loadContentEditRecovery(userId, "idle-style", documentKey)
        : null,
    [userId, documentKey],
  );
  const isCopy = duplicate || existing?.catalog_source === "included";
  const [name, setName] = useState(() =>
    String(
      recovery?.form.name ??
        (existing ? `${existing.name}${isCopy ? "-copy" : ""}` : ""),
    ),
  );
  const [description, setDescription] = useState(() =>
    String(recovery?.form.description ?? existing?.description ?? ""),
  );
  const [document, setDocument] = useState<IdleStyleDocument>(
    () =>
      readIdleStyleDocument(recovery?.form.document) ??
      readIdleStyleDocument({
        defaultPool: existing?.default_pool ?? [],
        cells: existing?.cells ?? {},
      }) ?? { defaultPool: [], cells: {} },
  );
  const [baseline, setBaseline] = useState(() => {
    const saved = recovery?.form.baseline;
    if (
      saved &&
      typeof saved === "object" &&
      "catalogItemId" in saved &&
      "revision" in saved &&
      "logicalKey" in saved &&
      typeof saved.catalogItemId === "string" &&
      typeof saved.revision === "string" &&
      typeof saved.logicalKey === "string"
    ) {
      return {
        catalogItemId: saved.catalogItemId,
        revision: saved.revision,
        logicalKey: saved.logicalKey,
        dependencyItemIds: readDependencyItemIds(
          "dependencyItemIds" in saved ? saved.dependencyItemIds : undefined,
        ),
      };
    }
    return {
      catalogItemId: existing?.item_id,
      revision: existing?.revision_sha256,
      logicalKey: existing?.logical_key,
      dependencyItemIds: Object.fromEntries(
        (existing?.dependencies ?? []).flatMap((dependency) =>
          dependency.item_id ? [[dependency.ref, dependency.item_id]] : [],
        ),
      ),
    };
  });
  const initialState = useRef(JSON.stringify({ name, description, document }));
  const operation = useRef({
    id: recovery?.operationId ?? crypto.randomUUID(),
    request:
      typeof recovery?.form.request === "string" ? recovery.form.request : "",
  });
  const [selectedCell, setSelectedCell] = useState<SelectedCell>(null);
  const [recoveredSavePending, setRecoveredSavePending] = useState(
    Boolean(recovery),
  );
  const [busy, setBusy] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [lastPreview, setLastPreview] = useState<string | null>(null);
  const gesturesQuery = useGestures({ sort: "name" });
  const gestures =
    gesturesQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const { openPreview } = useContentPreviewDock();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { capture, clear, clearField, error, errorField } =
    useContentSaveFailure();
  const selected = selectedCell
    ? document.cells[selectedCell.emotion]?.[selectedCell.intensity]
    : undefined;
  const pool = selectedCell
    ? selected?.mode === "pool"
      ? selected.gestures
      : selected?.mode === "none"
        ? []
        : document.defaultPool
    : document.defaultPool;
  const selectedLabel = selectedCell
    ? `${emotionLabel(selectedCell.emotion)} · intensity ${selectedCell.intensity}`
    : "Default";
  let validationError: string | null = null;
  try {
    idleStyleSpec(document);
  } catch (cause) {
    validationError =
      cause instanceof Error ? cause.message : "Check your Gesture pools.";
  }
  const changed =
    recoveredSavePending ||
    !existing ||
    isCopy ||
    initialState.current !== JSON.stringify({ name, description, document });

  const updateCell = (cell: IdleStyleCell | undefined) => {
    if (!selectedCell) return;
    const { emotion, intensity } = selectedCell;
    setDocument((current) => {
      const levels = { ...current.cells[emotion] };
      if (cell) levels[intensity] = cell;
      else delete levels[intensity];
      const cells = { ...current.cells };
      if (Object.keys(levels).length) cells[emotion] = levels;
      else delete cells[emotion];
      return { ...current, cells };
    });
  };
  const updatePool = (gestures: string[]) => {
    if (selectedCell) updateCell({ mode: "pool", gestures });
    else setDocument((current) => ({ ...current, defaultPool: gestures }));
  };
  const previewMember = async (ref: string) => {
    const gesture = poolGesture(ref, gestures, baseline.dependencyItemIds);
    if (!gesture) {
      toast.error(
        "This Gesture is unavailable. Refresh the Library and check the Style.",
      );
      return;
    }
    try {
      setPreviewBusy(true);
      const response = await previewGesture({
        path: { item_id: gesture.item_id },
        responseValidator: undefined,
        throwOnError: true,
      });
      openPreview(
        idleStylePreviewTarget(
          typedIdleStylePreview(response.data),
          gesture.name,
        ),
      );
      setLastPreview(gesture.name);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Preview failed.");
    } finally {
      setPreviewBusy(false);
    }
  };
  const previewSavedPool = async () => {
    const ref = pool[0];
    if (!existing || !ref) return;
    try {
      setPreviewBusy(true);
      const response = await previewIdleStyle({
        path: { item_id: existing.item_id },
        responseValidator: undefined,
        throwOnError: true,
      });
      const preview = typedIdleStylePreview(response.data, ref);
      openPreview(idleStylePreviewTarget(preview, existing.name));
      setLastPreview(preview.selected_gesture_name);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Preview failed.");
    } finally {
      setPreviewBusy(false);
    }
  };
  const save = async () => {
    if (busy || !name.trim() || validationError) return;
    const descriptor = {
      ...idleStyleSpec(document),
      content_type: "idle_style",
      name: name.trim(),
      content_id:
        !isCopy && baseline.logicalKey
          ? baseline.logicalKey
          : localContentLogicalKey("idle_style", name),
      description: description.trim() || undefined,
      compatibility: existing?.compatibility ?? {
        vrm_versions: ["0.x", "1.0"],
      },
    };
    const catalogItemId = isCopy ? undefined : baseline.catalogItemId;
    const expectedRevision = isCopy ? undefined : baseline.revision;
    const request = JSON.stringify({
      descriptor,
      catalogItemId,
      expectedRevision,
    });
    if (operation.current.request && operation.current.request !== request)
      operation.current.id = crypto.randomUUID();
    operation.current.request = request;
    if (userId)
      saveContentEditRecovery({
        schema: CONTENT_EDIT_RECOVERY_SCHEMA,
        userId,
        family: "idle-style",
        documentKey,
        operationId: operation.current.id,
        form: { name, description, document, request, baseline },
        updatedAt: new Date().toISOString(),
      });
    try {
      setBusy(true);
      clear();
      const item = await saveCatalogItem({
        kind: "idle_style",
        entryName: name.trim(),
        files: [],
        descriptor,
        operationId: operation.current.id,
        catalogItemId,
        expectedRevision,
      });
      if (userId) {
        clearContentEditRecovery(userId, "idle-style", documentKey);
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: queryKeys.idleStyles.all(userId),
          }),
          queryClient.invalidateQueries({
            queryKey: queryKeys.content.catalog(userId),
          }),
        ]);
      }
      toast.success(
        isCopy
          ? "Local Idle Style copy saved. Select it in your Anima’s loadout to use it."
          : "Idle Style saved.",
      );
      initialState.current = JSON.stringify({ name, description, document });
      setRecoveredSavePending(false);
      setBaseline({
        ...baseline,
        catalogItemId: item.item_id,
        revision: item.revision_sha256 ?? undefined,
        logicalKey: item.logical_key ?? undefined,
      });
      operation.current = { id: crypto.randomUUID(), request: "" };
      await navigate({
        to: "/a/idle-styles/$idleStyleId/edit",
        params: { idleStyleId: item.item_id },
        search: { duplicate: false },
        replace: true,
      });
    } catch (cause) {
      toast.error(capture(cause).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-muted-foreground text-sm">Creator Studio</p>
          <h1 className="text-3xl font-semibold">
            {isCopy
              ? "Copy Idle Style"
              : existing
                ? "Edit Idle Style"
                : "New Idle Style"}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <ContentHealth />
          <Link to="/a/create" className="underline">
            Create hub
          </Link>
        </div>
      </div>
      <p className="text-muted-foreground text-sm">
        Choose existing Gestures for quiet moments. Their animations, sounds and
        effects stay intact. Adding them here does not equip them for AI
        invocation.
      </p>
      {existing ? (
        <p className="rounded-lg border p-3 text-sm">
          {isCopy
            ? "Saving creates an independent Local Style. The original Style stays unchanged."
            : "Editing this shared Style affects every Anima using it on its next runtime refresh. Duplicate it in Loadout for a separate variation."}
        </p>
      ) : null}
      <fieldset
        disabled={busy}
        className="grid gap-4 rounded-xl border p-5 md:grid-cols-2"
      >
        <label className="grid gap-2 text-sm font-medium">
          Name
          <input
            className={cn(
              fieldClass,
              errorField === "name" && "border-destructive",
            )}
            value={name}
            aria-invalid={errorField === "name"}
            onChange={(event) => {
              clearField("name");
              setName(event.target.value);
            }}
          />
        </label>
        <label className="grid gap-2 text-sm font-medium">
          Description
          <textarea
            className={fieldClass}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
      </fieldset>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,1fr)]">
        <section
          className="space-y-3 rounded-xl border p-4"
          aria-label="Idle Style cells"
        >
          <Button
            variant={selectedCell ? "outline" : "secondary"}
            className="w-full justify-between"
            disabled={busy}
            onClick={() => setSelectedCell(null)}
            aria-pressed={!selectedCell}
          >
            <span>Default · neutral</span>
            <span>
              {document.defaultPool.length}{" "}
              {document.defaultPool.length === 1 ? "Gesture" : "Gestures"}
            </span>
          </Button>
          <p className="text-muted-foreground text-xs">
            Unconfigured cells use Default. An empty Default schedules no idle
            Gestures; procedural breathing and resting continue.
          </p>
          <div className="max-h-[34rem] overflow-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Emotion pools by intensity</caption>
              <thead className="bg-background sticky top-0">
                <tr>
                  <th scope="col" className="py-2">
                    Emotion
                  </th>
                  {IDLE_INTENSITIES.map((intensity) => (
                    <th
                      scope="col"
                      className="px-1 text-center"
                      key={intensity}
                    >
                      {intensity}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...TRACKED_EMOTIONS].sort().map((emotion) => (
                  <tr key={emotion}>
                    <th scope="row" className="pr-2 font-normal">
                      {emotionLabel(emotion)}
                    </th>
                    {IDLE_INTENSITIES.map((intensity) => {
                      const cell = document.cells[emotion]?.[intensity];
                      const active =
                        selectedCell?.emotion === emotion &&
                        selectedCell.intensity === intensity;
                      return (
                        <td key={intensity} className="p-1">
                          <button
                            type="button"
                            disabled={busy}
                            aria-pressed={active}
                            aria-label={`${emotionLabel(emotion)} intensity ${intensity}: ${cell?.mode === "none" ? "No idle" : cell?.mode === "pool" ? `${cell.gestures.length} ${cell.gestures.length === 1 ? "Gesture" : "Gestures"}` : "Use Default"}`}
                            className={cn(
                              "focus-visible:ring-ring w-full rounded-md border px-2 py-2 text-xs focus-visible:ring-2",
                              active
                                ? "bg-primary text-primary-foreground"
                                : "hover:bg-muted",
                            )}
                            onClick={() =>
                              setSelectedCell({ emotion, intensity })
                            }
                          >
                            {cell?.mode === "none"
                              ? "No idle"
                              : cell?.mode === "pool"
                                ? `${cell.gestures.length} ${cell.gestures.length === 1 ? "Gesture" : "Gestures"}`
                                : "Default"}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section
          className="space-y-4 rounded-xl border p-4"
          aria-label={`${selectedLabel} pool`}
        >
          <h2 className="text-lg font-semibold">{selectedLabel}</h2>
          {selectedCell ? (
            <label className="grid gap-2 text-sm">
              Behavior
              <select
                className={fieldClass}
                value={selected?.mode ?? "inherit"}
                disabled={busy}
                onChange={(event) =>
                  updateCell(
                    event.target.value === "inherit"
                      ? undefined
                      : event.target.value === "none"
                        ? { mode: "none" }
                        : { mode: "pool", gestures: [...pool] },
                  )
                }
              >
                <option value="inherit">Use Default</option>
                <option value="pool">Choose Gestures</option>
                <option value="none">No idle</option>
              </select>
            </label>
          ) : null}
          {selected?.mode === "none" ? (
            <p className="text-muted-foreground text-sm">
              No scheduled idle Gesture at this emotion and intensity.
            </p>
          ) : (
            <>
              {selectedCell && !selected ? (
                <p className="text-muted-foreground text-sm">
                  This cell inherits the Default pool.
                </p>
              ) : null}
              <GesturePoolEditor
                key={
                  selectedCell
                    ? `${selectedCell.emotion}:${selectedCell.intensity}`
                    : "default"
                }
                pool={pool}
                gestures={gestures}
                dependencyItemIds={baseline.dependencyItemIds}
                loading={gesturesQuery.isPending}
                loadError={gesturesQuery.isError}
                disabled={busy || Boolean(selectedCell && !selected)}
                previewBusy={previewBusy}
                onChange={updatePool}
                onPreview={(ref) => void previewMember(ref)}
                onRetry={() => void gesturesQuery.refetch()}
              />
              {existing && !changed && pool.length ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={previewBusy || busy}
                  onClick={() => void previewSavedPool()}
                >
                  <Play /> Preview saved pool
                </Button>
              ) : null}
            </>
          )}
        </section>
      </div>
      {validationError ? (
        <p role="status" className="text-muted-foreground text-sm">
          {validationError}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={
            busy || !changed || !name.trim() || Boolean(validationError)
          }
          onClick={() => void save()}
        >
          {busy ? "Saving…" : isCopy ? "Save Local copy" : "Save Idle Style"}
        </Button>
        {lastPreview ? (
          <p className="text-muted-foreground text-sm">
            Previewing {lastPreview}
          </p>
        ) : null}
      </div>
    </main>
  );
}

/** Validate the selected Gesture before adding it, without overriding authored playback. */
function GesturePoolEditor({
  pool,
  gestures,
  dependencyItemIds,
  loading,
  loadError,
  disabled,
  previewBusy,
  onChange,
  onPreview,
  onRetry,
}: {
  pool: string[];
  gestures: PyGesture[];
  dependencyItemIds: Record<string, string>;
  loading: boolean;
  loadError: boolean;
  disabled: boolean;
  previewBusy: boolean;
  onChange: (refs: string[]) => void;
  onPreview: (ref: string) => void;
  onRetry: () => void;
}) {
  const [candidateId, setCandidateId] = useState("");
  const [search, setSearch] = useState("");
  const candidate = gestures.find((gesture) => gesture.item_id === candidateId);
  const playback = useIdleGesturePlayback(
    candidate?.item_id ?? null,
    candidate?.revision_sha256 ?? "",
  );
  const choices = gestures.filter(
    (gesture) =>
      gesture.logical_key &&
      !pool.some(
        (ref) =>
          poolGesture(ref, gestures, dependencyItemIds)?.item_id ===
          gesture.item_id,
      ) &&
      gesture.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  return (
    <div className="space-y-3">
      <ul className="divide-y rounded-lg border">
        {pool.map((ref) => {
          const gesture = poolGesture(ref, gestures, dependencyItemIds);
          return (
            <li key={ref} className="flex items-center gap-2 p-3">
              <span className="min-w-0 flex-1 text-sm break-words">
                {gesture?.name ?? ref}
              </span>
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                disabled={!gesture || previewBusy}
                aria-label={`Preview ${gesture?.name ?? ref}`}
                onClick={() => onPreview(ref)}
              >
                <Play />
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                disabled={disabled}
                aria-label={`Remove ${gesture?.name ?? ref}`}
                onClick={() =>
                  onChange(pool.filter((member) => member !== ref))
                }
              >
                <X />
              </Button>
            </li>
          );
        })}
        {!pool.length ? (
          <li className="text-muted-foreground p-3 text-sm">
            No Gestures in this pool.
          </li>
        ) : null}
      </ul>
      {loading ? (
        <p role="status" className="text-muted-foreground text-sm">
          Loading Gestures…
        </p>
      ) : loadError ? (
        <div>
          <p role="alert">Gestures could not be loaded.</p>
          <Button variant="outline" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : null}
      {!disabled ? (
        <fieldset disabled={loading || loadError} className="space-y-3">
          <label className="grid gap-1 text-sm">
            Search Gestures
            <input
              className={fieldClass}
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setCandidateId("");
              }}
            />
          </label>
          <label className="grid gap-1 text-sm">
            Add an existing Gesture
            <select
              className={fieldClass}
              value={candidateId}
              onChange={(event) => setCandidateId(event.target.value)}
            >
              <option value="">Choose a Gesture</option>
              {choices.map((gesture) => (
                <option value={gesture.item_id} key={gesture.item_id}>
                  {gesture.name} ·{" "}
                  {gesture.implementation_kind === "vrma" ? "VRMA" : "Clip"}
                </option>
              ))}
            </select>
          </label>
          {candidate ? (
            <div className="text-sm" aria-live="polite">
              {playback.isPending ? (
                "Checking finite playback…"
              ) : playback.isError ? (
                <>
                  <p role="alert">Playback could not be checked.</p>
                  <Button
                    variant="outline"
                    onClick={() => void playback.refetch()}
                  >
                    Retry check
                  </Button>
                </>
              ) : playback.data?.eligible ? (
                <p className="text-muted-foreground">
                  Finite playback
                  {playback.data.duration_seconds
                    ? ` · ${playback.data.duration_seconds.toFixed(1)} seconds`
                    : ""}
                  . Authored sounds and effects are preserved.
                </p>
              ) : (
                <p className="text-destructive">
                  {idleGestureIneligibilityMessage(playback.data?.reason)}
                </p>
              )}
            </div>
          ) : null}
          <Button
            type="button"
            variant="outline"
            disabled={
              !candidate?.logical_key ||
              !playback.data?.eligible ||
              playback.isFetching
            }
            onClick={() => {
              if (candidate?.logical_key && playback.data?.eligible) {
                onChange([...pool, candidate.logical_key]);
                setCandidateId("");
              }
            }}
          >
            <Plus /> Add to pool
          </Button>
        </fieldset>
      ) : null}
    </div>
  );
}
