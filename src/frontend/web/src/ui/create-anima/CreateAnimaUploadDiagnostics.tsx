"use client";

import { AlertTriangle, CheckCircle2, LoaderCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { AvatarDiagnosticsDialog } from "@/ui/animas/AvatarDiagnosticsDialog";
import {
  useAvatarDiagnostics,
  type AvatarDiagnosticsSource,
} from "@/ui/animas/useAvatarDiagnostics";
import { Button } from "@/ui/components/button";
import type { CreationStageAvatar } from "./CreateAnimaStage";

/**
 * One line under Create Anima's upload preview: whether Diagnostics found
 * problems in the chosen file (from the stage's Avatar once it loads), with
 * a link to the full Diagnostics for the unsaved upload. A file the stage
 * cannot load still links to its file facts and the load error.
 */
export function CreateAnimaUploadDiagnostics({
  file,
  stage,
}: {
  file: File;
  stage: CreationStageAvatar;
}) {
  const { t } = useTranslation("create");
  const [open, setOpen] = useState(false);
  const source = useMemo<AvatarDiagnosticsSource>(
    () => ({
      kind: "upload",
      file,
      avatar: stage.avatar,
      stage: stage.status,
    }),
    [file, stage.avatar, stage.status],
  );
  const view = useAvatarDiagnostics(source, true);
  const { state } = view;

  let icon = (
    <LoaderCircle className="size-4 shrink-0 animate-spin" aria-hidden />
  );
  let text: string = t("avatarStep.diagnostics.checking");
  if (stage.status === "failed") {
    icon = (
      <AlertTriangle className="text-warning size-4 shrink-0" aria-hidden />
    );
    text = t("avatarStep.diagnostics.failed");
  } else if (state.status === "ready") {
    const count = state.issues.length;
    icon =
      count > 0 ? (
        <AlertTriangle className="text-warning size-4 shrink-0" aria-hidden />
      ) : (
        <CheckCircle2 className="text-success size-4 shrink-0" aria-hidden />
      );
    text =
      count > 0
        ? t("avatarStep.diagnostics.problems", { count })
        : t("avatarStep.diagnostics.noProblems");
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <p
        role="status"
        className="text-muted-foreground flex items-center gap-2"
      >
        {icon}
        {text}
      </p>
      <Button
        type="button"
        variant="link"
        size="sm"
        className="h-auto px-0"
        onClick={() => setOpen(true)}
      >
        {t("avatarStep.diagnostics.view")}
      </Button>
      <AvatarDiagnosticsDialog
        source={source}
        view={view}
        open={open}
        onOpenChange={setOpen}
      />
    </div>
  );
}
