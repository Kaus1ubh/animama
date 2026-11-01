// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAutomaticEpisodeProcessing } from "@/query/hooks/useAutomaticEpisodeProcessing";
import { useUpdateAutomaticEpisodeProcessing } from "@/query/mutations/useAutomaticEpisodeProcessing";
import { queryKeys } from "@/query/keys";
import { AutomaticEpisodeProcessingSetting } from "@/ui/settings/BehaviorDataSettings";

const WAITING_STATUS: Record<string, unknown> = {
  threshold: 10,
  state: "waiting",
  pending_count: 3,
  runs_today: 0,
};

const mocks = vi.hoisted(() => ({
  available: true,
  status: {} as Record<string, unknown>,
  get: vi.fn(),
  put: vi.fn(),
}));

vi.mock("@animama/runtime-contracts/sdk", () => ({
  getAutomaticEpisodeProcessingV1MemoryAutomaticProcessingGet: mocks.get,
  updateAutomaticEpisodeProcessingV1MemoryAutomaticProcessingPut: mocks.put,
}));
vi.mock("@/query/hooks/useRuntimeCapabilities", () => ({
  useRuntimeCapabilities: () => ({
    data: { automatic_episode_processing: mocks.available },
  }),
}));
vi.mock("@/app/runtime/RuntimeOwnerContext", () => ({
  useRuntimeCacheKey: () => "owner",
}));
vi.mock("@animama/product-ui", () => ({
  useProductApiClient: () => ({ admitted: "composition client" }),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let client: QueryClient;

async function render(node: ReactNode) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <QueryClientProvider client={client}>{node}</QueryClientProvider>,
    );
  });
  // Let the query settle.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mocks.available = true;
  mocks.status = WAITING_STATUS;
  mocks.get.mockReset();
  mocks.put.mockReset();
  mocks.get.mockImplementation(async () => ({ data: mocks.status }));
  mocks.put.mockImplementation(
    async ({ body }: { body: { threshold: number } }) => ({
      data: { ...mocks.status, threshold: body.threshold },
    }),
  );
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  client.clear();
});

function StatusProbe() {
  const status = useAutomaticEpisodeProcessing();
  return <span>{status.data ? String(status.data.threshold) : "none"}</span>;
}

describe("automatic episode processing in the UI", () => {
  it("never requests the status where the runtime does not offer it", async () => {
    mocks.available = false;

    await render(<StatusProbe />);

    expect(mocks.get).not.toHaveBeenCalled();
    expect(container?.textContent).toBe("none");
  });

  it("reads the status where the runtime offers it", async () => {
    await render(<StatusProbe />);

    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(container?.textContent).toBe("10");
  });

  it("refreshes cached memory once an automatic run finishes", async () => {
    const episodesKey = queryKeys.memoryEpisodes.list("owner", {
      status: "pending",
      limit: 100,
    });
    const entriesKey = queryKeys.memoryEntries.all("owner");
    client.setQueryData(episodesKey, { items: [] });
    client.setQueryData(entriesKey, { items: [] });
    mocks.status = {
      ...WAITING_STATUS,
      state: "running",
      pending_count: 12,
      batch_size: 12,
    };
    await render(<StatusProbe />);
    expect(client.getQueryState(episodesKey)?.isInvalidated).toBe(false);

    // Another poll while the run continues leaves the memory caches alone.
    await act(async () => {
      await client.refetchQueries({
        queryKey: queryKeys.automaticEpisodeProcessing("owner"),
      });
    });
    expect(client.getQueryState(episodesKey)?.isInvalidated).toBe(false);

    mocks.status = { ...WAITING_STATUS, pending_count: 0 };
    await act(async () => {
      await client.refetchQueries({
        queryKey: queryKeys.automaticEpisodeProcessing("owner"),
      });
    });

    expect(client.getQueryState(episodesKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(entriesKey)?.isInvalidated).toBe(true);
  });

  it("refreshes cached episodes when fewer notes are pending", async () => {
    const episodesKey = queryKeys.memoryEpisodes.all("owner");
    client.setQueryData(episodesKey, { items: [] });
    mocks.status = { ...WAITING_STATUS, state: "ready", pending_count: 10 };
    await render(<StatusProbe />);

    // A whole run can start and finish between two polls.
    mocks.status = { ...WAITING_STATUS, pending_count: 0 };
    await act(async () => {
      await client.refetchQueries({
        queryKey: queryKeys.automaticEpisodeProcessing("owner"),
      });
    });

    expect(client.getQueryState(episodesKey)?.isInvalidated).toBe(true);
  });

  it("stores a new threshold and caches the returned status", async () => {
    const probe: {
      update?: ReturnType<typeof useUpdateAutomaticEpisodeProcessing>;
    } = {};
    function MutationProbe({
      onRender,
    }: {
      onRender: (
        update: ReturnType<typeof useUpdateAutomaticEpisodeProcessing>,
      ) => void;
    }) {
      onRender(useUpdateAutomaticEpisodeProcessing());
      return null;
    }
    await render(
      <MutationProbe onRender={(update) => (probe.update = update)} />,
    );

    await act(async () => {
      await probe.update?.mutateAsync(25);
    });

    expect(mocks.put).toHaveBeenCalledWith(
      expect.objectContaining({ body: { threshold: 25 } }),
    );
    expect(
      client.getQueryData(queryKeys.automaticEpisodeProcessing("owner")),
    ).toMatchObject({ threshold: 25 });
  });

  it("shows the state and is enabled once the status has loaded", async () => {
    mocks.status = {
      threshold: 10,
      state: "paused",
      pending_count: 12,
      runs_today: 3,
      last_error: "Model refused.",
    };

    await render(<AutomaticEpisodeProcessingSetting disabled={false} />);

    const trigger = container?.querySelector("button[role='combobox']");
    expect(trigger?.hasAttribute("disabled")).toBe(false);
    expect(container?.textContent).toContain(
      "Paused after repeated failures. Change this setting to try again. Last error: Model refused.",
    );
  });

  it("is disabled while the settings are busy or the status has not loaded", async () => {
    await render(<AutomaticEpisodeProcessingSetting disabled />);
    expect(
      container
        ?.querySelector("button[role='combobox']")
        ?.hasAttribute("disabled"),
    ).toBe(true);
    act(() => root?.unmount());
    container?.remove();

    mocks.get.mockImplementation(() => new Promise(() => undefined));
    client.clear();
    client = new QueryClient();
    await render(<AutomaticEpisodeProcessingSetting disabled={false} />);
    expect(
      container
        ?.querySelector("button[role='combobox']")
        ?.hasAttribute("disabled"),
    ).toBe(true);
  });
});
