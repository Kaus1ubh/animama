import { Button } from "@/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/components/dialog";

import type { useCreatorTemplateStart } from "./useCreatorTemplateStart";

/**
 * Asked when a template route finds an unsaved draft for that template:
 * continue the draft, or discard it and start again from the template.
 * Dismissing the dialog keeps the draft, so nothing is lost by accident.
 */
export function CreatorTemplateDraftDialog({
  start,
  contentLabel,
  templateName,
}: {
  /** The creator's `useCreatorTemplateStart` result. */
  start: Pick<
    ReturnType<typeof useCreatorTemplateStart>,
    "status" | "seedError" | "starting" | "continueDraft" | "startFromTemplate"
  >;
  /** The kind of content, for example "Avatar Effect". */
  contentLabel: string;
  templateName: string;
}) {
  const { seedError, starting } = start;
  return (
    <Dialog
      open={start.status === "choosing"}
      onOpenChange={(next) => {
        if (!next && !starting) start.continueDraft();
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Continue your unsaved draft?</DialogTitle>
          <DialogDescription>
            {`You have an unsaved ${contentLabel} started from ${templateName}. Continue it, or discard it and start again from the template. Saved content is unchanged.`}
          </DialogDescription>
          {seedError ? (
            <p role="alert" className="text-destructive text-sm">
              {`The template could not be opened: ${seedError}`}
            </p>
          ) : null}
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={starting || Boolean(seedError)}
            onClick={() => void start.startFromTemplate()}
          >
            {starting ? "Discarding…" : "Discard and use template"}
          </Button>
          <Button disabled={starting} onClick={start.continueDraft}>
            Continue draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
