// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useAvatarLoadSettings,
  type AvatarLoadSettings,
} from "./useAvatarSettings";

const mocks = vi.hoisted(() => ({
  runtimeKind: "desktop" as "desktop" | "self_hosted_web" | "hosted",
  getAvatarSettings: vi.fn(),
}));

vi.mock("@/app/runtime/RuntimeOwnerContext", () => ({
  useRuntimeCacheKey: () => "owner",
}));
vi.mock("@animama/product-ui", () => ({
  useProductApiClient: () => ({}),
}));
vi.mock("@/query/hooks/useRuntimeCapabilities", () => ({
  useRuntimeCapabilities: () => ({
    data: { runtime_kind: mocks.runtimeKind },
    isLoading: false,
  }),
}));
vi.mock("@animama/runtime-contracts/sdk", () => ({
  getAvatarSettings: mocks.getAvatarSettings,
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let latest: AvatarLoadSettings | null = null;

function Probe({
  itemId,
  onSettings,
}: {
  itemId: string | null;
  onSettings: (settings: AvatarLoadSettings) => void;
}) {
  const settings = useAvatarLoadSettings(itemId);
  useEffect(() => onSettings(settings));
  return null;
}

function render(itemId: string | null) {
  const client = new QueryClient();
  act(() => {
    root = createRoot(document.createElement("div"));
    root.render(
      <QueryClientProvider client={client}>
        <Probe
          itemId={itemId}
          onSettings={(settings) => {
            latest = settings;
          }}
        />
      </QueryClientProvider>,
    );
  });
}

/** Wait `count` short ticks, or until `done` holds. */
async function settle(count: number, done: () => boolean = () => false) {
  for (let tick = 0; tick < count && !done(); tick += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

const stored = {
  item_id: "avatar-1",
  spring_mode: "off",
  spring_mode_source: "stored",
  material_mode: "simple",
  material_mode_source: "stored",
};

beforeEach(() => {
  mocks.runtimeKind = "desktop";
  mocks.getAvatarSettings.mockReset();
  latest = null;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

describe("useAvatarLoadSettings", () => {
  it("waits for a local runtime's stored settings, then loads with them", async () => {
    mocks.getAvatarSettings.mockResolvedValue({ data: stored });
    render("avatar-1");
    expect(latest?.materialMode).toBeNull();

    await settle(200, () => latest?.materialMode !== null);
    expect(mocks.getAvatarSettings).toHaveBeenCalledWith(
      expect.objectContaining({ path: { item_id: "avatar-1" } }),
    );
    expect(latest?.materialMode).toBe("simple");
    expect(latest?.springMode).toBe("off");
    expect(latest?.springModeRef.current).toBe("off");
  });

  it("never calls the local-only route in the hosted app", async () => {
    mocks.runtimeKind = "hosted";
    render("avatar-1");
    await settle(5);
    expect(mocks.getAvatarSettings).not.toHaveBeenCalled();
    expect(latest?.materialMode).toBe("automatic");
    expect(latest?.springMode).toBe("automatic");
  });

  it("loads with Automatic when the read fails, without retrying", async () => {
    mocks.getAvatarSettings.mockRejectedValue(new Error("offline"));
    render("avatar-1");
    await settle(200, () => latest?.materialMode !== null);
    await settle(5);
    expect(mocks.getAvatarSettings).toHaveBeenCalledTimes(1);
    expect(latest?.materialMode).toBe("automatic");
  });

  it("uses Automatic at once for an unsaved file", () => {
    render(null);
    expect(mocks.getAvatarSettings).not.toHaveBeenCalled();
    expect(latest?.materialMode).toBe("automatic");
  });
});
