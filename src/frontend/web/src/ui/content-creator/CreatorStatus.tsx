import { AlertTriangleIcon, LoaderCircleIcon } from "lucide-react";

/** Full-workspace loading state while a creator opens saved content. */
export function CreatorLoading({ message }: { message: string }) {
  return (
    <div className="bg-background flex h-full items-center justify-center">
      <div className="text-muted-foreground flex items-center gap-2">
        <LoaderCircleIcon className="animate-spin" />
        {message}
      </div>
    </div>
  );
}

/** Error banner below the creator header, for content that could not open. */
export function CreatorInlineError({ message }: { message: string }) {
  return (
    <div className="bg-background text-destructive border-destructive/30 absolute top-[calc(var(--creator-header-height)+0.5rem)] left-1/2 z-[60] flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-lg border px-3 py-2 text-sm">
      <AlertTriangleIcon className="size-4" />
      {message}
    </div>
  );
}
