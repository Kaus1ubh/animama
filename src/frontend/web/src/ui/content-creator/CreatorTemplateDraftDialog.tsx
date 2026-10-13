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
  const { t } = useTranslation("creator");
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
          <DialogTitle>{t("templateDraft.title")}</DialogTitle>
          <DialogDescription>
            {t("templateDraft.description", {
              label: contentLabel,
              template: templateName,
            })}
          </DialogDescription>
          {seedError ? (
            <p role="alert" className="text-destructive text-sm">
              {t("templateDraft.seedFailed", { reason: seedError })}
            </p>
          ) : null}
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={starting || Boolean(seedError)}
            onClick={() => void start.startFromTemplate()}
          >
            {starting ? t("leave.discarding") : t("templateDraft.useTemplate")}
          </Button>
          <Button disabled={starting} onClick={start.continueDraft}>
            {t("templateDraft.continue")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
