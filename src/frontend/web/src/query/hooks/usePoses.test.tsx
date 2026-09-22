import { type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
  type UseQueryOptions,
} from "@tanstack/react-query";
import type { PyPose, PyPosePage } from "@animama/runtime-contracts/api-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeOwnerProvider } from "@/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";
import { usePose, usePoses } from "./usePoses";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  preview: vi.fn(),
  prepare: vi.fn(),
  options: [] as unknown[],
}));
vi.mock("@animama/runtime-contracts/sdk", async (original) => ({
  ...(await original<typeof import("@animama/runtime-contracts/sdk")>()),
  listPoses: mocks.list,
  getPose: mocks.get,
  previewPose: mocks.preview,
  prepareContentPreviews: mocks.prepare,
}));
vi.mock("@tanstack/react-query", async (original) => {
  const query = await original<typeof import("@tanstack/react-query")>();
  return {
    ...query,
    useQuery: (options: UseQueryOptions) => {
      mocks.options.push(options);
      return query.useQuery(options);
    },
  };
});
const clients: QueryClient[] = [];
const cleanups: Array<() => void> = [];
function createClient() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  clients.push(client);
  return client;
}
function pose(
  id: string,
  source: PyPose["source"],
  name: string,
  description?: string,
): PyPose {
  return {
    item_id: id,
    source,
    name,
    description,
    kind: "pose",
    pose_id: id,
    editable: source === "local",
    revision_sha256: "a".repeat(64),
    files: [],
    dependencies: [],
  };
}
const included = pose("starter", "included", "Peace Sign", "Left hand");
const local = pose("local", "local", "Arms Crossed", "Confident pose");
const secondLocal = pose("other-local", "local", "Wave", "Friendly greeting");
function ListProbe({ input }: { input?: Parameters<typeof usePoses>[0] }) {
  usePoses(input);
  return null;
}
function DetailProbe({ id }: { id: string | null }) {
  usePose(id);
  return null;
}

/** Render real hooks/context, then subscribe with TanStack's observer in Node.
 * SSR does not mount subscriptions; the observer exercises actual enabled/cache/
 * fetch behavior without adding a synthetic DOM dependency.
 */
function observe<T>(
  client: QueryClient,
  owner: string | null,
  children: ReactNode,
) {
  mocks.options.length = 0;
  renderToStaticMarkup(
    <QueryClientProvider client={client}>
      {owner === null ? (
        children
      ) : (
        <RuntimeOwnerProvider ownerId={owner}>{children}</RuntimeOwnerProvider>
      )}
    </QueryClientProvider>,
  );
  expect(mocks.options).toHaveLength(1);
  const observer = new QueryObserver<T>(
    client,
    mocks.options[0] as UseQueryOptions<T>,
  );
  cleanups.push(observer.subscribe(() => {}));
  return observer;
}
beforeEach(() => {
  mocks.list
    .mockReset()
    .mockResolvedValue({ data: { items: [secondLocal, included, local] } });
  mocks.get.mockReset().mockResolvedValue({ data: local });
  mocks.preview.mockReset();
  mocks.prepare.mockReset();
});
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  clients.splice(0).forEach((client) => client.clear());
  vi.unstubAllGlobals();
});

describe("content-backed pose queries", () => {
  it("waits for the runtime owner and respects an explicitly disabled list", async () => {
    const client = createClient();
    const unavailable = observe<PyPosePage>(client, null, <ListProbe />);
    const disabled = observe<PyPosePage>(
      client,
      "owner",
      <ListProbe input={{ enabled: false }} />,
    );
    await Promise.resolve();
    expect(unavailable.getCurrentResult().fetchStatus).toBe("idle");
    expect(disabled.getCurrentResult().fetchStatus).toBe("idle");
    expect(mocks.list).not.toHaveBeenCalled();
    const ready = observe<PyPosePage>(client, "owner", <ListProbe />);
    await vi.waitFor(() =>
      expect(ready.getCurrentResult().isSuccess).toBe(true),
    );
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });
  it.each([
    { origin: "builtin" as const, query: " PEACE ", expected: [included] },
    { origin: "owned" as const, query: "arms", expected: [local] },
    { origin: "all" as const, query: "fRiEnDlY", expected: [secondLocal] },
    { origin: "owned" as const, query: "Peace", expected: [] },
  ])(
    "filters $origin poses using normalized name or description search",
    async ({ origin, query, expected }) => {
      const observer = observe<PyPosePage>(
        createClient(),
        "owner",
        <ListProbe input={{ origin, query }} />,
      );
      await vi.waitFor(() =>
        expect(observer.getCurrentResult().isSuccess).toBe(true),
      );
      expect(observer.getCurrentResult().data?.items).toEqual(expected);
    },
  );
  it("sorts list metadata without acquiring previews, details or registered payload bytes", async () => {
    const fetch = vi.fn(() => {
      throw new Error("Unexpected byte request while listing");
    });
    vi.stubGlobal("fetch", fetch);
    const observer = observe<PyPosePage>(
      createClient(),
      "owner",
      <ListProbe />,
    );
    await vi.waitFor(() =>
      expect(observer.getCurrentResult().isSuccess).toBe(true),
    );
    expect(observer.getCurrentResult().data?.items).toEqual([
      local,
      included,
      secondLocal,
    ]);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("requires an owner and selected item before reading detail metadata", async () => {
    const client = createClient();
    observe<PyPose>(client, null, <DetailProbe id="local" />);
    observe<PyPose>(client, "owner", <DetailProbe id={null} />);
    await Promise.resolve();
    expect(mocks.get).not.toHaveBeenCalled();
    const observer = observe<PyPose>(
      client,
      "owner",
      <DetailProbe id="local" />,
    );
    await vi.waitFor(() =>
      expect(observer.getCurrentResult().data).toEqual(local),
    );
    expect(mocks.get).toHaveBeenCalledWith(
      expect.objectContaining({ path: { item_id: "local" } }),
    );
    expect(mocks.preview).not.toHaveBeenCalled();
  });
  it("does not show a prior owner's list or detail while the next owner's requests are pending", async () => {
    const client = createClient();
    mocks.list.mockResolvedValueOnce({ data: { items: [local] } });
    const firstList = observe<PyPosePage>(client, "owner-a", <ListProbe />);
    const firstDetail = observe<PyPose>(
      client,
      "owner-a",
      <DetailProbe id="local" />,
    );
    await vi.waitFor(() => {
      expect(firstList.getCurrentResult().data?.items).toEqual([local]);
      expect(firstDetail.getCurrentResult().data).toEqual(local);
    });
    const otherOwnerPose = { ...local, name: "Other owner's pose" };
    let finishList!: (value: { data: PyPosePage }) => void;
    let finishDetail!: (value: { data: PyPose }) => void;
    mocks.list.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishList = resolve;
        }),
    );
    mocks.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishDetail = resolve;
        }),
    );
    const nextList = observe<PyPosePage>(client, "owner-b", <ListProbe />);
    const nextDetail = observe<PyPose>(
      client,
      "owner-b",
      <DetailProbe id="local" />,
    );
    expect(nextList.getCurrentResult().data).toBeUndefined();
    expect(nextDetail.getCurrentResult().data).toBeUndefined();
    finishList({ data: { items: [otherOwnerPose] } });
    finishDetail({ data: otherOwnerPose });
    await vi.waitFor(() => {
      expect(nextList.getCurrentResult().data?.items).toEqual([otherOwnerPose]);
      expect(nextDetail.getCurrentResult().data).toEqual(otherOwnerPose);
    });
    expect(
      client.getQueryData<PyPosePage>(queryKeys.poses.list("owner-a"))?.items,
    ).toEqual([local]);
    expect(
      client.getQueryData<PyPose>(queryKeys.poses.detail("owner-a", "local")),
    ).toEqual(local);
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });
});
