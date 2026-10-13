"use client";

import { useProductApiClient } from "@animama/product-ui";
import { useFormatters } from "@animama/product-ui/i18n";

import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { Play, Plus, X } from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  previewGesture,
  previewIdleStyle,
} from "@animama/runtime-contracts/sdk";
import type { PyGesture, PyIdleStyle } from "@/lib/content/catalogTypes";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
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
import { emotionLabel } from "@/lib/emotion/presentation";
import { failureLine } from "@/lib/errors/apiError";
import { useGestures } from "@/query/hooks/useActions";
import { useIdleStyle } from "@/query/hooks/useIdleStyles";
import { useIdleGesturePlayback } from "@/query/hooks/useIdleGesturePlayback";
import { queryKeys } from "@/query/keys";
import { useContentPreviewDock } from "@/ui/content-preview/ContentPreviewDockProvider";
import { ContentHealth } from "@/ui/content-health/ContentHealth";
import { Button } from "@/ui/components/button";
import { cn } from "@/lib/utils";

const fieldClass = "bg-background rounded-md border px-3 py-2";
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

/** What one emotion and intensity cell does, as shown in the grid. */
function cellStateText(
  t: TFunction<"actionEditor">,
  cell: IdleStyleCell | undefined,
): string {
  if (cell?.mode === "none") return t("idleStyle.cells.noIdle");
  if (cell?.mode === "pool")
    return t("idleStyle.cells.gestures", { count: cell.gestures.length });
  return t("idleStyle.cells.useDefault");
}

/** A preview failure as one line; English without wording follows the uncoded-error rule. */
function previewFailure(t: TFunction<"actionEditor">, cause: unknown): string {
  return failureLine(cause, t("idleStyle.previewFailed"));
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
  const { t } = useTranslation("actionEditor");
  const existingQuery = useIdleStyle(itemId ?? null);
  if (itemId && existingQuery.isPending)
    return (
      <p className="p-6" role="status">
        {t("idleStyle.loading")}
      </p>
    );
  if (itemId && (existingQuery.isError || !existingQuery.data))
    return (
      <div className="space-y-3 p-6">
        <p role="alert">{t("idleStyle.loadFailed")}</p>
        <Button onClick={() => void existingQuery.refetch()}>
          {t("idleStyle.retry")}
        </Button>
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
  const { t } = useTranslation("actionEditor");
  const apiClient = useProductApiClient();

  const userId = useRuntimeCacheKey();
  const documentKey = `${existing?.item_id ?? "new"}${duplicate ? ":copy" : ""}`;
  const recovery = useMemo(
    () =>
      userId
        ? loadContentEditRecovery(userId, "idle-style", documentKey)
        : null,
    [userId, documentKey],
  );
  const isCopy = duplicate || existing?.catalog_source === "included";
  // The "-copy" suffix becomes part of a saved name, so it stays English.
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
    ? t("idleStyle.cells.selected", {
        emotion: emotionLabel(selectedCell.emotion),
        intensity: selectedCell.intensity,
      })
    : t("idleStyle.cells.default");
  let validationError: string | null = null;
  try {
    idleStyleSpec(document);
  } catch (cause) {
    // `idleStyleSpec` words its failures in the UI Locale.
    validationError =
      cause instanceof Error ? cause.message : t("idleStyle.checkPools");
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
      toast.error(t("idleStyle.gestureUnavailable"));
      return;
    }
    try {
      setPreviewBusy(true);
      const response = await previewGesture({
        client: apiClient,
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
      toast.error(previewFailure(t, cause));
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
        client: apiClient,
        path: { item_id: existing.item_id },
        responseValidator: undefined,
        throwOnError: true,
      });
      const preview = typedIdleStylePreview(response.data, ref);
      openPreview(idleStylePreviewTarget(preview, existing.name));
      setLastPreview(preview.selected_gesture_name);
    } catch (cause) {
      toast.error(previewFailure(t, cause));
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
      const item = await saveCatalogItem(apiClient, {
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
      toast.success(isCopy ? t("idleStyle.savedCopy") : t("idleStyle.saved"));
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
        to: "/idle-styles/$idleStyleId/edit",
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
          <p className="text-muted-foreground text-sm">
            {t("idleStyle.studio")}
          </p>
          <h1 className="text-3xl font-semibold">
            {isCopy
              ? t("idleStyle.title.copy")
              : existing
                ? t("idleStyle.title.edit")
                : t("idleStyle.title.new")}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <ContentHealth />
          <Link to="/create" className="underline">
            {t("idleStyle.createHub")}
          </Link>
        </div>
      </div>
      <p className="text-muted-foreground text-sm">{t("idleStyle.intro")}</p>
      {existing ? (
        <p className="rounded-lg border p-3 text-sm">
          {isCopy ? t("idleStyle.copyNotice") : t("idleStyle.sharedNotice")}
        </p>
      ) : null}
      <fieldset
        disabled={busy}
        className="grid gap-4 rounded-xl border p-5 md:grid-cols-2"
      >
        <label className="grid gap-2 text-sm font-medium">
          {t("idleStyle.name")}
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
          {t("idleStyle.description")}
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
          aria-label={t("idleStyle.cells.label")}
        >
          <Button
            variant={selectedCell ? "outline" : "secondary"}
            className="w-full justify-between"
            disabled={busy}
            onClick={() => setSelectedCell(null)}
            aria-pressed={!selectedCell}
          >
            <span>{t("idleStyle.cells.defaultNeutral")}</span>
            <span>
              {t("idleStyle.cells.gestures", {
                count: document.defaultPool.length,
              })}
            </span>
          </Button>
          <p className="text-muted-foreground text-xs">
            {t("idleStyle.cells.defaultHint")}
          </p>
          <div className="max-h-[34rem] overflow-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">
                {t("idleStyle.cells.caption")}
              </caption>
              <thead className="bg-background sticky top-0">
                <tr>
                  <th scope="col" className="py-2">
                    {t("idleStyle.cells.emotion")}
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
                            aria-label={t("idleStyle.cells.cellLabel", {
                              emotion: emotionLabel(emotion),
                              intensity,
                              state: cellStateText(t, cell),
                            })}
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
                              ? t("idleStyle.cells.noIdle")
                              : cell?.mode === "pool"
                                ? t("idleStyle.cells.gestures", {
                                    count: cell.gestures.length,
                                  })
                                : t("idleStyle.cells.default")}
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
          aria-label={t("idleStyle.pool.label", { cell: selectedLabel })}
        >
          <h2 className="text-lg font-semibold">{selectedLabel}</h2>
          {selectedCell ? (
            <label className="grid gap-2 text-sm">
              {t("idleStyle.pool.behavior")}
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
                <option value="inherit">
                  {t("idleStyle.cells.useDefault")}
                </option>
                <option value="pool">{t("idleStyle.pool.choose")}</option>
                <option value="none">{t("idleStyle.cells.noIdle")}</option>
              </select>
            </label>
          ) : null}
          {selected?.mode === "none" ? (
            <p className="text-muted-foreground text-sm">
              {t("idleStyle.pool.none")}
            </p>
          ) : (
            <>
              {selectedCell && !selected ? (
                <p className="text-muted-foreground text-sm">
                  {t("idleStyle.pool.inherits")}
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
                  <Play /> {t("idleStyle.pool.previewSaved")}
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
          {busy
            ? t("idleStyle.saving")
            : isCopy
              ? t("idleStyle.saveCopy")
              : t("idleStyle.save")}
        </Button>
        {lastPreview ? (
          <p className="text-muted-foreground text-sm">
            {t("idleStyle.previewing", { name: lastPreview })}
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
  const { t } = useTranslation("actionEditor");
  const formatters = useFormatters();
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
                aria-label={t("idleStyle.pool.previewMember", {
                  name: gesture?.name ?? ref,
                })}
                onClick={() => onPreview(ref)}
              >
                <Play />
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                disabled={disabled}
                aria-label={t("idleStyle.pool.removeMember", {
                  name: gesture?.name ?? ref,
                })}
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
            {t("idleStyle.pool.empty")}
          </li>
        ) : null}
      </ul>
      {loading ? (
        <p role="status" className="text-muted-foreground text-sm">
          {t("idleStyle.gestures.loading")}
        </p>
      ) : loadError ? (
        <div>
          <p role="alert">{t("idleStyle.gestures.loadFailed")}</p>
          <Button variant="outline" onClick={onRetry}>
            {t("idleStyle.retry")}
          </Button>
        </div>
      ) : null}
      {!disabled ? (
        <fieldset disabled={loading || loadError} className="space-y-3">
          <label className="grid gap-1 text-sm">
            {t("idleStyle.add.search")}
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
            {t("idleStyle.add.label")}
            <select
              className={fieldClass}
              value={candidateId}
              onChange={(event) => setCandidateId(event.target.value)}
            >
              <option value="">{t("idleStyle.add.choose")}</option>
              {choices.map((gesture) => (
                <option value={gesture.item_id} key={gesture.item_id}>
                  {gesture.implementation_kind === "vrma"
                    ? t("idleStyle.add.optionVrma", { name: gesture.name })
                    : t("idleStyle.add.optionClip", { name: gesture.name })}
                </option>
              ))}
            </select>
          </label>
          {candidate ? (
            <div className="text-sm" aria-live="polite">
              {playback.isPending ? (
                t("idleStyle.playback.checking")
              ) : playback.isError ? (
                <>
                  <p role="alert">{t("idleStyle.playback.checkFailed")}</p>
                  <Button
                    variant="outline"
                    onClick={() => void playback.refetch()}
                  >
                    {t("idleStyle.playback.retryCheck")}
                  </Button>
                </>
              ) : playback.data?.eligible ? (
                <p className="text-muted-foreground">
                  {playback.data.duration_seconds
                    ? t("idleStyle.playback.finiteFor", {
                        seconds: formatters.number(
                          playback.data.duration_seconds,
                          {
                            minimumFractionDigits: 1,
                            maximumFractionDigits: 1,
                          },
                        ),
                      })
                    : t("idleStyle.playback.finite")}
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
            <Plus /> {t("idleStyle.add.submit")}
          </Button>
        </fieldset>
      ) : null}
    </div>
  );
}
