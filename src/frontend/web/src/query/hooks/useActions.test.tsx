import { renderToStaticMarkup } from "react-dom/server";
import {
  type InfiniteData,
  InfiniteQueryObserver,
  QueryClient,
  QueryClientProvider,
  type UseInfiniteQueryOptions,
} from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RuntimeOwnerProvider } from "@/app/runtime/RuntimeOwnerContext";
import type { PyGesturePage } from "@/lib/content/catalogTypes";
import { useGestures } from "./useActions";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  options: [] as unknown[],
}));
vi.mock("@animama/runtime-contracts/sdk", async (original) => ({
  ...(await original<typeof import("@animama/runtime-contracts/sdk")>()),
  listGestures: mocks.list,
}));
vi.mock("@tanstack/react-query", async (original) => {
  const query = await original<typeof import("@tanstack/react-query")>();
  return {
    ...query,
    useInfiniteQuery: (options: UseInfiniteQueryOptions) => {
      mocks.options.push(options);
      return query.useInfiniteQuery(options);
    },
  };
});

function gesture(
  id: string,
  source: "included" | "local",
  name: string,
  kind: "anima_clip" | "vrma",
) {
  return {
    item_id: id,
    kind: "gesture",
    logical_key: id,
    name,
    description: null,
    source,
    revision_sha256: "a".repeat(64),
    editable: source === "local",
    portability: "portable",
    dependencies: [],
    files: [],
    implementation: { kind },
  };
}

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

/** Render the real hook once to capture its options, then observe them in Node. */
function observe(
  client: QueryClient,
  input: Parameters<typeof useGestures>[0],
) {
  mocks.options.length = 0;
  function Probe() {
    useGestures(input);
    return null;
  }
  renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <RuntimeOwnerProvider ownerId="owner">
        <Probe />
      </RuntimeOwnerProvider>
    </QueryClientProvider>,
  );
  const observer = new InfiniteQueryObserver<
    PyGesturePage,
    Error,
    InfiniteData<PyGesturePage>
  >(client, mocks.options[0] as never);
  cleanups.push(observer.subscribe(() => {}));
  return observer;
}

const names = (observer: ReturnType<typeof observe>) =>
  observer
    .getCurrentResult()
    .data?.pages.flatMap((page) => page.items.map((item) => item.name));

describe("Gesture lists", () => {
  it("filter each search, origin and motion kind from one cached request", async () => {
    mocks.list.mockResolvedValue({
      data: {
        items: [
          gesture("wave", "included", "Wave Hello", "anima_clip"),
          gesture("bow", "included", "Polite Bow", "vrma"),
          gesture("mine", "local", "My Wave", "anima_clip"),
        ],
      },
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    const everything = observe(client, {});
    await vi.waitFor(() =>
      expect(names(everything)).toEqual([
        "My Wave",
        "Polite Bow",
        "Wave Hello",
      ]),
    );
    const search = observe(client, { query: " WAVE ", origin: "builtin" });
    const motion = observe(client, { implementationKind: "vrma" });
    await vi.waitFor(() => {
      expect(names(search)).toEqual(["Wave Hello"]);
      expect(names(motion)).toEqual(["Polite Bow"]);
    });
    expect(mocks.list).toHaveBeenCalledTimes(1);
    client.clear();
  });
});
