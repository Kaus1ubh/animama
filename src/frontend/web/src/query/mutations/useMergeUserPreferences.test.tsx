// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SettingsPreferences } from "@/lib/settings/preferences";
import { useMergeUserPreferences } from "@/query/mutations/useUpdateUserSettings";

/** The server's saved preferences; each PATCH replaces them whole. */
const server = vi.hoisted(() => ({
  preferences: {} as Record<string, unknown>,
}));

vi.mock("@animama/product-ui", () => ({
  useProductApiClient: () => ({}),
}));
vi.mock("@/app/runtime/RuntimeOwnerContext", () => ({
  useRuntimeCacheKey: () => "owner",
}));
vi.mock("@animama/runtime-contracts/sdk", () => ({
  getUserSettingsV1UsersMeSettingsGet: async () => ({
    data: { preferences: structuredClone(server.preferences) },
  }),
  patchUserSettingsV1UsersMeSettingsPatch: async ({
    body,
  }: {
    body: { preferences: Record<string, unknown> };
  }) => {
    // Let other requests interleave, as on the network.
    await new Promise((resolve) => setTimeout(resolve, 5));
    server.preferences = structuredClone(body.preferences);
    return { data: { preferences: structuredClone(server.preferences) } };
  },
}));

describe("useMergeUserPreferences", () => {
  let container: HTMLDivElement;
  let root: Root;
  let merge: (patch: SettingsPreferences) => Promise<unknown>;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    server.preferences = {};
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const queryClient = new QueryClient();
    function Harness() {
      merge = useMergeUserPreferences().mutateAsync;
      return null;
    }
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Harness />
        </QueryClientProvider>,
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("keeps every patch when saves overlap", async () => {
    await act(async () => {
      await Promise.all([
        merge({ presentation: { camera_preset: "full-body" } }),
        merge({ presentation: { pip_camera_preset: "portrait" } }),
        merge({ presentation: { pip_camera_preset: "full-body-close" } }),
      ]);
    });

    expect(server.preferences).toEqual({
      presentation: {
        camera_preset: "full-body",
        pip_camera_preset: "full-body-close",
      },
    });
  });
});
