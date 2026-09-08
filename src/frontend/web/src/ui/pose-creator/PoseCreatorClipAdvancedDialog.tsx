"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/ui/components/dialog";

/** Explain the typed timeline's intentionally compact advanced surface. */
export function PoseCreatorClipAdvancedDialog({
  open,
  onOpenChange,
  title = "Clip data",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:max-h-[88vh] sm:max-w-4xl">
        <DialogHeader className="border-border/70 border-b px-5 py-4 pr-12">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Timing and event data are edited directly in the typed action
            timeline.
          </DialogDescription>
        </DialogHeader>
        <div className="text-muted-foreground min-h-0 flex-1 overflow-y-auto p-5 text-sm">
          Select a keyframe or event on the timeline to edit it. Gesture and
          Reaction releases retain the complete sequence JSON when saved.
        </div>
      </DialogContent>
    </Dialog>
  );
}
