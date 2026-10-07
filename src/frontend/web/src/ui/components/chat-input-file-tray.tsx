"use client";

import type { PyUserFileResponse } from "@/lib/content/catalogTypes";
import type { UserFileUploadUppy } from "@/hooks/useUserFileUpload";
import {
  resolveUserFileUploadCardStatus,
  type UserFileUploadCardStatus,
} from "@/lib/user-files/upload-card-status";
import { formatFileSize } from "@/lib/user-files/uploads";
import { cn } from "@/lib/utils";
import { useUserFiles } from "@/query/hooks/useUserFiles";
import { Button } from "@/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/ui/components/tooltip";
import { useUppyState } from "@uppy/react";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader2,
  X,
} from "lucide-react";
import { useMemo } from "react";

type ChatInputFileTrayProps = {
  className?: string;
  /** Shown under the attached files, e.g. when the model cannot search them. */
  note?: string | null;
  existingFiles?: readonly PyUserFileResponse[];
  onRemoveExistingFile?: (fileId: string) => void;
  uppy: UserFileUploadUppy;
};

const statusTextClassName: Record<UserFileUploadCardStatus["tone"], string> = {
  active: "text-primary",
  destructive: "text-destructive",
  muted: "text-muted-foreground",
  success: "text-success",
  warning: "text-warning",
};

const statusIconClassName: Record<UserFileUploadCardStatus["tone"], string> = {
  active: "bg-primary/10 text-primary",
  destructive: "bg-destructive/10 text-destructive",
  muted: "bg-muted text-muted-foreground",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
};

function knownFileId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeExtension(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.startsWith(".") ? trimmed.toLowerCase() : `.${trimmed}`;
}

function fileKind(
  file: ReturnType<UserFileUploadUppy["getFile"]>,
  backendFile: PyUserFileResponse | null,
): string {
  return (
    normalizeExtension(backendFile?.normalized_extension) ??
    normalizeExtension(file.extension) ??
    (file.type || "file")
  );
}

function displaySize(
  file: ReturnType<UserFileUploadUppy["getFile"]>,
  backendFile: PyUserFileResponse | null,
): string {
  return formatFileSize(
    backendFile?.stored_size_bytes ??
      backendFile?.declared_size_bytes ??
      file.size,
  );
}

function StatusGlyph({ status }: { status: UserFileUploadCardStatus }) {
  if (status.active) {
    return <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />;
  }

  if (status.id === "failed") {
    return <AlertTriangle className="size-3.5" aria-hidden="true" />;
  }

  if (
    status.id === "ready" ||
    status.id === "ready_keyword_only" ||
    status.id === "uploaded"
  ) {
    return <CheckCircle2 className="size-3.5" aria-hidden="true" />;
  }

  return <FileText className="size-3.5" aria-hidden="true" />;
}

function ExistingFileCard({
  file,
  onRemove,
}: {
  file: PyUserFileResponse;
  onRemove?: (fileId: string) => void;
}) {
  const statusLabel =
    file.status === "ready" ? "Ready" : "Ready (keyword only)";
  return (
    <div
      className="border-border/70 bg-background/80 flex min-h-14 min-w-0 basis-[13rem] items-center gap-2 rounded-lg border px-2 py-1.5 shadow-xs"
      aria-label={`${file.original_filename} ${statusLabel}`}
    >
      <div className="bg-success/10 text-success flex size-7 shrink-0 items-center justify-center rounded-md">
        <CheckCircle2 className="size-3.5" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-foreground truncate text-xs font-medium">
          {file.original_filename}
        </div>
        <div className="text-muted-foreground text-2xs mt-0.5 flex min-w-0 items-center gap-1.5 leading-4">
          <span className="shrink-0">
            {normalizeExtension(file.normalized_extension) ?? "file"}
          </span>
          <span className="shrink-0">
            {formatFileSize(file.stored_size_bytes ?? file.declared_size_bytes)}
          </span>
          <span className="text-success min-w-0 truncate font-medium">
            {statusLabel}
          </span>
        </div>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground size-6 shrink-0 rounded-full"
            onClick={() => onRemove?.(file.file_id)}
          >
            <X className="size-3.5" aria-hidden="true" />
            <span className="sr-only">Remove from composer</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent avoidCollisions={false} side="bottom">
          Remove from composer
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

export function ChatInputFileTray({
  className,
  note,
  existingFiles = [],
  onRemoveExistingFile,
  uppy,
}: ChatInputFileTrayProps) {
  const filesById = useUppyState(uppy, (state) => state.files);
  const files = useMemo(() => Object.values(filesById), [filesById]);
  const knownFileIds = useMemo(
    () =>
      Array.from(
        new Set(
          files
            .map((file) => file.meta.file_id)
            .filter((fileId): fileId is string => knownFileId(fileId)),
        ),
      ),
    [files],
  );
  const knownFileIdSet = useMemo(() => new Set(knownFileIds), [knownFileIds]);
  const filesQuery = useUserFiles({
    enabled: knownFileIds.length > 0,
    pollActive: true,
  });
  const backendFilesById = useMemo(() => {
    const map = new Map<string, PyUserFileResponse>();
    for (const file of filesQuery.data ?? []) {
      if (knownFileIdSet.has(file.file_id)) {
        map.set(file.file_id, file);
      }
    }
    return map;
  }, [filesQuery.data, knownFileIdSet]);

  if (files.length === 0 && existingFiles.length === 0) {
    return null;
  }

  return (
    <div className={cn("w-full space-y-2", className)}>
      <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto pr-1">
        {files.map((file) => {
          const fileId = knownFileId(file.meta.file_id)
            ? file.meta.file_id
            : null;
          const backendFile = fileId
            ? (backendFilesById.get(fileId) ?? null)
            : null;
          const status = resolveUserFileUploadCardStatus({
            backendFile,
            uppyFile: file,
          });
          const progressWidth =
            status.id === "uploading" && status.progress !== null
              ? `${status.progress}%`
              : null;

          return (
            <div
              key={file.id}
              className="border-border/70 bg-background/80 flex min-h-14 min-w-0 basis-[13rem] items-center gap-2 rounded-lg border px-2 py-1.5 shadow-xs"
              aria-label={`${file.name} ${status.label}`}
            >
              <div
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-md",
                  statusIconClassName[status.tone],
                )}
              >
                <StatusGlyph status={status} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-foreground truncate text-xs font-medium">
                  {file.name}
                </div>
                <div className="text-muted-foreground text-2xs mt-0.5 flex min-w-0 items-center gap-1.5 leading-4">
                  <span className="shrink-0">
                    {fileKind(file, backendFile)}
                  </span>
                  <span className="shrink-0">
                    {displaySize(file, backendFile)}
                  </span>
                  <span
                    className={cn(
                      "min-w-0 truncate font-medium",
                      statusTextClassName[status.tone],
                    )}
                  >
                    {status.label}
                  </span>
                </div>
                {progressWidth ? (
                  <div className="bg-muted mt-1 h-1 overflow-hidden rounded-full">
                    <div
                      className="bg-primary h-full rounded-full transition-[width]"
                      style={{ width: progressWidth }}
                    />
                  </div>
                ) : null}
                {status.error ? (
                  <div className="text-destructive text-2xs mt-0.5 truncate leading-4">
                    {status.error}
                  </div>
                ) : null}
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:text-foreground size-6 shrink-0 rounded-full"
                    onClick={() => {
                      uppy.removeFile(file.id);
                    }}
                  >
                    <X className="size-3.5" aria-hidden="true" />
                    <span className="sr-only">Remove from composer</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent avoidCollisions={false} side="bottom">
                  Remove from composer
                </TooltipContent>
              </Tooltip>
            </div>
          );
        })}
        {existingFiles.map((file) => (
          <ExistingFileCard
            key={`existing-${file.file_id}`}
            file={file}
            onRemove={onRemoveExistingFile}
          />
        ))}
      </div>
      {note ? (
        <p className="text-muted-foreground text-xs" role="status">
          {note}
        </p>
      ) : null}
    </div>
  );
}
