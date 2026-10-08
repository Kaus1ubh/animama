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
            {busy
              ? "Leave while content is being saved?"
              : "Discard authoring changes?"}
          </DialogTitle>
          <DialogDescription>
            {busy
              ? `This ${contentLabel} is still being saved. Local recovery remains available when you return.`
              : `This ${contentLabel} has local authoring changes. Discarding removes these changes and their browser recovery draft. Saved content is unchanged.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={discarding} onClick={guard.stay}>
            Stay
          </Button>
          <Button disabled={discarding} onClick={() => void guard.leave()}>
            {discarding
              ? "Discarding…"
              : busy
                ? "Leave and keep recovery"
                : "Discard and continue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
