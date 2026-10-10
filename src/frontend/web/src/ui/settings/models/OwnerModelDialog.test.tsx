// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PyConfiguredModel,
  PyModelConnection,
  PyModelProbeReport,
} from "@animama/runtime-contracts/api-types";

import { EarlyCompactionSwitch, OwnerModelDialog } from "./OwnerModelDialog";

const mutations = vi.hoisted(() => {
  const mutation = () => ({
    mutateAsync: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    isSuccess: false,
    data: undefined as unknown,
  });
  return {
    add: mutation(),
    update: mutation(),
    discover: mutation(),
    probe: mutation(),
  };
});
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

vi.mock("sonner", () => ({ toast }));
vi.mock("@/query/hooks/useModelConfiguration", () => ({
  useOpenRouterModels: () => ({ isSuccess: false, isError: false }),
}));
vi.mock("@/query/mutations/useModelConfiguration", () => ({
  useAddOwnerModel: () => mutations.add,
  useUpdateModel: () => mutations.update,
  useListAvailableModels: () => mutations.discover,
  useProbeModel: () => mutations.probe,
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const HAIKU = "AnthropicMessagesHTTPAgent:claude-haiku-5-5";

const model = (
  id: string,
  extra: Partial<PyConfiguredModel> = {},
): PyConfiguredModel => ({
  id,
  connection_id: "anthropic",
  model: id.split(":").at(-1)!,
  model_label: id.split(":").at(-1)!,
  model_kind: "chat",
  provider_type: "AnthropicMessagesHTTPAgent",
  source: "builtin",
  hidden: false,
  allow_memory_writes: true,
  context_window_tokens: 1000000,
  capabilities: {
    accepts: ["text", "image"],
    supports_streaming: true,
    supports_tools: true,
    tools_with_structured_output: true,
    structured_output_transport: "json_schema",
    supported_reasoning_efforts: ["none", "low", "medium", "high"],
    native_tool_support: ["web_search"],
  },
  ...extra,
});
const haiku = model(HAIKU, {
  model_label: "Claude Haiku 5.5",
  early_compaction: true,
});
const luna = model("OpenAIResponsesHTTPAgent:gpt-6-luna", {
  connection_id: "openai",
  provider_type: "OpenAIResponsesHTTPAgent",
});
const connection = (preset: "anthropic" | "openai"): PyModelConnection => ({
  id: preset,
  name: preset === "anthropic" ? "Anthropic" : "OpenAI",
  preset,
  source: "builtin",
  compatibility: {},
  credential_state: "configured",
  models: [],
});

let root: Root | null = null;
let container: HTMLElement | null = null;

function render(node: React.ReactNode) {
  container = document.createElement("div");
  document.body.append(container);
  act(() => {
    root = createRoot(container!);
    root.render(node);
  });
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Set an input's value the way typing does, so React sees the change. */
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const buttonNamed = (name: string) =>
  [...document.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === name,
  );

beforeEach(() => {
  for (const mutation of Object.values(mutations)) {
    mutation.mutateAsync.mockReset();
    mutation.isPending = false;
  }
  toast.error.mockReset();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  document.body.replaceChildren();
});

describe("EarlyCompactionSwitch", () => {
  it("shows nothing on a model without a long-context price step", () => {
    render(
      <EarlyCompactionSwitch model={{ ...haiku, early_compaction: null }} />,
    );
    expect(container!.innerHTML).toBe("");
  });

  it("saves early_compaction at once", async () => {
    mutations.update.mutateAsync.mockResolvedValue(haiku);
    render(<EarlyCompactionSwitch model={haiku} />);
    expect(container!.textContent).toContain("Compact early");
    expect(container!.textContent).toContain("90,000 tokens");
    const control = container!.querySelector<HTMLButtonElement>(
      'button[role="switch"]',
    )!;
    expect(control.getAttribute("aria-checked")).toBe("true");
    expect(control.getAttribute("aria-describedby")).toBeTruthy();
    act(() => control.click());
    await flush();
    expect(mutations.update.mutateAsync).toHaveBeenCalledWith({
      modelProviderId: HAIKU,
      body: { early_compaction: false },
    });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("is disabled while a save is pending", () => {
    mutations.update.isPending = true;
    render(<EarlyCompactionSwitch model={haiku} />);
    expect(
      container!
        .querySelector('button[role="switch"]')!
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("explains a refused save", async () => {
    mutations.update.mutateAsync.mockRejectedValue({
      detail: {
        code: "early_compaction_unavailable",
        message: "This model has no long-context price step.",
      },
    });
    render(<EarlyCompactionSwitch model={haiku} />);
    act(() =>
      container!
        .querySelector<HTMLButtonElement>('button[role="switch"]')!
        .click(),
    );
    await flush();
    expect(toast.error).toHaveBeenCalledWith(
      "This model has no long-context price step.",
    );
  });
});

describe("OwnerModelDialog on the Anthropic connection", () => {
  const open = (preset: "anthropic" | "openai") => {
    render(
      <OwnerModelDialog
        open
        onOpenChange={() => undefined}
        connection={connection(preset)}
        templates={[luna, haiku]}
      />,
    );
  };

  it("adds chat models only, starting from Claude Haiku 5.5", async () => {
    open("anthropic");
    await flush();
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).not.toContain("Kind");
    expect(dialog.textContent).toContain("Copy capabilities from");
    expect(dialog.textContent).toContain("Claude Haiku 5.5");
    expect(
      dialog.querySelector<HTMLInputElement>(
        'input[placeholder="claude-sonnet-5-5"]',
      ),
    ).not.toBeNull();
  });

  it("keeps the Kind choice and OpenAI templates on the OpenAI connection", async () => {
    open("openai");
    await flush();
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Kind");
    expect(dialog.textContent).not.toContain("Claude Haiku 5.5");
  });

  it("saves a tested model with the Models API's limits, not Haiku's", async () => {
    const report: PyModelProbeReport = {
      model: "claude-older",
      steps: [{ name: "available", ok: true }],
      supports_streaming: true,
      supports_tools: true,
      context_window_tokens: 200000,
      max_output_tokens: 32000,
      structured_output_transport: null,
      supported_reasoning_efforts: null,
      notes: [],
    };
    mutations.probe.mutateAsync.mockResolvedValue(report);
    mutations.add.mutateAsync.mockResolvedValue(model("owner:older"));
    open("anthropic");
    await flush();
    type(
      document.querySelector<HTMLInputElement>(
        'input[placeholder="claude-sonnet-5-5"]',
      )!,
      "claude-older",
    );
    act(() => buttonNamed("Test model")!.click());
    await flush();
    expect(mutations.probe.mutateAsync).toHaveBeenCalledWith({
      connectionId: "anthropic",
      body: {
        model: "claude-older",
        kind: "chat",
        provider_type: "AnthropicMessagesHTTPAgent",
      },
    });
    act(() => buttonNamed("Add model")!.click());
    await flush();
    expect(mutations.add.mutateAsync).toHaveBeenCalledTimes(1);
    const { body } = mutations.add.mutateAsync.mock.calls[0][0] as {
      body: Record<string, unknown> & {
        capabilities: Record<string, unknown>;
      };
    };
    expect(body).toMatchObject({
      model: "claude-older",
      provider_type: "AnthropicMessagesHTTPAgent",
      template_id: null,
      context_window_tokens: 200000,
    });
    expect(body.capabilities).toMatchObject({
      structured_output_transport: null,
      supported_reasoning_efforts: [],
    });
  });
});
