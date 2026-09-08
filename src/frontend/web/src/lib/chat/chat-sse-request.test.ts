import { describe, expect, it } from "vitest";

import { buildChatSseRequestBody } from "./chat-sse-request";

describe("buildChatSseRequestBody", () => {
  it("includes the selected Hugging Face model-provider row exactly", () => {
    expect(
      buildChatSseRequestBody({
        message: "hello",
        runId: "run-1",
        chatId: "chat-1",
        runtimeRevision: "ar1-one",
        modelProviderId:
          "OpenAIHTTPAgent:deepseek-ai/DeepSeek-V4-Pro:deepinfra",
        dispatchOptions: {
          main_structured_response: true,
        },
      }),
    ).toEqual({
      message: "hello",
      run_id: "run-1",
      chat_id: "chat-1",
      runtime_revision: "ar1-one",
      model_provider_id:
        "OpenAIHTTPAgent:deepseek-ai/DeepSeek-V4-Pro:deepinfra",
      dispatch_options: {
        main_structured_response: true,
      },
    });
  });

  it("trims selected model-provider ids and preserves explicit empty native tools", () => {
    expect(
      buildChatSseRequestBody({
        message: "hi",
        runId: "run-2",
        chatId: "chat-2",
        runtimeRevision: "ar1-two",
        modelProviderId: "  OpenAIHTTPAgent:zai-org/GLM-5.2:deepinfra  ",
        dispatchOptions: {
          native_tools: [],
        },
      }),
    ).toEqual({
      message: "hi",
      run_id: "run-2",
      chat_id: "chat-2",
      runtime_revision: "ar1-two",
      model_provider_id: "OpenAIHTTPAgent:zai-org/GLM-5.2:deepinfra",
      dispatch_options: {
        native_tools: [],
      },
    });
  });

  it("drops backend-owned and stale native tools from dispatch options", () => {
    expect(
      buildChatSseRequestBody({
        message: "remember this",
        runId: "run-native-tools",
        chatId: "chat-native-tools",
        runtimeRevision: "ar1-native",
        modelProviderId: "OpenAIResponsesHTTPAgent:gpt-5.4-nano",
        requestableNativeTools: ["web_search"],
        dispatchOptions: {
          native_tools: ["web_search", "apply_patch", "stale_tool"],
        },
      }),
    ).toEqual({
      message: "remember this",
      run_id: "run-native-tools",
      chat_id: "chat-native-tools",
      runtime_revision: "ar1-native",
      model_provider_id: "OpenAIResponsesHTTPAgent:gpt-5.4-nano",
      dispatch_options: {
        native_tools: ["web_search"],
      },
    });
  });

  it("omits optional fields when no model or dispatch options are present", () => {
    expect(
      buildChatSseRequestBody({
        message: "draft",
        runId: "run-3",
        chatId: "chat-3",
        runtimeRevision: "ar1-three",
        modelProviderId: "  ",
        dispatchOptions: {},
      }),
    ).toEqual({
      message: "draft",
      run_id: "run-3",
      chat_id: "chat-3",
      runtime_revision: "ar1-three",
    });
  });

  it("includes unique attached backend file ids when present", () => {
    expect(
      buildChatSseRequestBody({
        message: "read this",
        runId: "run-4",
        chatId: "chat-4",
        runtimeRevision: "ar1-four",
        modelProviderId: null,
        attachedFileIds: [" file-1 ", "file-2", "file-1", ""],
      }),
    ).toEqual({
      message: "read this",
      run_id: "run-4",
      chat_id: "chat-4",
      runtime_revision: "ar1-four",
      attached_file_ids: ["file-1", "file-2"],
    });
  });
});
