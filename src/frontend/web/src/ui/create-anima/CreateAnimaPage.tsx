import { Link, useBlocker, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Sparkles } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import type {
  AnimaCreationDiagnostic,
  ItemRevisionRef,
} from "@animama/runtime-contracts/sdk";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { creationIssueText } from "@/lib/errors/creationErrors";
import { creationEvidence } from "@/query/hooks/useAnimaCreation";
import { AppShellPage } from "@/ui/app/AppShellPage";
import { Button } from "@/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/ui/components/dialog";
import { useContentPreviewDock } from "@/ui/content-preview/ContentPreviewDockProvider";
import { CreateAnimaActionsStep } from "./CreateAnimaActionsStep";
import { CreateAnimaAvatarStep } from "./CreateAnimaAvatarStep";
import { CreateAnimaCompletion } from "./CreateAnimaCompletion";
import { CreateAnimaVoiceStep } from "./CreateAnimaVoiceStep";
import { CreateAnimaIdentityStep } from "./CreateAnimaIdentityStep";
import { CreateAnimaNamePlate } from "./CreateAnimaNamePlate";
import { CreateAnimaReviewStep } from "./CreateAnimaReviewStep";
import {
  CreateAnimaStage,
  type CreationStageAvatar,
  type CreationStageHandle,
} from "./CreateAnimaStage";
import { creationPortraitTarget } from "./createAnimaPortrait";
import { useSaveAvatarPortrait } from "@/query/mutations/useSaveAvatarPortrait";
import { CreateAnimaStepNav, creationStepText } from "./CreateAnimaStepNav";
import { CreateAnimaWorkspace } from "./CreateAnimaWorkspace";
import { creationIssueTarget } from "./createAnimaActions";
import {
  canonicalJson,
  CREATION_STEPS,
  issueStep,
  type CreationStep,
} from "./createAnimaDraft";
import { CreatorError } from "./createAnimaErrors";
import {
  creationDraftSignature,
  useCreateAnimaController,
} from "./useCreateAnimaController";

/** Secondary technical text for a worded failure (backend English outside English). */
function ErrorDetail({ detail }: { detail: string | null }) {
  return detail ? (
    <span className="text-muted-foreground mt-1 block text-xs">{detail}</span>
  ) : null;
}

/** The owner key prevents drafts or provisional files from crossing installations. */
export function CreateAnimaPage({ avatar }: { avatar?: string }) {
  const { t } = useTranslation("create");
  const owner = useRuntimeCacheKey();
  return owner ? (
    <OwnedCreateAnimaPage key={owner} owner={owner} avatar={avatar} />
  ) : (
    <AppShellPage>
      <p>{t("page.runtimeUnavailable")}</p>
    </AppShellPage>
  );
}

function OwnedCreateAnimaPage({
  owner,
  avatar,
}: {
  owner: string;
  avatar?: string;
}) {
  const { t } = useTranslation("create");
  const controller = useCreateAnimaController(owner, avatar);
  const { draft, sources, operations } = controller;
  const navigate = useNavigate();
  const { expireSession } = useContentPreviewDock();
  const [stageReady, setStageReady] = useState(false);
  // The stage's Avatar for the chosen upload, for its Diagnostics status.
  const [stageAvatar, setStageAvatar] = useState<CreationStageAvatar>({
    avatar: null,
    status: "loading",
  });
  const [startOver, setStartOver] = useState(false);
  const stage = useRef<CreationStageHandle | null>(null);
  const avatarFileInput = useRef<HTMLInputElement | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const summary = useRef<HTMLDivElement | null>(null);
  const bypassLeave = useRef(false);
  const playbackGeneration = useRef(0);

  useLayoutEffect(() => {
    expireSession();
  }, [expireSession]);
  useEffect(() => setStageReady(true), []);
  const stop = useCallback(() => {
    playbackGeneration.current++;
    stage.current?.stop();
  }, []);
  const signature = creationDraftSignature(draft);
  useEffect(() => stop(), [draft.step, signature, stop]);
  useEffect(() => {
    if (controller.busy || controller.locked || controller.conflict) stop();
  }, [controller.busy, controller.conflict, controller.locked, stop]);
  useEffect(() => heading.current?.focus(), [draft.step]);
  useEffect(() => {
    if (controller.focusErrors) summary.current?.focus();
  }, [controller.focusErrors]);
  useEffect(() => {
    if (!controller.focus) return;
    const frame = requestAnimationFrame(() =>
      document.getElementById(controller.focus!.target)?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [controller.focus]);

  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) =>
      !bypassLeave.current &&
      !controller.completedId &&
      current.pathname !== next.pathname &&
      (draft.meaningful || controller.busy || controller.locked),
    enableBeforeUnload: () =>
      !bypassLeave.current &&
      !controller.completedId &&
      (draft.meaningful || controller.busy || controller.locked),
    withResolver: true,
  });
  const leave = (discard: boolean) => {
    try {
      stop();
      if (discard && !controller.discard()) return;
      if (!discard) controller.saveForLeave();
      if (controller.conflict) return;
      bypassLeave.current = true;
      blocker.proceed?.();
    } catch {
      controller.retrySave();
    }
  };
  const savePortrait = useSaveAvatarPortrait();
  const portraitTarget = creationPortraitTarget({
    selected: draft.avatar,
    file: controller.file,
    avatars: sources.avatars.data ?? [],
  });
  const resolve = operations.resolve;
  const loadAvatar = useCallback(
    (source: ItemRevisionRef, signal: AbortSignal) =>
      resolve("avatar", source, { signal }),
    [resolve],
  );
  const play = (kind: "gesture" | "reaction", source: ItemRevisionRef) => {
    const token = ++playbackGeneration.current;
    requestAnimationFrame(() => {
      if (token !== playbackGeneration.current) return;
      stage.current?.play(async (signal) => {
        const preview = await resolve(kind, source, {
          fresh: true,
          signal,
        });
        const evidence = creationEvidence(preview);
        const old = draft.evidence[source.item_id]?.revisions;
        const baseline =
          old ??
          (draft.seed_revisions[source.item_id]
            ? Object.fromEntries(
                Object.keys(evidence.revisions).map((id) => [
                  id,
                  draft.seed_revisions[id],
                ]),
              )
            : null);
        if (
          baseline &&
          canonicalJson(baseline) !== canonicalJson(evidence.revisions)
        )
          throw new CreatorError(t("stage.dependencyChanged"));
        return preview;
      });
    });
  };
  const preview = (kind: "gesture" | "reaction", source: ItemRevisionRef) => {
    stop();
    play(kind, source);
  };
  const linkIssue = (issue: AnimaCreationDiagnostic) =>
    controller.focusIssue(
      issue,
      creationIssueTarget(
        issue.path,
        controller.valid?.spec.gestures ?? draft.gestures,
      ),
    );
  const attention = [
    ...new Set(
      controller.issues
        .map((issue) => issueStep(issue.path))
        .filter((step): step is CreationStep => step !== null),
    ),
  ];
  const nextStep = controller.returnToReview
    ? 4
    : (Math.min(4, draft.step + 1) as CreationStep);
  const stepText = creationStepText(t, draft.step as CreationStep);

  const storageError =
    controller.storageError || controller.conflict ? (
      <div
        role="alert"
        className="border-destructive/30 space-y-3 rounded-xl border p-4 text-sm"
      >
        <p>{controller.storageError}</p>
        <p className="text-muted-foreground text-xs">
          {t("storage.notStarted")}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={
            controller.conflict
              ? controller.reviewOtherTab
              : controller.retrySave
          }
        >
          {controller.conflict
            ? t("storage.reviewLatest")
            : t("storage.retrySave")}
        </Button>
      </div>
    ) : null;

  const panel = (
    <>
      <div className="shrink-0 px-5 pt-5 sm:px-7 sm:pt-6">
        <p className="flex items-center gap-2 text-lg font-semibold">
          <Sparkles className="text-primary size-4" />
          {t("page.title")}
        </p>
        <CreateAnimaStepNav
          step={draft.step}
          disabled={controller.busy || controller.conflict}
          attention={attention}
          onStep={(step) => controller.go(step)}
        />
      </div>
      <div
        data-testid="create-anima-panel-body"
        className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7"
      >
        <div className="mb-6">
          <p className="text-muted-foreground mb-2 text-xs font-medium tracking-widest uppercase">
            {t("page.stepCounter", {
              current: draft.step + 1,
              total: CREATION_STEPS.length,
            })}
          </p>
          <h1
            ref={heading}
            tabIndex={-1}
            className="focus-visible:ring-ring w-fit rounded text-2xl font-semibold tracking-tight outline-none focus-visible:ring-2"
          >
            {stepText.heading}
          </h1>
          {stepText.description ? (
            <p className="text-muted-foreground mt-2 text-sm">
              {stepText.description}
            </p>
          ) : null}
        </div>
        {controller.issues.length ? (
          <div
            ref={summary}
            role="alert"
            aria-label={t("page.issuesLabel")}
            tabIndex={-1}
            className="border-destructive/40 bg-destructive/5 focus:ring-ring mb-5 rounded-xl border p-4 outline-none focus:ring-2"
          >
            <ul className="space-y-3 text-sm">
              {controller.issues.map((issue, index) => {
                const text = creationIssueText(issue);
                return (
                  <li key={`${issue.path}:${index}`}>
                    <button
                      type="button"
                      className="text-destructive text-left underline underline-offset-2"
                      onClick={() => linkIssue(issue)}
                    >
                      {text.message}
                    </button>
                    {issue.code === "validation_unavailable" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-1 ml-2"
                        disabled={controller.busy}
                        onClick={() => void controller.validate(false)}
                      >
                        {t("actions.tryAgain")}
                      </Button>
                    ) : issue.item_id ||
                      !["draft_invalid", "validation_unavailable"].includes(
                        issue.code,
                      ) ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-1 ml-2"
                        disabled={controller.busy}
                        onClick={() => void controller.proposeRepair(issue)}
                      >
                        {t("page.reviewUpdatedSources")}
                      </Button>
                    ) : null}
                    <ErrorDetail detail={text.detail} />
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        {controller.message ? (
          <p role="status" className="mb-5 rounded-lg border p-3 text-sm">
            {controller.message}
            <ErrorDetail detail={controller.messageDetail} />
          </p>
        ) : null}
        {storageError}
        {sources.options.isError ? (
          <div
            role="alert"
            className="mb-5 space-y-2 rounded-lg border p-3 text-sm"
          >
            <p>{t("options.loadFailed")}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void sources.options.refetch()}
            >
              {t("options.retry")}
            </Button>
          </div>
        ) : null}
        {sources.options.data?.diagnostics.length ? (
          <div
            role="alert"
            className="mb-5 space-y-2 rounded-lg border p-3 text-sm"
          >
            <p>{t("options.needsRepair")}</p>
            <ul className="list-disc space-y-1 pl-4">
              {sources.options.data.diagnostics.map((issue, index) => {
                const text = creationIssueText(issue);
                return (
                  <li key={index}>
                    {text.message}
                    <ErrorDetail detail={text.detail} />
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        <fieldset
          disabled={controller.busy || controller.conflict}
          className="min-w-0 space-y-6 disabled:opacity-70"
          aria-label={t("page.formLabel", { step: stepText.heading })}
        >
          {draft.step === 0 ? (
            <CreateAnimaAvatarStep
              draft={draft}
              sources={sources}
              operations={operations}
              file={controller.file}
              fileInputRef={avatarFileInput}
              onFile={controller.setFile}
              onSelect={controller.chooseAvatar}
              onWorking={controller.setWorking}
              stageAvatar={stageAvatar}
            />
          ) : draft.step === 1 ? (
            <CreateAnimaVoiceStep
              draft={draft}
              onChange={controller.edit}
              disabled={controller.busy || controller.conflict}
              onBusyChange={controller.setWorking}
            />
          ) : draft.step === 2 ? (
            <CreateAnimaIdentityStep
              draft={draft}
              readOnly={controller.busy || controller.conflict}
              suggestion={
                sources.avatars.data?.find(
                  (item) => item.item_id === draft.avatar?.item_id,
                )?.description ?? null
              }
              errors={controller.issues.map((issue) => issue.path)}
              onChange={controller.edit}
            />
          ) : draft.step === 3 ? (
            <CreateAnimaActionsStep
              draft={draft}
              sources={sources}
              onEdit={controller.edit}
              onReset={controller.resetActions}
              onPreview={preview}
              focusTarget={controller.focus?.target}
            />
          ) : (
            <CreateAnimaReviewStep
              draft={draft}
              sources={sources}
              spec={controller.valid?.spec ?? null}
              warnings={controller.valid?.warnings ?? []}
              busy={controller.busy}
              onEdit={(step) => controller.go(step, true)}
            />
          )}
        </fieldset>
      </div>
      <div
        data-testid="create-anima-footer"
        className="bg-card sticky bottom-0 z-10 flex shrink-0 flex-wrap items-center justify-between gap-3 border-t px-5 py-4 sm:px-7"
      >
        <Button
          type="button"
          variant="ghost"
          disabled={controller.busy}
          onClick={() =>
            draft.step
              ? controller.go((draft.step - 1) as CreationStep)
              : void navigate({ to: "/create" })
          }
        >
          <ArrowLeft className="size-4" />
          {draft.step ? t("actions.back") : t("actions.cancel")}
        </Button>
        <Button
          type="button"
          disabled={
            controller.busy ||
            controller.conflict ||
            (draft.step === 4 && !controller.valid)
          }
          onClick={() =>
            draft.step === 4
              ? void controller.submit()
              : controller.go(nextStep)
          }
        >
          {controller.busy
            ? t("page.working")
            : draft.step === 4
              ? t("page.create")
              : t("page.continueTo", {
                  step: creationStepText(t, nextStep).label,
                })}
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </>
  );

  const recoverySurface =
    controller.recovery === "loading" ? (
      <p role="status" className="p-8">
        {t("recovery.checking")}
      </p>
    ) : controller.recovery === "resume" ||
      controller.recovery === "appearance" ||
      controller.recovery === "corrupt" ? (
      <section className="bg-card mx-auto max-w-xl space-y-4 rounded-2xl border p-6 shadow-sm sm:p-10">
        <h1 className="text-2xl font-semibold">
          {controller.recovery === "resume"
            ? t("recovery.resume.title")
            : controller.recovery === "appearance"
              ? t("recovery.appearance.title")
              : t("recovery.corrupt.title")}
        </h1>
        <p className="text-muted-foreground text-sm">
          {controller.recovery === "resume"
            ? t("recovery.resume.description")
            : controller.recovery === "appearance"
              ? t("recovery.appearance.description")
              : controller.storageError}
        </p>
        <div className="flex flex-wrap gap-2">
          {controller.recovery === "resume" ? (
            <Button onClick={controller.resume}>
              {t("recovery.resume.action")}
            </Button>
          ) : controller.recovery === "appearance" ? (
            <Button onClick={controller.continueWithoutImages}>
              {t("recovery.appearance.action")}
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => setStartOver(true)}>
            {t("actions.startOver")}
          </Button>
          <Button variant="ghost" asChild>
            <Link to="/create">{t("actions.creatorHub")}</Link>
          </Button>
        </div>
      </section>
    ) : controller.locked ? (
      <section className="bg-card mx-auto max-w-xl space-y-4 rounded-2xl border p-6 shadow-sm sm:p-10">
        <h1 className="text-2xl font-semibold">
          {draft.submission?.state === "deleted"
            ? t("locked.deleted.title")
            : draft.submission?.state === "conflict"
              ? t("locked.conflict.title")
              : controller.busy
                ? t("locked.creating")
                : t("locked.check.title")}
        </h1>
        <p className="text-muted-foreground text-sm">
          {draft.submission?.state === "deleted"
            ? t("locked.deleted.description")
            : draft.submission?.state === "conflict"
              ? t("locked.conflict.description")
              : t("locked.check.description")}
        </p>
        {controller.message ? (
          <p role="status">
            {controller.message}
            <ErrorDetail detail={controller.messageDetail} />
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {["pending", "unknown"].includes(draft.submission?.state ?? "") ? (
            <Button
              disabled={controller.busy || controller.conflict}
              onClick={() => void controller.submit(true)}
            >
              {controller.busy ? t("locked.checking") : t("locked.checkResult")}
            </Button>
          ) : null}
          {draft.submission?.state === "deleted" ? (
            <Button variant="outline" onClick={() => setStartOver(true)}>
              {t("locked.acknowledgeStartOver")}
            </Button>
          ) : null}
          <Button variant="ghost" asChild>
            <Link to="/create">{t("actions.creatorHub")}</Link>
          </Button>
        </div>
      </section>
    ) : null;

  return (
    <AppShellPage
      contentClassName="@container h-full min-h-0 max-w-none gap-0 p-0"
      className="bg-background motion-reduce:transition-none"
      sidebarBehavior="adaptive-canvas"
    >
      {controller.completedId ? (
        <div className="min-h-full p-4">
          <CreateAnimaCompletion
            owner={owner}
            animaId={controller.completedId}
            onConsumed={controller.completeHandoff}
          />
        </div>
      ) : recoverySurface ? (
        <div className="bg-background flex min-h-full items-center justify-center p-4">
          {recoverySurface}
        </div>
      ) : (
        <CreateAnimaWorkspace
          panel={panel}
          namePlate={
            <CreateAnimaNamePlate
              value={draft.display_name}
              limit={controller.displayNameLimit}
              invalid={controller.issues.some(
                (issue) => issue.path === "/display_name",
              )}
              readOnly={controller.busy || controller.conflict}
              onChange={(display_name) => controller.edit({ display_name })}
            />
          }
          stage={
            stageReady ? (
              <CreateAnimaStage
                ref={stage}
                avatar={draft.avatar}
                file={controller.file}
                loadAvatar={loadAvatar}
                onUpload={() => avatarFileInput.current?.click()}
                suspended={controller.busy || controller.conflict}
                onFinished={stop}
                portraitTarget={portraitTarget}
                savePortrait={savePortrait}
                onAvatarStateChange={setStageAvatar}
              />
            ) : (
              <p className="text-muted-foreground p-6 text-sm">
                {t("page.preparingStage")}
              </p>
            )
          }
        />
      )}
      <Dialog open={startOver} onOpenChange={setStartOver}>
        <DialogContent>
          <DialogTitle>{t("startOver.title")}</DialogTitle>
          <DialogDescription>{t("startOver.description")}</DialogDescription>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStartOver(false)}>
              {t("startOver.keep")}
            </Button>
            <Button
              onClick={() => {
                controller.discard(draft.submission?.state === "deleted");
                setStartOver(false);
              }}
            >
              {t("actions.startOver")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={blocker.status === "blocked"}
        onOpenChange={(open) => !open && blocker.reset?.()}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogTitle className="pr-10">
            {controller.locked
              ? t("leave.locked.title")
              : t("leave.draft.title")}
          </DialogTitle>
          <DialogDescription>
            {controller.locked
              ? t("leave.locked.description")
              : t("leave.draft.description")}
          </DialogDescription>
          <DialogFooter className="sm:flex-nowrap">
            <Button variant="outline" onClick={() => blocker.reset?.()}>
              {t("leave.keepEditing")}
            </Button>
            {!controller.locked && !controller.busy ? (
              <Button variant="outline" onClick={() => leave(true)}>
                {t("leave.discard")}
              </Button>
            ) : null}
            <Button onClick={() => leave(false)}>
              {controller.locked
                ? t("leave.locked.action")
                : t("leave.draft.action")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {controller.repair ? (
        <Dialog
          open
          onOpenChange={(open) => !open && controller.setRepair(null)}
        >
          <DialogContent>
            <DialogTitle>{t("repair.title")}</DialogTitle>
            <DialogDescription>
              {controller.repair.kind === "policy"
                ? t("repair.policyDescription")
                : t("repair.sourceDescription")}
            </DialogDescription>
            {controller.repair.kind === "source" ? (
              <div className="max-h-64 space-y-2 overflow-auto">
                <p className="text-sm font-medium">
                  {controller.repair.preview.item.name}
                </p>
                {Object.entries(
                  creationEvidence(controller.repair.preview).revisions,
                ).map(([id, revision]) => (
                  <p key={id} className="font-mono text-xs break-all">
                    {id}
                    <br />
                    {revision.revision_sha256}
                  </p>
                ))}
              </div>
            ) : (
              <p className="font-mono text-xs break-all">
                {controller.repair.options.starter_pack.revision_sha256}
              </p>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => controller.setRepair(null)}
              >
                {t("repair.keep")}
              </Button>
              <Button onClick={() => void controller.acceptRepair()}>
                {t("repair.accept")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </AppShellPage>
  );
}
