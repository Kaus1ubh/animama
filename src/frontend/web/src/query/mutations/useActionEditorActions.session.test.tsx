// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";

import { RuntimeOwnerProvider } from "@/app/runtime/RuntimeOwnerContext";
import { privateStateResets } from "@/app/runtime/private-module-state";
import { createActionDocument } from "@/ui/action-editor/actionDocument";
import { useActionEditorActions } from "./useActionEditorActions";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

function mountActions() {
  let actions!: ReturnType<typeof useActionEditorActions>;
  function Probe() {
    actions = useActionEditorActions("gesture");
    return null;
  }
  act(() => {
    root = createRoot(document.createElement("div"));
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <RuntimeOwnerProvider ownerId="owner" sessionKey="session">
          <Probe />
        </RuntimeOwnerProvider>
      </QueryClientProvider>,
    );
  });
  return () => actions;
}

describe("Gesture and Reaction editor sessions", () => {
  it("drop a staged VRMA file when the browser session ends", async () => {
    const actions = mountActions();
    await act(() =>
      actions().beginSession.mutateAsync({
        document: createActionDocument("gesture"),
        operationId: "operation",
      }),
    );
    const stage = () =>
      actions().stageFile.mutateAsync({
        sessionId: "operation",
        file: new File(["private motion"], "wave.vrma"),
        role: "animation",
        sha256: "0".repeat(64),
      });
    await act(async () => {
      await expect(stage()).resolves.toMatchObject({ filename: "wave.vrma" });
    });
    for (const reset of privateStateResets()) reset();
    await act(async () => {
      await expect(stage()).rejects.toThrow("session expired");
    });
  });
});
