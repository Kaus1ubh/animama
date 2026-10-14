"use client";

import { useTranslation } from "react-i18next";

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
  title,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
}) {
  const { t } = useTranslation("pose");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:max-h-[88vh] sm:max-w-4xl">
        <DialogHeader className="border-border/70 border-b px-5 py-4 pr-12">
          <DialogTitle>{title ?? t("clip.advanced.title")}</DialogTitle>
          <DialogDescription>
            {t("clip.advanced.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="text-muted-foreground min-h-0 flex-1 overflow-y-auto p-5 text-sm">
          {t("clip.advanced.body")}
        </div>
      </DialogContent>
    </Dialog>
  );
}
