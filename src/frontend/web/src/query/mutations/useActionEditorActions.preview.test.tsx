// @vitest-environment happy-dom
import { act, StrictMode, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RuntimeOwnerProvider } from "@web/app/runtime/RuntimeOwnerContext";
import type { PyExactContentSource } from "@/lib/content/catalogTypes";
import { useActionEditorActions } from "./useActionEditorActions";

const response = vi.hoisted(() => {
  let resolve!: (value: { data: unknown }) => void;
  const promise = new Promise<{ data: unknown }>((done) => {
    resolve = done;
  });
  return { promise, resolve };
});

vi.mock("@animama/runtime-contracts/sdk", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  previewGesture: vi.fn(() => response.promise),
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
});

describe("Gesture and Reaction creator previews", () => {
  it("settle a preview the creator starts while mounting under StrictMode", async () => {
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
    // A pending preview keeps Save, New and Import disabled.
    expect(actions.actionPreview.isPending).toBe(true);
    await act(async () => {
      response.resolve({ data: { preview: "have-an-idea" } });
      await expect(loading).resolves.toEqual({ preview: "have-an-idea" });
    });
    expect(actions.actionPreview.isPending).toBe(false);
  });
});
