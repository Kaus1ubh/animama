// @vitest-environment happy-dom
import { act, StrictMode, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RuntimeOwnerProvider } from "@web/app/runtime/RuntimeOwnerContext";
import type { PyExactContentSource } from "@/lib/content/catalogTypes";
import { useActionEditorActions } from "./useActionEditorActions";

const previewGesture = vi.hoisted(() => vi.fn());

vi.mock("@animama/runtime-contracts/sdk", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  previewGesture,
}));
vi.mock("@/lib/content/typedPreviewAdapters", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  typedActionPreview: (preview: unknown) => preview,
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const source = {
  type: "catalog",
  catalog_item_id: "have-an-idea-item",
  logical_key: "builtin:gesture:have-an-idea",
} as PyExactContentSource;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  previewGesture.mockReset();
});

/** Start one preview from a mount effect, as the creator's hydration does. */
function mountCreatorPreview() {
  let response!: {
    resolve: (value: { data: unknown }) => void;
    reject: (cause: Error) => void;
  };
  previewGesture.mockReturnValueOnce(
    new Promise((resolve, reject) => {
      response = { resolve, reject };
    }),
  );
  let actions!: ReturnType<typeof useActionEditorActions>;
  let loading: Promise<unknown> | null = null;
  function Probe() {
    actions = useActionEditorActions("gesture");
    const { load } = actions.actionPreview;
    useEffect(() => {
      // Like the creator's hydration ref, start the load only once even
      // though development StrictMode replays this mount effect.
      loading ??= load(source);
    }, [load]);
    return null;
  }
  act(() => {
    root = createRoot(document.createElement("div"));
    root.render(
      <StrictMode>
        <QueryClientProvider client={new QueryClient()}>
          <RuntimeOwnerProvider ownerId="owner" sessionKey="session">
            <Probe />
          </RuntimeOwnerProvider>
        </QueryClientProvider>
      </StrictMode>,
    );
  });
  return { actions: () => actions, loading: () => loading, response };
}

describe("Gesture and Reaction creator previews", () => {
  it("settle a preview the creator starts while mounting under StrictMode", async () => {
    const probe = mountCreatorPreview();
    // A pending preview keeps Save, New and Import disabled.
    expect(probe.actions().actionPreview.isPending).toBe(true);
    await act(async () => {
      probe.response.resolve({ data: { preview: "have-an-idea" } });
      await expect(probe.loading()).resolves.toEqual({
        preview: "have-an-idea",
      });
    });
    expect(probe.actions().actionPreview.isPending).toBe(false);
  });

  it("stop reporting a failed preview as pending", async () => {
    const probe = mountCreatorPreview();
    expect(probe.actions().actionPreview.isPending).toBe(true);
    await act(async () => {
      probe.response.reject(new Error("preview unavailable"));
      await expect(probe.loading()).rejects.toThrow("preview unavailable");
    });
    expect(probe.actions().actionPreview.isPending).toBe(false);
  });
});
