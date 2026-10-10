// @vitest-environment happy-dom
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PyAnimaDispatchOptions,
  PyModelProviderCatalogItem,
} from "@animama/runtime-contracts/api-types";

import { ChatInputModelSelector } from "./chat-input";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/** External stores standing in for the Anima query and SettingsProvider. */
const fixture = vi.hoisted(() => {
  function store<T>(initial: T) {
    let value = initial;
    const listeners = new Set<() => void>();
    return {
      get: () => value,
      set: (next: T) => {
        value = next;
        for (const listener of listeners) listener();
      },
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
  }
  return {
    activeModelId: store(""),
    overrides: store<Partial<PyAnimaDispatchOptions>>({}),
    catalog: [] as PyModelProviderCatalogItem[],
    saveModel: vi.fn(),
  };
});

vi.mock("@/query/hooks/useAnima", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useAnima: () => {
      const id = useSyncExternalStore(
        fixture.activeModelId.subscribe,
        fixture.activeModelId.get,
      );
      return { data: { chat_profile: { default_model_provider_id: id } } };
    },
  };
});
vi.mock("@/query/hooks/useModelProviders", () => ({
  useModelProviders: () => ({ data: fixture.catalog, isSuccess: true }),
}));
vi.mock("@/query/hooks/useRuntimeCapabilities", () => ({
  useRuntimeCapabilities: () => ({ data: undefined }),
}));
vi.mock("@/query/mutations/useUpdateAnimaChatProfile", () => ({
  useUpdateAnimaChatProfile: () => ({
    isPending: false,
    mutateAsync: async (variables: {
      body: { default_model_provider_id: string };
    }) => {
      fixture.saveModel(variables.body.default_model_provider_id);
      fixture.activeModelId.set(variables.body.default_model_provider_id);
    },
  }),
}));
vi.mock("@/ui/settings/SettingsProvider", async () => {
  const { useSyncExternalStore } = await import("react");
  type Overrides = Partial<PyAnimaDispatchOptions>;
  return {
    useSettings: () => {
      const overrides = useSyncExternalStore(
        fixture.overrides.subscribe,
        fixture.overrides.get,
      );
      return {
        chatRequestOptions: Object.keys(overrides).length ? overrides : null,
        setChatRequestOverrides: (
          update: Overrides | ((current: Overrides) => Overrides),
        ) =>
          fixture.overrides.set(
            typeof update === "function"
              ? update(fixture.overrides.get())
              : update,
          ),
      };
    },
  };
});
// Render the picker and every row's settings popover inline, so the test
// drives the real checkboxes and radios without dialog or popover timing.
vi.mock("@/ui/components/model-selector", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    ModelSelector: Pass,
    ModelSelectorTrigger: Pass,
    ModelSelectorContent: ({ children }: { children?: ReactNode }) => (
      <div>{children}</div>
    ),
    ModelSelectorInput: () => null,
    ModelSelectorList: Pass,
    ModelSelectorEmpty: () => null,
    ModelSelectorGroup: Pass,
    ModelSelectorItem: ({
      children,
      value,
    }: {
      children?: ReactNode;
      value?: string;
    }) => <div data-row={value}>{children}</div>,
    ModelSelectorLogo: () => null,
    ModelSelectorName: Pass,
  };
});
vi.mock("@/ui/components/popover", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Popover: Pass,
    PopoverTrigger: Pass,
    PopoverContent: ({ children }: { children?: ReactNode }) => (
      <div>{children}</div>
    ),
  };
});
vi.mock("@/ui/components/tooltip", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return { Tooltip: Pass, TooltipTrigger: Pass, TooltipContent: () => null };
});

const EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"];
const LUNA = "OpenAIResponsesHTTPAgent:gpt-6-luna";
const HAIKU = "AnthropicMessagesHTTPAgent:claude-haiku-5-5";

const catalogRow = (
  id: string,
  extra: Partial<PyModelProviderCatalogItem>,
): PyModelProviderCatalogItem =>
  ({
    id,
    model: id.split(":")[1],
    model_label: id.split(":")[1],
    model_kind: "chat",
    source: "builtin",
    hidden: false,
    accepts: ["text"],
    produces: ["text"],
    supports_tools: true,
    supports_streaming: true,
    supports_reasoning: true,
    supported_reasoning_efforts: EFFORTS,
    requestable_native_tool_support: ["web_search"],
    context_window_tokens: 400000,
    ...extra,
  }) as PyModelProviderCatalogItem;

const luna = catalogRow(LUNA, {
  model_provider: "OpenAIResponsesHTTPAgent",
  connection_name: "OpenAI",
  api_standard: "responses",
  default_reasoning_effort: null,
});
const haiku = catalogRow(HAIKU, {
  model_provider: "AnthropicMessagesHTTPAgent",
  connection_name: "Anthropic",
  api_standard: "anthropic_messages",
  default_reasoning_effort: "medium",
});

let root: Root | null = null;
let container: HTMLElement | null = null;

async function renderPicker(activeModelId: string) {
  fixture.activeModelId.set(activeModelId);
  container = document.createElement("div");
  document.body.append(container);
  await act(async () => {
    root = createRoot(container!);
    root.render(<ChatInputModelSelector animaId="anima-1" />);
  });
}

/** The settings controls of one picker row, found by its model name. */
function row(model: string) {
  const element = [...document.querySelectorAll<HTMLElement>("[data-row]")]
    .filter((candidate) => candidate.dataset.row?.split(" ").includes(model))
    .at(0);
  if (!element) throw new Error(`No ${model} row`);
  return {
    webSearch: element.querySelector<HTMLButtonElement>(
      'button[role="checkbox"]',
    )!,
    effort: (value: string) =>
      element.querySelector<HTMLButtonElement>(
        `button[role="radio"][value="${value}"]`,
      )!,
    checkedEffort: () =>
      element
        .querySelector('button[role="radio"][aria-checked="true"]')
        ?.getAttribute("value"),
  };
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  fixture.catalog = [luna, haiku];
  fixture.overrides.set({});
  fixture.saveModel.mockReset();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("chat model picker settings", () => {
  it("starts each model at its own default effort", async () => {
    await renderPicker(LUNA);

    expect(fixture.overrides.get()).toEqual({
      native_tools: ["web_search"],
      reasoning_effort: "none",
    });
    expect(row("gpt-6-luna").checkedEffort()).toBe("none");
    // An inactive row's popover shows that row's default, not the active one's.
    expect(row("claude-haiku-5-5").checkedEffort()).toBe("medium");
  });

  it("switching from an inactive row's tools keeps that row's default effort", async () => {
    await renderPicker(LUNA);

    await click(row("claude-haiku-5-5").webSearch);

    expect(fixture.saveModel).toHaveBeenCalledWith(HAIKU);
    expect(fixture.overrides.get()).toEqual({
      native_tools: [],
      reasoning_effort: "medium",
    });
  });

  it("does not carry the Anthropic effort to an OpenAI row", async () => {
    await renderPicker(HAIKU);
    expect(fixture.overrides.get().reasoning_effort).toBe("medium");

    await click(row("gpt-6-luna").webSearch);

    expect(fixture.saveModel).toHaveBeenCalledWith(LUNA);
    expect(fixture.overrides.get()).toEqual({
      native_tools: [],
      reasoning_effort: "none",
    });
  });

  it("applies an effort chosen in an inactive row's popover", async () => {
    await renderPicker(LUNA);

    await click(row("claude-haiku-5-5").effort("low"));

    expect(fixture.saveModel).toHaveBeenCalledWith(HAIKU);
    expect(fixture.overrides.get()).toEqual({
      native_tools: ["web_search"],
      reasoning_effort: "low",
    });
  });

  it("keeps the active model's chosen effort when its tools change", async () => {
    await renderPicker(HAIKU);

    await click(row("claude-haiku-5-5").effort("high"));
    await click(row("claude-haiku-5-5").webSearch);

    expect(fixture.saveModel).not.toHaveBeenCalled();
    expect(fixture.overrides.get()).toEqual({
      native_tools: [],
      reasoning_effort: "high",
    });
  });
});
