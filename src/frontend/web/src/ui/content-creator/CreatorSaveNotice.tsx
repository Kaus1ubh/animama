import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  LoaderCircleIcon,
} from "lucide-react";
import type { ReactNode, Ref } from "react";

import { cn } from "@/lib/utils";

type CreatorSaveNoticeProps = {
  message: ReactNode;
  tone?: "neutral" | "warning" | "error" | "success";
  busy?: boolean;
  actions?: ReactNode;
  className?: string;
  noticeRef?: Ref<HTMLElement>;
  focusOnError?: boolean;
};

/** Accessible save, recovery, and validation status surface. */
export function CreatorSaveNotice({
  message,
  tone = "neutral",
  busy = false,
  actions,
  className,
  noticeRef,
  focusOnError = false,
}: CreatorSaveNoticeProps) {
  const isError = tone === "error";
  const Icon = busy
    ? LoaderCircleIcon
    : tone === "success"
      ? CheckCircle2Icon
      : AlertTriangleIcon;
  return (
    <section
      ref={noticeRef}
      className={cn(
        "border-border bg-background/95 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-2 text-xs shadow-lg backdrop-blur-xl",
        className,
      )}
      role={isError ? "alert" : "status"}
      aria-live="polite"
      aria-atomic="true"
      tabIndex={focusOnError && isError ? -1 : undefined}
    >
      <Icon
        className={cn(
          "size-4 shrink-0",
          busy && "animate-spin motion-reduce:animate-none",
          isError && "text-destructive",
          tone === "warning" && "text-amber-600",
          tone === "success" && "text-emerald-600",
          tone === "neutral" && "text-muted-foreground",
        )}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1">{message}</span>
      {actions}
    </section>
  );
}
