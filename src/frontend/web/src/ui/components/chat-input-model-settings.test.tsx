// @vitest-environment happy-dom
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PyAnimaDispatchOptions,
  PyModelProviderCatalogItem,
  WebSearchCapability,
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
    webSearch: undefined as WebSearchCapability | undefined,
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
  useRuntimeCapabilities: () => ({ data: { web_search: fixture.webSearch } }),
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
// Render the chooser and popovers inline to exercise real slider keyboard
// interaction and feature checkboxes independently of portal timing.
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
      onSelect,
      disabled,
    }: {
      children?: ReactNode;
      value?: string;
      onSelect?: () => void;
      disabled?: boolean;
    }) => (
      <button
        type="button"
        data-row={value}
        disabled={disabled}
        onClick={onSelect}
      >
        {children}
      </button>
    ),
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

async function renderPicker(
  activeModelId: string,
  props: Partial<React.ComponentProps<typeof ChatInputModelSelector>> = {},
) {
  fixture.activeModelId.set(activeModelId);
  container = document.createElement("div");
  document.body.append(container);
  await act(async () => {
    root = createRoot(container!);
    root.render(<ChatInputModelSelector animaId="anima-1" {...props} />);
  });
}

function row(model: string) {
  const element = [
    ...document.querySelectorAll<HTMLButtonElement>("[data-row]"),
  ].find((candidate) => candidate.dataset.row?.split(" ").includes(model));
  if (!element) throw new Error(`No ${model} row`);
  return element;
}

function slider() {
  return document.querySelector<HTMLElement>('[role="slider"]')!;
}

function webSearch() {
  return document.querySelector<HTMLButtonElement>('button[role="checkbox"]')!;
}

async function pressEffortKey(key: string) {
  await act(async () => {
    slider().focus();
    slider().dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true }),
    );
  });
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
  fixture.webSearch = undefined;
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("chat model picker settings", () => {
  it("starts at the selected model's default and exposes readable slider values", async () => {
    await renderPicker(LUNA);

    expect(fixture.overrides.get()).toEqual({
      native_tools: ["web_search"],
      reasoning_effort: "none",
    });
    expect(slider().getAttribute("aria-label")).toBe("Reasoning effort");
    expect(slider().getAttribute("aria-valuetext")).toBe("None");
    expect(slider().getAttribute("aria-valuemax")).toBe("5");
    expect(
      document.querySelector('[aria-label="Chat features"]'),
    ).not.toBeNull();
  });

  it("selecting a different model uses its own default effort and features", async () => {
    await renderPicker(LUNA);
    await pressEffortKey("End");
    await click(webSearch());
    await click(row("claude-haiku-5-5"));

    expect(fixture.saveModel).toHaveBeenCalledWith(HAIKU);
    expect(fixture.overrides.get()).toEqual({
      native_tools: ["web_search"],
      reasoning_effort: "medium",
    });
    expect(slider().getAttribute("aria-valuetext")).toBe("Medium");
  });

  it("does not carry the Anthropic effort to an OpenAI model", async () => {
    await renderPicker(HAIKU);
    await click(row("gpt-6-luna"));

    expect(fixture.saveModel).toHaveBeenCalledWith(LUNA);
    expect(fixture.overrides.get().reasoning_effort).toBe("none");
  });

  it("keeps the active model's chosen effort when its features change", async () => {
    await renderPicker(HAIKU);
    await pressEffortKey("ArrowRight");
    await click(webSearch());

    expect(fixture.saveModel).not.toHaveBeenCalled();
    expect(fixture.overrides.get()).toEqual({
      native_tools: [],
      reasoning_effort: "high",
    });
    await pressEffortKey("ArrowRight");
    expect(slider().getAttribute("aria-valuetext")).toBe("Extra high");
    expect(fixture.overrides.get().native_tools).toEqual([]);
  });

  it("reset restores the model default while preserving feature choices", async () => {
    await renderPicker(HAIKU);
    await click(webSearch());
    await pressEffortKey("End");
    await click(
      document.querySelector<HTMLButtonElement>(
        '[aria-label="Reset reasoning to model default"]',
      )!,
    );

    expect(fixture.overrides.get()).toEqual({
      native_tools: [],
      reasoning_effort: "medium",
    });
    expect(fixture.saveModel).not.toHaveBeenCalled();
  });

  it("retains confirmation for an incompatible chat without changing overrides", async () => {
    const onIncompatibleModelSelect = vi.fn();
    await renderPicker(LUNA, {
      activeChat: { id: "chat-1", api_standard: "responses" },
      onIncompatibleModelSelect,
    });
    await click(row("claude-haiku-5-5"));

    expect(onIncompatibleModelSelect).toHaveBeenCalledWith(haiku);
    expect(fixture.saveModel).not.toHaveBeenCalled();
    expect(fixture.overrides.get().reasoning_effort).toBe("none");
  });

  it("explains unavailable web search and omits a slider for fixed models", async () => {
    fixture.catalog = [
      {
        ...luna,
        requestable_native_tool_support: [],
        supported_reasoning_efforts: [],
        supports_reasoning: false,
      },
    ];
    fixture.webSearch = { configuration: true, configured: false };
    await renderPicker(LUNA);

    expect(slider()).toBeNull();
    expect(webSearch().disabled).toBe(true);
    expect(container?.textContent).toContain(
      "Set up web search in App Settings.",
    );
    expect(
      document.querySelector('[aria-label="Select model"]'),
    ).not.toBeNull();
    await click(webSearch());
    expect(fixture.overrides.get().native_tools).toBeUndefined();
  });

  it("prevents feature and reasoning changes while chat controls are disabled", async () => {
    await renderPicker(HAIKU, { disabled: true });
    await pressEffortKey("End");
    await click(webSearch());

    expect(fixture.overrides.get()).toEqual({
      native_tools: ["web_search"],
      reasoning_effort: "medium",
    });
    expect(slider().getAttribute("data-disabled")).not.toBeNull();
    expect(webSearch().disabled).toBe(true);
  });
});
