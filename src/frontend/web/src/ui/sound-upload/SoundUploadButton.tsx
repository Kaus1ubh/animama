import { useEffect, useReducer, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { UploadIcon } from "lucide-react";
import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
import { listCatalogItems, saveCatalogItem } from "@/lib/content/catalogApi";
import type { PyContentItem } from "@/lib/content/catalogTypes";
import { queryKeys } from "@/query/keys";
import { Button } from "@/ui/components/button";
import { cn } from "@/lib/utils";
import { SOUND_UPLOAD_ACCEPT, SoundUploadQueue } from "./soundUploadQueue";

/** Upload reusable Library sounds independently of the surrounding creator draft. */
export function SoundUploadButton({
  onUploaded,
  className,
}: {
  /** Reports each saved item; callers decide whether to offer selection. */
  onUploaded?: (item: PyContentItem) => void;
  className?: string;
}) {
  const client = useQueryClient();
  const owner = useRuntimeOwnerId();
  const input = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const callback = useRef(onUploaded);
  callback.current = onUploaded;
  const [, render] = useReducer((value: number) => value + 1, 0);
  const [queue] = useState(
    () =>
      new SoundUploadQueue(
        {
          listNames: async () =>
            (await listCatalogItems("sound_effect")).map(
              (item) => item.display_name,
            ),
          save: saveCatalogItem,
          onSaved: async (item) => {
            if (owner) {
              await Promise.all([
                client.invalidateQueries(
                  { queryKey: queryKeys.soundEffects.all(owner) },
                  { throwOnError: true },
                ),
                client.invalidateQueries(
                  { queryKey: queryKeys.content.catalog(owner) },
                  { throwOnError: true },
                ),
              ]);
            }
            if (mounted.current) callback.current?.(item);
          },
        },
        () => {
          if (mounted.current) render();
        },
      ),
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  return (
    <div className={cn("grid min-w-0 gap-2", className)}>
      <input
        ref={input}
        type="file"
        accept={SOUND_UPLOAD_ACCEPT}
        multiple
        className="hidden"
        aria-label="Upload sound files"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          void queue.add(files);
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit"
        onClick={() => input.current?.click()}
      >
        <UploadIcon className="size-3.5" /> Upload
      </Button>
      {queue.entries.length ? (
        <ul
          aria-label="Sound uploads"
          aria-live="polite"
          className="grid max-h-40 gap-2 overflow-y-auto text-xs"
        >
          {queue.entries.map((entry) => (
            <li
              key={entry.id}
              className="grid min-w-0 gap-1 rounded-md border p-2"
            >
              <span className="font-medium break-words">{entry.name}</span>
              {entry.status === "error" ? (
                <>
                  <span className="text-destructive">{entry.error}</span>
                  <button
                    type="button"
                    className="w-fit underline"
                    onClick={() => void queue.retry(entry.id)}
                  >
                    Retry {entry.file.name}
                  </button>
                </>
              ) : (
                <span className="text-muted-foreground">
                  {entry.status === "saved"
                    ? "Saved to Library"
                    : entry.status === "uploading"
                      ? "Uploading…"
                      : "Queued"}
                </span>
              )}
              {entry.notificationError ? (
                <>
                  <span className="text-destructive">
                    {entry.notificationError}
                  </span>
                  <button
                    type="button"
                    className="w-fit underline"
                    onClick={() => void queue.refresh(entry.id)}
                  >
                    Refresh catalog
                  </button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
