import { describe, expect, it } from "vitest";

import type {
  PyChatResponse,
  PyModelProviderCatalogItem,
} from "@/lib/content/catalogTypes";
import {
  chatModelSendGate,
  findRestorableChatModel,
} from "./model-provider-compatibility";

function model(
  overrides: Partial<PyModelProviderCatalogItem>,
): PyModelProviderCatalogItem {
  return {
    id: "OpenAIHTTPAgent:gpt-6-luna",
    model: "gpt-6-luna",
    model_provider: "OpenAIHTTPAgent",
    model_label: "GPT-5 Nano",
    provider_label: "OpenAI",
    logo_provider: "openai",
    model_client: "openai_chat_completions",
    api_standard: "chat_completions",
    accepts: [],
    produces: [],
    supports_tools: false,
    supports_reasoning: false,
    supported_reasoning_efforts: null,
    native_tool_support: null,
    ...overrides,
  };
}

function chat(overrides: Partial<PyChatResponse>): PyChatResponse {
  return {
    id: "chat-1",
    anima_id: "anima-1",
    title: "Chat",
    api_standard: "chat_completions",
    last_model_client: "openai_chat_completions",
    last_model_id: "gpt-6-luna",
    metadata: null,
    created_at: null,
    updated_at: null,
    last_message_at: null,
    usage: null,
    active_context_tokens: 0,
    ...overrides,
  };
}

describe("findRestorableChatModel", () => {
  it("prefers the recorded row id over a same-named model on another connection", () => {
    const ollama = model({ id: "owner:ollama-qwen", model: "qwen3:8b" });
    const lmstudio = model({ id: "owner:lmstudio-qwen", model: "qwen3:8b" });
    const embedding = model({ id: "owner:embed", model_kind: "embedding" });
    const recorded = chat({
      last_model_id: "qwen3:8b",
      last_model_provider_id: "owner:lmstudio-qwen",
    });

    expect(findRestorableChatModel(recorded, [ollama, lmstudio])).toBe(
      lmstudio,
    );
    // A removed row never switches the Anima to a same-named model elsewhere.
    expect(findRestorableChatModel(recorded, [ollama])).toBeNull();
    expect(
      findRestorableChatModel(chat({ last_model_provider_id: "owner:embed" }), [
        embedding,
      ]),
    ).toBeNull();
  });

  it("resolves the exact historical provider/model/client/standard row", () => {
    const expected = model({ id: "OpenAIHTTPAgent:gpt-6-luna" });
    const rows = [
      model({
        id: "OpenAIResponsesHTTPAgent:gpt-6-luna",
        model_provider: "OpenAIResponsesHTTPAgent",
        model_client: "openai_responses",
        api_standard: "responses",
      }),
      expected,
    ];

    expect(findRestorableChatModel(chat({}), rows)).toBe(expected);
  });

  it("resolves Hugging Face rows exactly", () => {
    const expected = model({
      id: "OpenAIHTTPAgent:deepseek-ai/DeepSeek-V4-Pro:deepinfra",
      model: "deepseek-ai/DeepSeek-V4-Pro:deepinfra",
      provider_label: "Hugging Face",
      logo_provider: "huggingface",
    });

    expect(
      findRestorableChatModel(
        chat({
          last_model_client: "openai_chat_completions",
          last_model_id: "deepseek-ai/DeepSeek-V4-Pro:deepinfra",
          api_standard: "chat_completions",
        }),
        [
          model({
            id: "OpenAIHTTPAgent:deepseek-ai/DeepSeek-R1",
            model: "deepseek-ai/DeepSeek-R1",
            provider_label: "Hugging Face",
            logo_provider: "huggingface",
          }),
          expected,
        ],
      ),
    ).toBe(expected);
  });

  it("does not restore when any required chat key is missing", () => {
    const rows = [model({})];

    expect(
      findRestorableChatModel(chat({ last_model_id: null }), rows),
    ).toBeNull();
    expect(
      findRestorableChatModel(chat({ last_model_client: null }), rows),
    ).toBeNull();
    expect(
      findRestorableChatModel(chat({ api_standard: null }), rows),
    ).toBeNull();
  });

  it("does not restore when the catalog row is no longer present", () => {
    expect(
      findRestorableChatModel(chat({ last_model_id: "retired-model" }), [
        model({}),
      ]),
    ).toBeNull();
  });
});

describe("chatModelSendGate", () => {
  it("allows new and null-standard chats with a supported selected row", () => {
    const selected = model({});

    expect(chatModelSendGate(null, selected)).toEqual({
      ok: true,
      reason: "new_chat",
    });
    expect(chatModelSendGate(chat({ api_standard: null }), selected)).toEqual({
      ok: true,
      reason: "uninitialized_chat",
    });
  });

  it("allows initialized chats when the selected standard matches", () => {
    expect(
      chatModelSendGate(
        chat({}),
        model({ id: "OpenAIHTTPAgent:gpt-5-mini", model: "gpt-5-mini" }),
      ),
    ).toEqual({ ok: true, reason: "compatible" });
  });

  it("allows Hugging Face rows in existing Chat Completions chats", () => {
    expect(
      chatModelSendGate(
        chat({}),
        model({
          id: "OpenAIHTTPAgent:zai-org/GLM-5.2:deepinfra",
          model: "zai-org/GLM-5.2:deepinfra",
          provider_label: "Hugging Face",
          logo_provider: "huggingface",
          api_standard: "chat_completions",
        }),
      ),
    ).toEqual({ ok: true, reason: "compatible" });
  });

  it("does not use last model client as a send fence", () => {
    expect(
      chatModelSendGate(
        chat({ last_model_client: "openai_chat_completions" }),
        model({
          id: "OtherOpenAIChatAgent:gpt-6-luna",
          model_provider: "OtherOpenAIChatAgent",
          model_client: "some_other_chat_client",
          api_standard: "chat_completions",
        }),
      ),
    ).toEqual({ ok: true, reason: "compatible" });
  });

  it("blocks missing, unsupported, and different-standard selected rows", () => {
    expect(chatModelSendGate(chat({}), null)).toEqual({
      ok: false,
      reason: "missing_model",
    });
    expect(chatModelSendGate(chat({}), model({ api_standard: null }))).toEqual({
      ok: false,
      reason: "unsupported_model",
    });
    expect(
      chatModelSendGate(
        chat({}),
        model({
          id: "OpenAIResponsesHTTPAgent:gpt-6-luna",
          model_provider: "OpenAIResponsesHTTPAgent",
          model_client: "openai_responses",
          api_standard: "responses",
        }),
      ),
    ).toEqual({
      ok: false,
      reason: "api_standard_mismatch",
      chatApiStandard: "chat_completions",
      selectedApiStandard: "responses",
    });
  });
});
