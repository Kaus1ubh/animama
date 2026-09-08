"use client";

import { lazy, Suspense, type ComponentProps } from "react";
import { Upload } from "lucide-react";

import { cn } from "@/lib/utils";

type FileInputProps = Pick<
  ComponentProps<"input">,
  "accept" | "aria-invalid" | "id" | "onChange" | "ref"
>;

type CreateAnimaAvatarPreviewProps = {
  file: File | null;
  fileInputProps: FileInputProps;
  fieldErrorMessage?: string | null;
  className?: string;
};

const LazyCreateAnimaAvatarPreviewScene = lazy(() =>
  import("@/ui/create/CreateAnimaAvatarPreviewScene").then((module) => ({
    default: module.CreateAnimaAvatarPreviewScene,
  })),
);

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AvatarPreviewSceneFallback({ file }: { file: File }) {
  return (
    <>
      <div className="h-full w-full" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 via-black/5 to-transparent px-4 py-3">
        <p className="text-sm font-medium text-white">{file.name}</p>
        <p className="text-xs text-white/80">
          {formatFileSize(file.size)} • Local preview only
        </p>
      </div>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/25 backdrop-blur-[1px]">
        <div className="rounded-full border border-white/20 bg-black/45 px-4 py-2 text-xs font-medium tracking-[0.18em] text-white uppercase">
          Loading Preview
        </div>
      </div>
    </>
  );
}

export function CreateAnimaAvatarPreview({
  file,
  fileInputProps,
  fieldErrorMessage = null,
  className,
}: CreateAnimaAvatarPreviewProps) {
  const fileKey = file
    ? `${file.name}:${file.size}:${file.lastModified}`
    : "empty";

  return (
    <div
      className={cn(
        "border-border/70 bg-card/80 overflow-hidden rounded-2xl border shadow-xl shadow-black/10 backdrop-blur-sm",
        className,
      )}
    >
      <div className="bg-background relative aspect-[16/10] overflow-hidden">
        <input
          {...fileInputProps}
          className="sr-only"
          type="file"
          accept={
            fileInputProps.accept ?? ".vrm,model/vrm,application/octet-stream"
          }
        />
        {file ? (
          <Suspense fallback={<AvatarPreviewSceneFallback file={file} />}>
            <LazyCreateAnimaAvatarPreviewScene key={fileKey} file={file} />
          </Suspense>
        ) : (
          <div className="h-full w-full" />
        )}

        <label
          htmlFor={fileInputProps.id}
          className={cn(
            "border-border/80 bg-background/88 text-foreground hover:bg-background inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium shadow-sm backdrop-blur-sm transition-colors",
            file
              ? "absolute top-3 right-3"
              : "absolute inset-0 m-auto h-fit w-fit justify-center",
          )}
        >
          <Upload className="size-4" />
          <span>{file ? "Replace VRM" : "Upload VRM"}</span>
        </label>
      </div>

      {fieldErrorMessage ? (
        <div className="border-border/60 border-t px-4 py-3">
          <p className="text-destructive text-sm font-medium">
            {fieldErrorMessage}
          </p>
        </div>
      ) : null}
    </div>
  );
}
