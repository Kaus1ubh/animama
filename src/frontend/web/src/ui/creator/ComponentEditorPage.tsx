"use client";

import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { PyContentPreview } from "@/lib/content/catalogTypes";
import {
  deleteCatalogItem,
  previewCatalogItem,
  saveCatalogItem,
} from "@/lib/content/catalogApi";
import {
  ContentEditorHydration,
  loadCreatorPreviewFile,
} from "@/lib/content/contentEditorSource";
import { componentPreviewTarget } from "@/lib/content/componentPreviewTarget";
import { useContentEditorSaveSource } from "@/hooks/useContentEditorSaveSource";
import { useContentSaveFailure } from "@/hooks/useContentSaveFailure";
import { cn } from "@/lib/utils";
import { useParticleEffect, useSoundEffect } from "@/query/hooks/useEffects";
import { useContentPreviewDock } from "@/ui/content-preview/ContentPreviewDockProvider";
import { useContentPreviewAudio } from "@/ui/content-preview/useContentPreviewAudio";
import { CreatorEffectHandoffActions } from "@/ui/content-creator";
import { ContentHealth } from "@/ui/content-health/ContentHealth";

export type ComponentFamily = "particle" | "sound";

/** Direct Local file editor for the compact Particle and Sound creators. */
export function ComponentEditorPage({
  family,
  itemId,
}: {
  family: ComponentFamily;
  itemId?: string;
}) {
  const isParticle = family === "particle";
  const particle = useParticleEffect(isParticle ? (itemId ?? null) : null);
  const sound = useSoundEffect(!isParticle ? (itemId ?? null) : null);
  const existing = isParticle ? particle.data : sound.data;
  const { target: saveTargetFor, saved: recordSaved } =
    useContentEditorSaveSource(
      isParticle ? "particle_effect" : "sound_effect",
      itemId,
      existing,
    );
  const hydration = useRef(new ContentEditorHydration());
  const { openPreview } = useContentPreviewDock();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [volume, setVolume] = useState(1);
  const [preview, setPreview] = useState<PyContentPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const fileSelection = useRef(0);
  const {
    capture: captureSaveFailure,
    clear: clearSaveFailure,
    clearField: clearSaveErrorField,
    error,
    errorField,
  } = useContentSaveFailure();
  const nameInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const title = isParticle ? "Particle Effect" : "Sound Effect";
  const audio = useContentPreviewAudio(preview);

  useEffect(() => {
    if (!existing) return;
    const load = hydration.current.begin(existing.item_id);
    if (!load) return;
    setName(existing.name);
    setDescription(existing.description ?? "");
    const defaults = existing.metadata?.defaults;
    if (defaults && typeof defaults === "object") {
      const value = Number((defaults as Record<string, unknown>).volume ?? 1);
      if (Number.isFinite(value)) setVolume(value);
    }
    if (isParticle) {
      load.complete();
      return;
    }
    const controller = new AbortController();
    const selection = ++fileSelection.current;
    setLoadingFile(true);
    setFiles([]);
    clearSaveFailure();
    void previewCatalogItem(existing.item_id, controller.signal, "sound_effect")
      .then(async (preview) => ({
        preview,
        file: await loadCreatorPreviewFile(preview, "audio", controller.signal),
      }))
      .then(({ preview, file }) => {
        if (controller.signal.aborted || fileSelection.current !== selection)
          return;
        load.complete();
        setFiles([file]);
        setPreview(preview);
      })
      .catch((error) => {
        if (!controller.signal.aborted) captureSaveFailure(error);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingFile(false);
      });
    return () => {
      controller.abort();
      load.cancel();
    };
  }, [existing, isParticle, captureSaveFailure, clearSaveFailure]);

  useEffect(() => {
    if (errorField === "name") nameInputRef.current?.focus();
    if (errorField === "files") fileInputRef.current?.focus();
  }, [errorField]);

  const save = async () => {
    if (!name.trim() || files.length === 0) return;
    setBusy(true);
    clearSaveFailure();
    try {
      const saveTarget = saveTargetFor(name);
      const locator = existing?.relative_locator ?? "";
      const entryName = name;
      const descriptorBacked =
        isParticle &&
        (files.length > 1 || Boolean(existing && !locator.endsWith(".json")));
      const primary = files[0]!;
      const saved = descriptorBacked
        ? await saveCatalogItem({
            kind: "particle_effect",
            entryName,
            files,
            companionPaths: files.map((file) => file.name),
            descriptor: {
              schema_version: 1,
              id: saveTarget.logicalKey,
              content_type: "particle_effect",
              name: name.trim(),
              description: description.trim() || undefined,
              defaults: { loop: false },
              files: files.map((file, index) => ({
                path: file.name,
                role: index === 0 ? "manifest" : "image",
              })),
            },
            catalogItemId: saveTarget.catalogItemId,
            expectedRevision: saveTarget.expectedRevision,
          })
        : await saveCatalogItem({
            kind: isParticle ? "particle_effect" : "sound_effect",
            entryName,
            files: [primary],
            metadata: {
              schema_version: 1,
              id: saveTarget.logicalKey,
              name: name.trim(),
              description: description.trim() || undefined,
              defaults: isParticle ? { loop: false } : { volume },
            },
            catalogItemId: saveTarget.catalogItemId,
            expectedRevision: saveTarget.expectedRevision,
          });
      hydration.current.preserve(saved.item_id);
      await recordSaved(saved);
      const resolvedPreview = await previewCatalogItem(
        saved.item_id,
        undefined,
        isParticle ? "particle_effect" : "sound_effect",
      );
      setPreview(resolvedPreview);
      if (isParticle) {
        openPreview(
          componentPreviewTarget(
            resolvedPreview,
            "particle_effect",
            name.trim(),
          ),
        );
      }
      toast.success(`${title} saved to Local content.`);
      await navigate({
        to: isParticle
          ? "/a/particle-effects/$particleEffectId/edit"
          : "/a/sound-effects/$soundEffectId/edit",
        params: isParticle
          ? { particleEffectId: saved.item_id }
          : { soundEffectId: saved.item_id },
        replace: true,
      });
    } catch (caught) {
      captureSaveFailure(caught);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-muted-foreground text-sm">Creator Studio</p>
          <h1 className="text-3xl font-semibold">
            {itemId ? `Edit ${title}` : `New ${title}`}
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
            value={name}
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
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={2000}
          />
        </label>
        {!isParticle ? (
          <label className="grid gap-2 text-sm font-medium">
            Default volume: {volume.toFixed(2)}
            <input
              type="range"
              min="0"
              max="2"
              step="0.05"
              value={volume}
              onChange={(event) => setVolume(Number(event.target.value))}
            />
          </label>
        ) : null}
        <label
          className={cn(
            "grid gap-2 rounded-lg text-sm font-medium",
            errorField === "files" &&
              "bg-destructive/5 text-destructive ring-destructive/40 p-2 ring-1",
          )}
        >
          {isParticle
            ? "Manifest JSON, followed by optional textures"
            : "Audio file"}
          <input
            ref={fileInputRef}
            type="file"
            accept={isParticle ? "application/json,image/*" : "audio/*"}
            multiple={isParticle}
            aria-invalid={errorField === "files"}
            onChange={(event) => {
              clearSaveErrorField("files");
              fileSelection.current += 1;
              if (itemId) hydration.current.preserve(itemId);
              setFiles(Array.from(event.target.files ?? []));
            }}
          />
        </label>
        {loadingFile ? (
          <p role="status">Loading saved audio…</p>
        ) : files.length ? (
          <p className="text-muted-foreground text-sm">
            {files.map((file) => file.name).join(", ")}
          </p>
        ) : null}
        <p className="text-muted-foreground text-xs">
          Saving makes this reusable by Gestures and Reactions; it does not
          equip it automatically.
        </p>
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          className="border-border bg-background text-foreground disabled:text-muted-foreground w-fit rounded-md border px-4 py-2 disabled:opacity-100"
          disabled={busy || loadingFile || !name.trim() || files.length === 0}
          onClick={() => void save()}
        >
          {busy ? "Saving…" : `Save ${title}`}
        </button>
        {existing?.origin === "owned" ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            {existing.source ? (
              <CreatorEffectHandoffActions
                itemId={existing.item_id}
                componentType={isParticle ? "particle_effect" : "sound_effect"}
              />
            ) : null}
            <button
              type="button"
              className="text-destructive w-fit text-sm underline"
              disabled={busy || !existing.revision_sha256}
              onClick={() =>
                existing.revision_sha256 &&
                void deleteCatalogItem(
                  existing.item_id,
                  existing.revision_sha256,
                ).then(() => navigate({ to: "/a/create" }))
              }
            >
              Delete {title}
            </button>
          </div>
        ) : null}
      </section>
      {preview ? (
        <section className="grid gap-3 rounded-xl border p-5">
          <h2 className="font-semibold">Saved preview</h2>
          {audio.url ? (
            <audio controls src={audio.url} className="w-full" />
          ) : null}
          {audio.error ? (
            <p className="text-destructive text-sm">{audio.error}</p>
          ) : null}
          <pre className="bg-muted max-h-64 overflow-auto rounded-md p-3 text-xs">
            {JSON.stringify(preview.metadata, null, 2)}
          </pre>
        </section>
      ) : null}
    </main>
  );
}
