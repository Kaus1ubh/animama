"use client";

import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import type { PyMusicTrackPreview } from "@/lib/content/catalogTypes";
import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
import { useContentSaveFailure } from "@/hooks/useContentSaveFailure";
import {
  deleteCatalogItem,
  localContentLogicalKey,
  previewCatalogItem,
  saveCatalogItem,
} from "@/lib/content/catalogApi";
import {
  EMPTY_MUSIC_TRACK_DOCUMENT,
  validateMusicTrackDocument,
} from "@/lib/content/musicTrackDocument";
import {
  clearContentEditRecovery,
  CONTENT_EDIT_RECOVERY_SCHEMA,
  loadContentEditRecovery,
  saveContentEditRecovery,
} from "@/lib/content/contentEditRecovery";
import { useMusicTrack } from "@/query/hooks/useMusicTracks";
import { useContentPreviewAudio } from "@/ui/content-preview/useContentPreviewAudio";
import { ContentHealth } from "@/ui/content-health/ContentHealth";
import { cn } from "@/lib/utils";

/** Single-file Music Track editor with exact catalog previews. */
export function MusicTrackEditorPage({ itemId }: { itemId?: string }) {
  const existingQuery = useMusicTrack(itemId ?? null);
  const existing = existingQuery.data;
  const userId = useRuntimeOwnerId();
  const documentKey = itemId ?? "new";
  const recovery = useMemo(
    () =>
      userId ? loadContentEditRecovery(userId, "music", documentKey) : null,
    [documentKey, userId],
  );
  const operationRef = useRef(recovery?.operationId ?? crypto.randomUUID());
  const nameInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const [name, setName] = useState(() => String(recovery?.form.name ?? ""));
  const [description, setDescription] = useState(() =>
    String(recovery?.form.description ?? ""),
  );
  const [file, setFile] = useState<File | null>(null);
  const [loop, setLoop] = useState(() =>
    typeof recovery?.form.loop === "boolean" ? recovery.form.loop : true,
  );
  const [gain, setGain] = useState(() =>
    typeof recovery?.form.gain === "number" ? recovery.form.gain : 1,
  );
  const [autoplay, setAutoplay] = useState(() =>
    typeof recovery?.form.autoplay === "boolean"
      ? recovery.form.autoplay
      : false,
  );
  const [preview, setPreview] = useState<PyMusicTrackPreview | null>(null);
  const {
    capture: captureSaveFailure,
    clear: clearSaveFailure,
    clearField: clearSaveErrorField,
    error,
    errorField,
    setMessage: setSaveFailureMessage,
  } = useContentSaveFailure();
  const [busy, setBusy] = useState(false);
  const resolvedName = name || existing?.name || "";
  const resolvedDescription = description || existing?.description || "";
  const remoteAudio = useContentPreviewAudio(preview);
  const localUrl = useMemo(
    () => (file ? URL.createObjectURL(file) : null),
    [file],
  );
  useEffect(
    () => () => void (localUrl && URL.revokeObjectURL(localUrl)),
    [localUrl],
  );
  useEffect(() => {
    if (errorField === "name") nameInputRef.current?.focus();
    if (errorField === "files") fileInputRef.current?.focus();
  }, [errorField]);
  const save = async () => {
    const validation = validateMusicTrackDocument({
      ...EMPTY_MUSIC_TRACK_DOCUMENT,
      name: resolvedName,
      description: resolvedDescription,
      file,
      loop,
      gain,
      autoplay,
    });
    if (validation.length) {
      setSaveFailureMessage(
        validation.join(" "),
        !resolvedName.trim() ? "name" : !file ? "files" : null,
      );
      return;
    }
    const operationId = operationRef.current;
    if (userId) {
      saveContentEditRecovery({
        schema: CONTENT_EDIT_RECOVERY_SCHEMA,
        userId,
        family: "music",
        documentKey,
        operationId,
        form: {
          name: resolvedName,
          description: resolvedDescription,
          loop,
          gain,
          autoplay,
        },
        updatedAt: new Date().toISOString(),
      });
    }
    try {
      setBusy(true);
      clearSaveFailure();
      const item = await saveCatalogItem({
        kind: "music_track",
        entryName: resolvedName.trim(),
        files: [file!],
        metadata: {
          schema_version: 1,
          id:
            existing?.logical_key ??
            localContentLogicalKey("music_track", resolvedName),
          content_type: "music_track",
          name: resolvedName.trim(),
          description: resolvedDescription.trim() || undefined,
          defaults: { loop, gain, autoplay },
          codec: file!.type || file!.name.split(".").at(-1) || "unknown",
        },
        operationId,
        catalogItemId: existing?.item_id,
        expectedRevision: existing?.revision_sha256,
      });
      const resolvedPreview = await resolveMusicPreview(item.item_id, {
        loop,
        gain,
      });
      setPreview(resolvedPreview);
      toast.success("Music Track saved.");
      if (userId) clearContentEditRecovery(userId, "music", documentKey);
      await navigate({
        to: "/a/music-tracks/$musicTrackId/edit",
        params: { musicTrackId: item.item_id },
        replace: true,
      });
    } catch (caught) {
      captureSaveFailure(caught);
    } finally {
      setBusy(false);
    }
  };

  const previewExisting = async () => {
    if (!existing?.source) return;
    try {
      setPreview(await resolveMusicPreview(existing.item_id, { loop, gain }));
    } catch (caught) {
      setSaveFailureMessage(
        caught instanceof Error ? caught.message : "Preview failed.",
      );
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-muted-foreground text-sm">Creator Studio</p>
          <h1 className="text-3xl font-semibold">
            {itemId ? "Edit Music Track" : "New Music Track"}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <ContentHealth />
          <Link to="/a/create" className="text-sm underline">
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
            maxLength={120}
          />
        </label>
        <label className="grid gap-2 text-sm font-medium">
          Description
          <textarea
            className="bg-background min-h-24 rounded-md border px-3 py-2"
            value={resolvedDescription}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={2000}
          />
        </label>
        <label
          className={cn(
            "grid gap-2 rounded-lg text-sm font-medium",
            errorField === "files" &&
              "bg-destructive/5 text-destructive ring-destructive/40 p-2 ring-1",
          )}
        >
          Audio file (MP3, Ogg, or WAV)
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/mpeg,audio/ogg,audio/wav,.mp3,.ogg,.wav"
            aria-invalid={errorField === "files"}
            onChange={(event) => {
              clearSaveErrorField("files");
              setFile(event.target.files?.[0] ?? null);
            }}
          />
        </label>
        {localUrl ? <audio controls src={localUrl} className="w-full" /> : null}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={loop}
            onChange={(event) => setLoop(event.target.checked)}
          />
          Loop by default
        </label>
        <label className="grid gap-2 text-sm font-medium">
          Default gain: {Math.round(gain * 100)}%
          <input
            type="range"
            min="0"
            max="2"
            step="0.05"
            value={gain}
            onChange={(event) => setGain(Number(event.target.value))}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={autoplay}
            onChange={(event) => setAutoplay(event.target.checked)}
          />
          Suggest autoplay when first added
        </label>
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="bg-primary text-primary-foreground rounded-md px-4 py-2 disabled:opacity-50"
            disabled={busy || !file || !resolvedName.trim()}
            onClick={() => void save()}
          >
            {busy ? "Saving…" : "Save Music Track"}
          </button>
          {existing?.source ? (
            <button
              type="button"
              className="rounded-md border px-4 py-2"
              onClick={() => void previewExisting()}
            >
              Preview saved track
            </button>
          ) : null}
        </div>
        {existing?.origin === "owned" ? (
          <button
            type="button"
            className="text-destructive w-fit text-sm underline"
            disabled={busy}
            onClick={() =>
              void deleteCatalogItem(
                existing.item_id,
                existing.revision_sha256!,
              ).then(() => navigate({ to: "/a/create" }))
            }
          >
            Delete Music Track
          </button>
        ) : null}
      </section>
      {preview ? (
        <section className="grid gap-3 rounded-xl border p-5">
          <h2 className="font-semibold">Exact saved preview</h2>
          {remoteAudio.url ? (
            <audio controls src={remoteAudio.url} className="w-full" />
          ) : null}
          {remoteAudio.error ? (
            <p className="text-destructive text-sm">{remoteAudio.error}</p>
          ) : null}
          <p className="text-muted-foreground text-sm">
            {Math.round(preview.duration_seconds)} seconds · {preview.codec} ·{" "}
            {preview.loop ? "Loop" : "Play once"}
          </p>
        </section>
      ) : null}
    </main>
  );
}

async function resolveMusicPreview(
  itemId: string,
  overrides: { loop: boolean; gain: number },
): Promise<PyMusicTrackPreview> {
  const preview = await previewCatalogItem(itemId, undefined, "music_track");
  const defaults =
    preview.metadata.defaults && typeof preview.metadata.defaults === "object"
      ? (preview.metadata.defaults as Record<string, unknown>)
      : {};
  return {
    ...preview,
    duration_seconds: Number(preview.metadata.duration_seconds ?? 0),
    codec: String(preview.metadata.codec ?? "unknown"),
    loop: overrides.loop ?? Boolean(defaults.loop ?? true),
    gain: overrides.gain ?? Number(defaults.gain ?? 1),
  };
}
