"use client";

import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import type { PyIdleStylePreview } from "@/lib/content/catalogTypes";
import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
import { useContentSaveFailure } from "@/hooks/useContentSaveFailure";
import {
  localContentLogicalKey,
  previewCatalogItem,
  saveCatalogItem,
} from "@/lib/content/catalogApi";
import {
  idleAnimationId,
  idleStyleSpec,
  type IdleStyleAnimationDraft,
} from "@/lib/content/idleStyleDocument";
import {
  clearContentEditRecovery,
  CONTENT_EDIT_RECOVERY_SCHEMA,
  loadContentEditRecovery,
  saveContentEditRecovery,
} from "@/lib/content/contentEditRecovery";
import { idleStylePreviewTarget } from "@/lib/content-preview/idleStylePreviewTarget";
import { TRACKED_EMOTIONS } from "@/lib/emotion";
import { useIdleStyle } from "@/query/hooks/useIdleStyles";
import { useContentPreviewDock } from "@/ui/content-preview/ContentPreviewDockProvider";
import { ContentHealth } from "@/ui/content-health/ContentHealth";
import { cn } from "@/lib/utils";

/** Direct multi-VRMA Idle Style authoring in the editable Content Catalog. */
export function IdleStyleEditorPage({ itemId }: { itemId?: string }) {
  const existing = useIdleStyle(itemId ?? null).data;
  const userId = useRuntimeOwnerId();
  const documentKey = itemId ?? "new";
  const recovery = useMemo(
    () =>
      userId
        ? loadContentEditRecovery(userId, "idle-style", documentKey)
        : null,
    [documentKey, userId],
  );
  const operationRef = useRef(recovery?.operationId ?? crypto.randomUUID());
  const nameInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { openPreview } = useContentPreviewDock();
  const [name, setName] = useState(() => String(recovery?.form.name ?? ""));
  const [description, setDescription] = useState(() =>
    String(recovery?.form.description ?? ""),
  );
  const [animations, setAnimations] = useState<IdleStyleAnimationDraft[]>([]);
  const [defaultIds, setDefaultIds] = useState<string[]>([]);
  const [emotionsById, setEmotionsById] = useState<Record<string, string[]>>(
    {},
  );
  const [preview, setPreview] = useState<PyIdleStylePreview | null>(null);
  const [savedItemId, setSavedItemId] = useState<string | null>(null);
  const [previewEmotion, setPreviewEmotion] = useState("anger");
  const [busy, setBusy] = useState(false);
  const {
    capture: captureSaveFailure,
    clear: clearSaveFailure,
    clearField: clearSaveErrorField,
    error,
    errorField,
  } = useContentSaveFailure();
  const resolvedName = name || existing?.name || "";
  const resolvedDescription = description || existing?.description || "";

  const chooseFiles = (files: File[]) => {
    clearSaveErrorField("files");
    const identifiers = new Set<string>();
    const rows = files.map((file, index) => {
      const base = idleAnimationId(file, index);
      let animationId = base;
      let suffix = 2;
      while (identifiers.has(animationId)) {
        animationId = `${base}_${suffix}`;
        suffix += 1;
      }
      identifiers.add(animationId);
      return {
        animationId,
        name: file.name.replace(/\.vrma$/i, "").replaceAll("_", " "),
        file,
      };
    });
    setAnimations(rows);
    setDefaultIds(rows[0] ? [rows[0].animationId] : []);
    setEmotionsById({});
  };

  useEffect(() => {
    if (errorField === "name") nameInputRef.current?.focus();
    if (errorField === "files") fileInputRef.current?.focus();
  }, [errorField]);

  const save = async () => {
    const operationId = operationRef.current;
    if (userId) {
      saveContentEditRecovery({
        schema: CONTENT_EDIT_RECOVERY_SCHEMA,
        userId,
        family: "idle-style",
        documentKey,
        operationId,
        form: { name: resolvedName, description: resolvedDescription },
        updatedAt: new Date().toISOString(),
      });
    }
    try {
      setBusy(true);
      clearSaveFailure();
      const emotionPools = Object.fromEntries(
        TRACKED_EMOTIONS.flatMap((emotion) => {
          const ids = animations
            .filter((row) => emotionsById[row.animationId]?.includes(emotion))
            .map((row) => row.animationId);
          return ids.length ? [[emotion, ids]] : [];
        }),
      );
      const baseSpec = idleStyleSpec({
        animations,
        defaultPool: defaultIds,
        emotionPools,
        crossFadeSeconds: 0.35,
      });
      const companionPaths = animations.map(
        ({ animationId }) => `${animationId}.vrma`,
      );
      const spec = {
        ...baseSpec,
        animations: baseSpec.animations.map((animation, index) => ({
          ...animation,
          file: companionPaths[index],
          // Runtime ordinals address playable files; the descriptor itself is
          // intentionally excluded from that sequence.
          ordinal: index + 1,
        })),
      };
      const item = await saveCatalogItem({
        kind: "idle_style",
        entryName: resolvedName.trim(),
        files: animations.map(({ file }) => file),
        companionPaths,
        descriptor: {
          schema_version: 1,
          id:
            existing?.logical_key ??
            localContentLogicalKey("idle_style", resolvedName),
          content_type: "idle_style",
          name: resolvedName.trim(),
          description: resolvedDescription.trim() || undefined,
          files: companionPaths.map((path) => ({ path, role: "animation" })),
          ...spec,
        },
        operationId,
        catalogItemId: existing?.item_id,
        expectedRevision: existing?.revision_sha256,
      });
      setSavedItemId(item.item_id);
      const result = await resolveIdleStylePreview(
        item.item_id,
        previewEmotion,
      );
      setPreview(result);
      openPreview(
        idleStylePreviewTarget(result, resolvedName.trim() || "Idle Style"),
      );
      toast.success("Idle Style saved.");
      if (userId) clearContentEditRecovery(userId, "idle-style", documentKey);
      await navigate({
        to: "/a/idle-styles/$idleStyleId/edit",
        params: { idleStyleId: item.item_id },
        replace: true,
      });
    } catch (error) {
      const normalized = captureSaveFailure(error);
      toast.error(normalized.message);
    } finally {
      setBusy(false);
    }
  };

  const previewSelectedEmotion = async () => {
    const targetItemId = savedItemId ?? existing?.item_id;
    if (!targetItemId) return;
    try {
      const result = await resolveIdleStylePreview(
        targetItemId,
        previewEmotion,
      );
      setPreview(result);
      openPreview(
        idleStylePreviewTarget(result, resolvedName.trim() || "Idle Style"),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Preview failed.");
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-muted-foreground text-sm">Creator Studio</p>
          <h1 className="text-3xl font-semibold">
            {itemId ? "Edit Idle Style" : "New Idle Style"}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <ContentHealth />
          <Link to="/a/create" className="underline">
            Create hub
          </Link>
        </div>
      </div>
      <section className="bg-card grid gap-4 rounded-xl border p-5">
        <label
          className={cn(
            "grid gap-2 rounded-lg text-sm font-medium",
            errorField === "name" &&
              "bg-destructive/5 text-destructive ring-destructive/40 p-2 ring-1",
          )}
        >
          Name
          <input
            ref={nameInputRef}
            className={cn(
              "bg-background rounded-md border px-3 py-2",
              errorField === "name" && "border-destructive",
            )}
            value={resolvedName}
            aria-invalid={errorField === "name"}
            onChange={(event) => {
              clearSaveErrorField("name");
              setName(event.target.value);
            }}
          />
        </label>
        <label className="grid gap-2 text-sm font-medium">
          Description
          <textarea
            className="bg-background min-h-20 rounded-md border px-3 py-2"
            value={resolvedDescription}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label
          className={cn(
            "grid gap-2 rounded-lg text-sm font-medium",
            errorField === "files" &&
              "bg-destructive/5 text-destructive ring-destructive/40 p-2 ring-1",
          )}
        >
          VRMA animations
          <input
            ref={fileInputRef}
            type="file"
            accept=".vrma,model/gltf-binary"
            multiple
            aria-invalid={errorField === "files"}
            onChange={(event) =>
              chooseFiles(Array.from(event.target.files ?? []))
            }
          />
        </label>
        {animations.map((animation, index) => (
          <div
            key={animation.animationId}
            className="grid gap-3 rounded-lg border p-3 md:grid-cols-[1fr_auto_1fr]"
          >
            <label className="grid gap-1 text-sm">
              Animation name
              <input
                className="bg-background rounded-md border px-2 py-1"
                value={animation.name}
                onChange={(event) =>
                  setAnimations((rows) =>
                    rows.map((row, rowIndex) =>
                      rowIndex === index
                        ? { ...row, name: event.target.value }
                        : row,
                    ),
                  )
                }
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={defaultIds.includes(animation.animationId)}
                onChange={(event) =>
                  setDefaultIds((ids) =>
                    event.target.checked
                      ? [...ids, animation.animationId]
                      : ids.filter((id) => id !== animation.animationId),
                  )
                }
              />
              Default
            </label>
            <label className="grid gap-1 text-sm">
              Emotion pools
              <select
                multiple
                className="bg-background min-h-24 rounded-md border px-2 py-1"
                value={emotionsById[animation.animationId] ?? []}
                onChange={(event) =>
                  setEmotionsById((value) => ({
                    ...value,
                    [animation.animationId]: Array.from(
                      event.target.selectedOptions,
                      (option) => option.value,
                    ),
                  }))
                }
              >
                {TRACKED_EMOTIONS.map((emotion) => (
                  <option key={emotion} value={emotion}>
                    {emotion}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ))}
        <label className="grid max-w-xs gap-1 text-sm">
          Preview emotion
          <select
            className="bg-background rounded-md border px-3 py-2"
            value={previewEmotion}
            onChange={(event) => setPreviewEmotion(event.target.value)}
          >
            {TRACKED_EMOTIONS.map((emotion) => (
              <option key={emotion} value={emotion}>
                {emotion}
              </option>
            ))}
          </select>
        </label>
        {(savedItemId ?? existing?.item_id) ? (
          <button
            type="button"
            className="w-fit rounded-md border px-4 py-2"
            disabled={busy}
            onClick={() => void previewSelectedEmotion()}
          >
            Preview selected emotion
          </button>
        ) : null}
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          className="border-border bg-background text-foreground disabled:text-muted-foreground w-fit rounded-md border px-4 py-2 disabled:opacity-100"
          disabled={
            busy ||
            !resolvedName.trim() ||
            !animations.length ||
            !defaultIds.length
          }
          onClick={() => void save()}
        >
          {busy ? "Saving…" : "Save and preview"}
        </button>
      </section>
      {preview ? (
        <p className="rounded-lg border p-3 text-sm">
          {previewEmotion}: {preview.selected_animation_name ?? "Default"}
        </p>
      ) : null}
    </main>
  );
}

async function resolveIdleStylePreview(
  itemId: string,
  emotion: string,
): Promise<PyIdleStylePreview> {
  const preview = await previewCatalogItem(itemId, undefined, "idle_style");
  const metadata = preview.metadata;
  const animations = Array.isArray(metadata.animations)
    ? metadata.animations.filter((value): value is Record<string, unknown> =>
        Boolean(value && typeof value === "object"),
      )
    : [];
  const emotionPools =
    metadata.emotion_pools && typeof metadata.emotion_pools === "object"
      ? (metadata.emotion_pools as Record<string, unknown>)
      : {};
  const preferred = Array.isArray(emotionPools[emotion])
    ? (emotionPools[emotion] as unknown[]).map(String)
    : Array.isArray(metadata.default_pool)
      ? metadata.default_pool.map(String)
      : [];
  const selectedId = preferred[0] ?? String(animations[0]?.animation_id ?? "");
  const selected = animations.find(
    (animation) => String(animation.animation_id) === selectedId,
  );
  return {
    ...preview,
    selected_animation_id: selectedId || null,
    selected_animation_name: selected
      ? String(selected.name ?? selectedId)
      : null,
  };
}
