import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PyOpenRouterModel } from "@animama/runtime-contracts/api-types";

import {
  DEFAULT_CAPABILITIES_DRAFT,
  draftFromOpenRouterModel,
  filterOpenRouterModels,
  openRouterModelsErrorMessage,
} from "./model-configuration-state";
import { OpenRouterModelPicker } from "./OpenRouterModelPicker";

const list = vi.hoisted(() => ({
  result: {} as Record<string, unknown>,
}));
vi.mock("@/query/hooks/useModelConfiguration", () => ({
  useOpenRouterModels: () => list.result,
}));

const models: PyOpenRouterModel[] = [
  {
    id: "qwen/qwen3-235b-a22b",
    name: "Qwen: Qwen3 235B A22B",
    context_length: 131072,
    supports_tools: true,
    supports_structured_outputs: true,
  },
  {
    id: "mistralai/mistral-small",
    name: "Mistral: Mistral Small",
    context_length: 32000,
    supports_tools: true,
    supports_structured_outputs: false,
  },
  {
    id: "gryphe/mythomax-l2-13b",
    name: "MythoMax 13B",
    context_length: null,
    supports_tools: false,
    supports_structured_outputs: false,
  },
];

const render = () =>
  renderToStaticMarkup(
    <OpenRouterModelPicker selectedId="" onSelect={() => undefined} />,
  );

beforeEach(() => {
  list.result = {
    isSuccess: true,
    isError: false,
    data: models,
  };
});

describe("OpenRouter add-model picker", () => {
  it("starts with Tool calling only on and lists only tool-calling models", () => {
    const html = render();
    expect(html).toContain("Find an OpenRouter model");
    expect(html).toMatch(
      /Tool calling only<button[^>]*role="switch"[^>]*aria-checked="true"/u,
    );
    expect(html).toContain("Qwen: Qwen3 235B A22B");
    expect(html).toContain("qwen/qwen3-235b-a22b · 128K · Tools");
    expect(html).not.toContain("MythoMax");
    expect(html).toMatch(/role="status"[^>]*>2 models found\./u);
  });

  it("searches by name or ID and can show models without tools", () => {
    expect(
      filterOpenRouterModels(models, { query: "qwen 235b", toolsOnly: true }),
    ).toEqual([models[0]]);
    expect(
      filterOpenRouterModels(models, {
        query: "MISTRAL small",
        toolsOnly: true,
      }),
    ).toEqual([models[1]]);
    expect(
      filterOpenRouterModels(models, { query: "mythomax", toolsOnly: true }),
    ).toEqual([]);
    expect(
      filterOpenRouterModels(models, { query: "mythomax", toolsOnly: false }),
    ).toEqual([models[2]]);
    expect(
      filterOpenRouterModels(models, { query: "", toolsOnly: false }),
    ).toHaveLength(3);
  });

  it("prefills the model ID, name, context window and capabilities", () => {
    expect(
      draftFromOpenRouterModel(models[0], DEFAULT_CAPABILITIES_DRAFT),
    ).toEqual({
      model: "qwen/qwen3-235b-a22b",
      label: "Qwen: Qwen3 235B A22B",
      contextWindow: "131072",
      capabilities: {
        ...DEFAULT_CAPABILITIES_DRAFT,
        supports_tools: true,
        structured_output_transport: "json_schema",
        tools_with_structured_output: true,
      },
    });
    const noSchema = draftFromOpenRouterModel(models[2], {
      ...DEFAULT_CAPABILITIES_DRAFT,
      accepts_images: true,
    });
    expect(noSchema.contextWindow).toBe("");
    expect(noSchema.capabilities).toEqual({
      ...DEFAULT_CAPABILITIES_DRAFT,
      // Unadvertised values the owner already set are kept.
      accepts_images: true,
      supports_tools: false,
      structured_output_transport: null,
      tools_with_structured_output: false,
    });
  });

  it("explains an unavailable list and falls back to typing the ID", () => {
    const error = {
      detail: {
        code: "openrouter_models_unavailable",
        message: "upstream said something",
      },
    };
    list.result = { isSuccess: false, isError: true, error };
    const html = render();
    expect(html).toMatch(
      /role="status"[^>]*>OpenRouter&#x27;s model list is unavailable right now\. Type the model ID below instead\./u,
    );
    expect(html).not.toContain("upstream said something");
    expect(html).not.toContain('aria-label="OpenRouter models"');
    expect(openRouterModelsErrorMessage(new TypeError("fetch failed"))).toBe(
      "The OpenRouter model list could not be loaded. Type the model ID below instead.",
    );
  });

  it("says when the list is still loading", () => {
    list.result = { isSuccess: false, isError: false };
    expect(render()).toContain("Loading OpenRouter models…");
  });
});
