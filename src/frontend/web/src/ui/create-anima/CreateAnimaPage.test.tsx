import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CreateAnimaPage } from "./CreateAnimaPage";
import { buildAnimaSpec } from "./createAnimaDraft";
import { freezeCreation } from "./createAnimaSubmission";
import { readyDraft } from "./createAnimaTestFixtures";

const mocks = vi.hoisted(() => ({
  owner: vi.fn(),
  controller: vi.fn(),
  submit: vi.fn(),
}));
vi.mock("@/app/runtime/RuntimeOwnerContext", () => ({
  useRuntimeCacheKey: mocks.owner,
}));
vi.mock("@/query/hooks/useAnimaCreation", () => ({
  creationEvidence: vi.fn(),
}));
vi.mock("./useCreateAnimaController", () => ({
  useCreateAnimaController: mocks.controller,
  creationDraftSignature: () => "signature",
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
  useBlocker: () => ({ status: "idle" }),
}));
vi.mock("@/ui/app/AppShellPage", () => ({
  AppShellPage: ({
    children,
    className,
    sidebarBehavior,
  }: {
    children: ReactNode;
    className?: string;
    sidebarBehavior?: string;
  }) => (
    <main className={className} data-sidebar-behavior={sidebarBehavior}>
      {children}
    </main>
  ),
}));
vi.mock("@/ui/content-preview/ContentPreviewDockProvider", () => ({
  useContentPreviewDock: () => ({ expireSession: vi.fn() }),
}));
vi.mock("./CreateAnimaAvatarStep", () => ({
  CreateAnimaAvatarStep: () => <div>Avatar form</div>,
}));
vi.mock("./CreateAnimaVoiceStep", () => ({
  CreateAnimaVoiceStep: () => <div>Voice form</div>,
}));
vi.mock("./CreateAnimaIdentityStep", () => ({
  CreateAnimaIdentityStep: () => <div>Identity form</div>,
}));
vi.mock("./CreateAnimaActionsStep", () => ({
  CreateAnimaActionsStep: () => <div>Actions form</div>,
}));
vi.mock("./CreateAnimaReviewStep", () => ({
  CreateAnimaReviewStep: () => <div>Review form</div>,
}));
vi.mock("./CreateAnimaStage", () => ({ CreateAnimaStage: () => <canvas /> }));
vi.mock("./CreateAnimaCompletion", () => ({
  CreateAnimaCompletion: ({ animaId }: { animaId: string }) => (
    <p>Open existing {animaId}</p>
  ),
}));

function state(overrides: Record<string, unknown> = {}) {
  return {
    draft: readyDraft(),
    sources: { options: {}, avatars: {} },
    operations: { resolve: vi.fn() },
    recovery: "ready",
    locked: false,
    busy: false,
    conflict: false,
    completedId: null,
    issues: [],
    focusErrors: 0,
    focus: null,
    valid: null,
    returnToReview: false,
    message: null,
    storageError: null,
    identityLimit: 32768,
    displayNameLimit: 40,
    repair: null,
    submit: mocks.submit,
    edit: vi.fn(),
    go: vi.fn(),
    setFile: vi.fn(),
    chooseAvatar: vi.fn(),
    setWorking: vi.fn(),
    resetActions: vi.fn(),
    focusIssue: vi.fn(),
    proposeRepair: vi.fn(),
    continueWithoutImages: vi.fn(),
    ...overrides,
  };
}
beforeEach(() => {
  mocks.owner.mockReturnValue("owner");
  mocks.submit.mockClear();
  mocks.controller.mockReturnValue(state());
});

describe("Create Anima route states", () => {
  it.each([
    "Choose an Avatar",
    "Choose a voice",
    "Define their Identity",
    "Choose Actions",
    "Review Anima",
  ])("renders %s in the app shell", (heading) => {
    const step = [
      "Choose an Avatar",
      "Choose a voice",
      "Define their Identity",
      "Choose Actions",
      "Review Anima",
    ].indexOf(heading);
    mocks.controller.mockReturnValue(
      state({ draft: { ...readyDraft(), step } }),
    );
    const html = renderToStaticMarkup(
      <CreateAnimaPage avatar="library-avatar" />,
    );
    expect(html).toContain(heading);
    expect(html).toContain('aria-label="Anima creation progress"');
    expect(html).not.toContain("Creator hub");
    expect(html).not.toContain("radial-gradient");
    expect(html).toContain("bg-background");
    expect(html).toContain('data-sidebar-behavior="adaptive-canvas"');
    expect(html).toContain("--app-shell-sidebar-inset");
    expect(html.match(/id="creation-display-name"/g)).toHaveLength(1);
    expect(html).toContain("/ 40");
    expect(html).toContain('data-testid="create-anima-footer"');
    expect(html).toContain('data-testid="create-anima-panel-body"');
    expect(html).toContain("flex-1 overflow-y-auto");
    expect(html).toContain("sticky bottom-0");
    if (step === 0)
      expect(html).not.toContain(
        "Start with an Avatar, then make them your own",
      );
    if (step === 4)
      expect(html).not.toContain(
        "Review your choices before creating your Anima",
      );
    expect(html).not.toContain('/animas"');
    expect(mocks.controller).toHaveBeenCalledWith("owner", "library-avatar");
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("does not mount the feature while the local runtime owner is absent", () => {
    mocks.owner.mockReturnValue(null);
    expect(renderToStaticMarkup(<CreateAnimaPage />)).toContain(
      "local runtime is unavailable",
    );
    expect(mocks.controller).not.toHaveBeenCalled();
  });
  it("shows linked errors without the redundant attention heading", () => {
    mocks.controller.mockReturnValue(
      state({
        issues: [
          {
            code: "draft_invalid",
            path: "/display_name",
            message: "Enter a name.",
          },
        ],
        focusErrors: 1,
      }),
    );
    const html = renderToStaticMarkup(<CreateAnimaPage />);
    expect(html).toContain('aria-label="Creation issues"');
    expect(html).toContain("Enter a name.");
    expect(html).toContain("text-destructive text-left underline");
    expect(html).not.toContain("A few things need attention");
  });
  it("requires explicit resume and disables Create until exact preflight succeeds", () => {
    mocks.controller.mockReturnValue(state({ recovery: "resume" }));
    const resume = renderToStaticMarkup(<CreateAnimaPage />);
    expect(resume).toContain("Resume saved draft");
    expect(resume).toContain("Start over");
    expect(resume).toContain(
      "bg-background flex min-h-full items-center justify-center",
    );
    expect(resume).not.toContain(
      "bg-muted/20 flex min-h-full items-center justify-center",
    );
    expect(resume).not.toContain("Avatar form");
    mocks.controller.mockReturnValue(
      state({ draft: { ...readyDraft(), step: 4 } }),
    );
    const html = renderToStaticMarkup(<CreateAnimaPage />);
    const create = html
      .match(/<button\b[^>]*>[\s\S]*?<\/button>/g)
      ?.find((button) => button.includes("Create Anima"));
    expect(create).toContain('disabled=""');
  });
  it("requires explicit confirmation before dropping retired image choices", () => {
    mocks.controller.mockReturnValue(state({ recovery: "appearance" }));
    const html = renderToStaticMarkup(<CreateAnimaPage />);
    expect(html).toContain("Continue without images");
    expect(html).toContain("confirmed uploads remain in My Content");
    expect(html).not.toContain("Avatar form");
    expect(html).not.toContain("<canvas");
  });
  it.each(["pending", "unknown", "conflict", "deleted"] as const)(
    "renders safe %s recovery without editable controls or automatic dispatch",
    (status) => {
      const draft = readyDraft();
      draft.submission = {
        state: status,
        request: freezeCreation(draft, buildAnimaSpec(draft)),
      };
      mocks.controller.mockReturnValue(state({ draft, locked: true }));
      const html = renderToStaticMarkup(<CreateAnimaPage />);
      expect(html).not.toContain("Avatar form");
      expect(html).not.toContain("<canvas");
      expect(html).not.toContain("Continue to Identity");
      if (["pending", "unknown"].includes(status))
        expect(html).toContain("Check creation result");
      if (status === "deleted")
        expect(html).toContain("Acknowledge and start over");
      if (status === "conflict")
        expect(html).toContain("Creation request conflict");
      expect(mocks.submit).not.toHaveBeenCalled();
    },
  );
  it("opens only the committed result after success, with no creator stage or controls", () => {
    mocks.controller.mockReturnValue(state({ completedId: "anima-committed" }));
    const html = renderToStaticMarkup(<CreateAnimaPage />);
    expect(html).toContain("Open existing anima-committed");
    expect(html).not.toContain("Avatar form");
    expect(html).not.toContain("<canvas");
  });
});
