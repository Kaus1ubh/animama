import { Link, useBlocker, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Sparkles } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

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
import { CreateAnimaStage, type CreationStageHandle } from "./CreateAnimaStage";
import { CreateAnimaStepNav } from "./CreateAnimaStepNav";
import { CreateAnimaWorkspace } from "./CreateAnimaWorkspace";
import { creationIssueTarget } from "./createAnimaActions";
import {
  canonicalJson,
  CREATION_STEPS,
  issueStep,
  type CreationStep,
} from "./createAnimaDraft";
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

const HEADINGS = [
  "Choose an Avatar",
  "Choose a voice",
  "Define their Identity",
  "Choose Actions",
  "Review Anima",
];
const DESCRIPTIONS = [
  null,
  null,
  "Shape who they are, how they speak, and what matters to them.",
  "Choose how your Anima moves and reacts.",
  null,
];

/** The owner key prevents drafts or provisional files from crossing installations. */
export function CreateAnimaPage({ avatar }: { avatar?: string }) {
  const owner = useRuntimeCacheKey();
  return owner ? (
    <OwnedCreateAnimaPage key={owner} owner={owner} avatar={avatar} />
  ) : (
    <AppShellPage>
      <p>The local runtime is unavailable. Try again after it reconnects.</p>
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
  const controller = useCreateAnimaController(owner, avatar);
  const { draft, sources, operations } = controller;
  const navigate = useNavigate();
  const { expireSession } = useContentPreviewDock();
  const [stageReady, setStageReady] = useState(false);
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
          throw new Error(
            "An Action dependency changed. Accept its updated sources before previewing it.",
          );
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

  const storageError =
    controller.storageError || controller.conflict ? (
      <div
        role="alert"
        className="border-destructive/30 space-y-3 rounded-xl border p-4 text-sm"
      >
        <p>{controller.storageError}</p>
        <p className="text-muted-foreground text-xs">
          Creation will not start unless the exact request is safely saved.
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
            ? "Review latest saved state"
            : "Retry saving draft"}
        </Button>
      </div>
    ) : null;

  const panel = (
    <>
      <div className="shrink-0 px-5 pt-5 sm:px-7 sm:pt-6">
        <p className="flex items-center gap-2 text-lg font-semibold">
          <Sparkles className="text-primary size-4" />
          Create Anima
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
            Step {draft.step + 1} of 5
          </p>
          <h1
            ref={heading}
            tabIndex={-1}
            className="focus-visible:ring-ring w-fit rounded text-2xl font-semibold tracking-tight outline-none focus-visible:ring-2"
          >
            {HEADINGS[draft.step]}
          </h1>
          {DESCRIPTIONS[draft.step] ? (
            <p className="text-muted-foreground mt-2 text-sm">
              {DESCRIPTIONS[draft.step]}
            </p>
          ) : null}
        </div>
        {controller.issues.length ? (
          <div
            ref={summary}
            role="alert"
            aria-label="Creation issues"
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
                        Try again
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
                        Review updated sources
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
            <p>
              The Starter Pack or creation defaults could not be loaded. Your
              draft is preserved.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void sources.options.refetch()}
            >
              Retry creation options
            </Button>
          </div>
        ) : null}
        {sources.options.data?.diagnostics.length ? (
          <div
            role="alert"
            className="mb-5 space-y-2 rounded-lg border p-3 text-sm"
          >
            <p>
              The Recommended Starter Pack needs repair. Your selections have
              not been replaced with a partial pack.
            </p>
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
          aria-label={`${HEADINGS[draft.step]} form`}
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
          {draft.step ? "Back" : "Cancel"}
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
            ? "Working…"
            : draft.step === 4
              ? "Create Anima"
              : `Continue to ${CREATION_STEPS[nextStep]}`}
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </>
  );

  const recoverySurface =
    controller.recovery === "loading" ? (
      <p role="status" className="p-8">
        Checking for a saved draft…
      </p>
    ) : controller.recovery === "resume" ||
      controller.recovery === "appearance" ||
      controller.recovery === "corrupt" ? (
      <section className="bg-card mx-auto max-w-xl space-y-4 rounded-2xl border p-6 shadow-sm sm:p-10">
        <h1 className="text-2xl font-semibold">
          {controller.recovery === "resume"
            ? "Continue your Anima?"
            : controller.recovery === "appearance"
              ? "Continue without creator images?"
              : "Your saved draft needs attention"}
        </h1>
        <p className="text-muted-foreground text-sm">
          {controller.recovery === "resume"
            ? "A draft was saved for this installation. Resume it, or explicitly start over. Saved uploads will stay in My Content."
            : controller.recovery === "appearance"
              ? "Profile and background images are no longer configured during Create Anima. Continue without those draft choices; any confirmed uploads remain in My Content and every other choice is preserved."
              : controller.storageError}
        </p>
        <div className="flex flex-wrap gap-2">
          {controller.recovery === "resume" ? (
            <Button onClick={controller.resume}>Resume saved draft</Button>
          ) : controller.recovery === "appearance" ? (
            <Button onClick={controller.continueWithoutImages}>
              Continue without images
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => setStartOver(true)}>
            Start over
          </Button>
          <Button variant="ghost" asChild>
            <Link to="/create">Creator hub</Link>
          </Button>
        </div>
      </section>
    ) : controller.locked ? (
      <section className="bg-card mx-auto max-w-xl space-y-4 rounded-2xl border p-6 shadow-sm sm:p-10">
        <h1 className="text-2xl font-semibold">
          {draft.submission?.state === "deleted"
            ? "This Anima was deleted"
            : draft.submission?.state === "conflict"
              ? "Creation request conflict"
              : controller.busy
                ? "Creating your Anima…"
                : "Check your creation result"}
        </h1>
        <p className="text-muted-foreground text-sm">
          {draft.submission?.state === "deleted"
            ? "The original creation succeeded, but that Anima was later deleted. Nothing has been recreated."
            : draft.submission?.state === "conflict"
              ? "This key was already used with a different payload. Editing and automatic retries are stopped; the original request has been preserved."
              : "The original request is saved. Check its result before changing this draft; retrying uses exactly the same request and cannot create a duplicate."}
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
              {controller.busy ? "Checking…" : "Check creation result"}
            </Button>
          ) : null}
          {draft.submission?.state === "deleted" ? (
            <Button variant="outline" onClick={() => setStartOver(true)}>
              Acknowledge and start over
            </Button>
          ) : null}
          <Button variant="ghost" asChild>
            <Link to="/create">Creator hub</Link>
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
              />
            ) : (
              <p className="text-muted-foreground p-6 text-sm">
                Preparing preview space…
              </p>
            )
          }
        />
      )}
      <Dialog open={startOver} onOpenChange={setStartOver}>
        <DialogContent>
          <DialogTitle>Start a new draft?</DialogTitle>
          <DialogDescription>
            This discards the saved draft, not your confirmed My Content
            uploads. A previously deleted creation will not be recreated.
          </DialogDescription>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStartOver(false)}>
              Keep draft
            </Button>
            <Button
              onClick={() => {
                controller.discard(draft.submission?.state === "deleted");
                setStartOver(false);
              }}
            >
              Start over
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
              ? "Leave while creation is unresolved?"
              : "Leave your Anima draft?"}
          </DialogTitle>
          <DialogDescription>
            {controller.locked
              ? "The frozen request must be kept. Return to Check creation result before starting another creation. Leaving does not cancel a request already sent."
              : "Save this draft to continue later, or discard it. Confirmed uploads stay in My Content."}
          </DialogDescription>
          <DialogFooter className="sm:flex-nowrap">
            <Button variant="outline" onClick={() => blocker.reset?.()}>
              Keep editing
            </Button>
            {!controller.locked && !controller.busy ? (
              <Button variant="outline" onClick={() => leave(true)}>
                Discard draft
              </Button>
            ) : null}
            <Button onClick={() => leave(false)}>
              {controller.locked
                ? "Leave and keep request"
                : "Save draft and leave"}
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
            <DialogTitle>Accept updated source revisions?</DialogTitle>
            <DialogDescription>
              {controller.repair.kind === "policy"
                ? "This updates only the fixed Starter Pack identity and default Idle policy. Your exact Gesture and Reaction selections will not be reset."
                : "The source and its complete dependency closure will use the current revisions shown here. Your other selections stay unchanged. Recheck the whole draft afterward."}
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
                Keep pinned revisions
              </Button>
              <Button onClick={() => void controller.acceptRepair()}>
                Accept updated revisions
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </AppShellPage>
  );
}
