// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CREATOR_TEMPLATE_DRAFT_BASELINE,
  creatorTemplateRecoveryKey,
  useCreatorTemplateStart,
} from "./useCreatorTemplateStart";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Snapshot = { name: string; body: string };
type Props = Parameters<typeof useCreatorTemplateStart<Snapshot>>[0];

const seed: Snapshot = { name: "Sparkle 1", body: "template" };
const edited: Snapshot = { name: "Sparkle 1", body: "edited" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function render(initial: Props) {
  const result = {
    current: null as unknown as ReturnType<
      typeof useCreatorTemplateStart<Snapshot>
    >,
  };
  function Harness(props: Props) {
    result.current = useCreatorTemplateStart(props);
    return null;
  }
  let root!: Root;
  act(() => {
    root = createRoot(document.createElement("div"));
    root.render(<Harness {...initial} />);
  });
  return {
    result,
    rerender: (props: Props) => act(() => root.render(<Harness {...props} />)),
    unmount: () => act(() => root.unmount()),
  };
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

function setup(overrides: Partial<Props> = {}) {
  const loading = deferred<Snapshot>();
  const props: Props = {
    templateId: "sparkle",
    loadSeed: vi.fn(() => loading.promise),
    fingerprint: (snapshot) => JSON.stringify(snapshot),
    recoveryReady: false,
    recoveredDraft: null,
    resetSession: vi.fn(async () => true),
    install: vi.fn(),
    baselineRef: { current: "clean" },
    setHydration: vi.fn(),
    ...overrides,
  };
  return { loading, props };
}

/** The creator received `snapshot` as an unsaved draft from `source`. */
function expectStarted(
  props: Props,
  snapshot: Snapshot,
  source: "template" | "draft",
) {
  expect(props.install).toHaveBeenCalledExactlyOnceWith(snapshot);
  expect(props.baselineRef.current).toBe(CREATOR_TEMPLATE_DRAFT_BASELINE);
  expect(props.setHydration).toHaveBeenCalledExactlyOnceWith({
    state: "ready",
    message: source === "draft" ? "Recovered local draft" : null,
  });
}

describe("useCreatorTemplateStart", () => {
  let unmount: (() => void) | null = null;
  afterEach(() => {
    unmount?.();
    unmount = null;
  });

  it("keys template drafts apart from the plain new draft", () => {
    expect(creatorTemplateRecoveryKey("eye_vv")).toBe("new:template:eye_vv");
    expect(creatorTemplateRecoveryKey("eye_vv")).not.toBe(
      creatorTemplateRecoveryKey("star"),
    );
  });

  it("loads the template once when a re-render supplies a new loader", async () => {
    const { loading, props } = setup();
    const hook = render(props);
    unmount = hook.unmount;
    const replacement = vi.fn(() => loading.promise);
    hook.rerender({ ...props, loadSeed: replacement });
    loading.resolve(seed);
    await settle();
    expect(props.loadSeed).toHaveBeenCalledTimes(1);
    expect(replacement).not.toHaveBeenCalled();
  });

  it("does nothing without a template", async () => {
    const { props } = setup({ templateId: undefined, recoveryReady: true });
    const hook = render(props);
    unmount = hook.unmount;
    await settle();
    expect(props.loadSeed).not.toHaveBeenCalled();
    expect(props.install).not.toHaveBeenCalled();
    expect(hook.result.current.status).toBe("inactive");
  });

  it("installs the template once recovery has loaded without a draft", async () => {
    const { loading, props } = setup();
    const hook = render(props);
    unmount = hook.unmount;
    loading.resolve(seed);
    await settle();
    expect(props.install).not.toHaveBeenCalled();
    expect(hook.result.current.status).toBe("loading");

    hook.rerender({ ...props, recoveryReady: true });
    await settle();
    expectStarted(props, seed, "template");
    expect(props.loadSeed).toHaveBeenCalledWith("sparkle", expect.anything());
    expect(hook.result.current.status).toBe("ready");
  });

  it("silently continues a draft that still equals the template", async () => {
    const { loading, props } = setup({
      recoveryReady: true,
      recoveredDraft: { ...seed },
    });
    const hook = render(props);
    unmount = hook.unmount;
    loading.resolve(seed);
    await settle();
    expectStarted(props, { ...seed }, "draft");
    expect(hook.result.current.status).toBe("ready");
  });

  it("asks before replacing a changed draft, and can continue it", async () => {
    const { loading, props } = setup({
      recoveryReady: true,
      recoveredDraft: edited,
    });
    const hook = render(props);
    unmount = hook.unmount;
    loading.resolve(seed);
    await settle();
    expect(hook.result.current.status).toBe("choosing");
    expect(props.install).not.toHaveBeenCalled();

    act(() => hook.result.current.continueDraft());
    expectStarted(props, edited, "draft");
    expect(props.resetSession).not.toHaveBeenCalled();
    expect(hook.result.current.status).toBe("ready");
  });

  it("discards a changed draft and its recovery to start from the template", async () => {
    const { loading, props } = setup({
      recoveryReady: true,
      recoveredDraft: edited,
    });
    const hook = render(props);
    unmount = hook.unmount;
    loading.resolve(seed);
    await settle();

    await act(() => hook.result.current.startFromTemplate());
    expect(props.resetSession).toHaveBeenCalledExactlyOnceWith(seed);
    expectStarted(props, seed, "template");
    expect(hook.result.current.status).toBe("ready");
  });

  it("keeps asking when discarding the draft is refused", async () => {
    const { loading, props } = setup({
      recoveryReady: true,
      recoveredDraft: edited,
      resetSession: vi.fn(async () => false),
    });
    const hook = render(props);
    unmount = hook.unmount;
    loading.resolve(seed);
    await settle();

    await act(() => hook.result.current.startFromTemplate());
    expect(props.install).not.toHaveBeenCalled();
    expect(hook.result.current.status).toBe("choosing");
  });

  it("reports a template that cannot be loaded", async () => {
    const { loading, props } = setup({ recoveryReady: true });
    const hook = render(props);
    unmount = hook.unmount;
    loading.reject(new Error("Template gone."));
    await settle();
    expect(props.setHydration).toHaveBeenCalledExactlyOnceWith({
      state: "error",
      message: "Template gone.",
    });
    expect(props.install).not.toHaveBeenCalled();
    expect(hook.result.current.status).toBe("error");
  });

  it("still offers a draft when its template cannot be loaded", async () => {
    const { loading, props } = setup({
      recoveryReady: true,
      recoveredDraft: edited,
    });
    const hook = render(props);
    unmount = hook.unmount;
    loading.reject(new Error("Template gone."));
    await settle();
    expect(hook.result.current.status).toBe("choosing");
    expect(hook.result.current.seedError).toBe("Template gone.");

    await act(() => hook.result.current.startFromTemplate());
    expect(props.resetSession).not.toHaveBeenCalled();
    act(() => hook.result.current.continueDraft());
    expectStarted(props, edited, "draft");
    expect(props.setHydration).not.toHaveBeenCalledWith(
      expect.objectContaining({ state: "error" }),
    );
  });
});
