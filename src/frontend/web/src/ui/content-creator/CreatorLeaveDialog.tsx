import { useTranslation } from "react-i18next";

import { Button } from "@/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/components/dialog";

import type { CreatorLeaveGuard } from "./useCreatorLeaveGuard";

/** Confirmation shown when a creator with unsaved or saving content is left. */
export function CreatorLeaveDialog({
  guard,
  contentLabel,
}: {
  guard: CreatorLeaveGuard;
  /** The kind of content, for example "Avatar Effect". */
  contentLabel: string;
}) {
  const { t } = useTranslation("creator");
  const { blocked, busy, discarding } = guard;
  return (
    <Dialog
      open={blocked}
      onOpenChange={(open) => {
        if (!open && !discarding && blocked) guard.stay();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {busy ? t("leave.busy.title") : t("leave.dirty.title")}
          </DialogTitle>
          <DialogDescription>
            {busy
              ? t("leave.busy.description", { label: contentLabel })
              : t("leave.dirty.description", { label: contentLabel })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={discarding} onClick={guard.stay}>
            {t("leave.stay")}
          </Button>
          <Button disabled={discarding} onClick={() => void guard.leave()}>
            {discarding
              ? t("leave.discarding")
              : busy
                ? t("leave.busy.confirm")
                : t("leave.dirty.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
