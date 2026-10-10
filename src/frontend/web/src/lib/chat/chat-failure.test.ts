import { describe, expect, it } from "vitest";
import { describeChatFailure } from "@animama/product-ui/chat";

const ollama = {
  category: "unreachable",
  connection_name: "Home Ollama",
  connection_preset: "ollama",
  connection_base_url: "http://127.0.0.1:11434/v1",
  provider_error_message: "secret server text",
};

describe("provider-neutral chat failures", () => {
  it("names the failed connection and asks whether a local server is running", () => {
    const failure = describeChatFailure(
      { code: "openai_connection_error", details: ollama },
      "hello",
    );
    expect(failure.title).toBe("Animama couldn't reach Home Ollama.");
    expect(failure.guidance).toBe(
      "Is Ollama running at http://127.0.0.1:11434/v1? Start it, then try again.",
    );
    expect(JSON.stringify(failure)).not.toContain("secret");
  });

  it("uses cloud guidance for a cloud connection and names OpenAI from its details", () => {
    const failure = describeChatFailure(
      {
        code: "openai_connection_error",
        details: {
          category: "unreachable",
          connection_name: "OpenAI",
          connection_preset: "openai",
        },
      },
      "hello",
    );
    expect(failure.title).toBe("Animama couldn't reach OpenAI.");
    expect(failure.guidance).toContain("internet connection");
  });

  it("explains an oversized conversation from the category", () => {
    const failure = describeChatFailure(
      {
        code: "openai_bad_request",
        details: { ...ollama, category: "context_exceeded" },
      },
      "hello",
    );
    expect(failure.code).toBe("openai_bad_request");
    expect(failure.title).toBe(
      "The conversation is too long for Home Ollama's model.",
    );
    expect(failure.guidance).toContain("larger context window");
  });

  it("does not name a provider it was not told about", () => {
    const failure = describeChatFailure({ code: "openai_timeout" }, "hello");
    expect(failure.title).toBe("The model server took too long to respond.");
    expect(failure.title).not.toContain("OpenAI");
  });

  it("describes a removed connection", () => {
    expect(
      describeChatFailure({ code: "connection_unavailable" }, "hello").title,
    ).toBe("The selected model's connection was removed.");
  });

  it("says the model declined, without naming a provider or trying another model", () => {
    const failure = describeChatFailure(
      {
        code: "model_refused",
        details: {
          category: "provider_error",
          connection_name: "Anthropic",
          connection_preset: "anthropic",
          stop_details_category: "cyber",
        },
      },
      "hello",
    );
    expect(failure.code).toBe("model_refused");
    expect(`${failure.title} ${failure.guidance}`).toBe(
      "The model declined to respond to this message. Try rephrasing it.",
    );
    expect(JSON.stringify(failure)).not.toContain("cyber");
  });

  const anthropic = {
    connection_name: "Anthropic",
    connection_preset: "anthropic",
  };

  it("names the Anthropic connection and API Keys when its key is missing", () => {
    const failure = describeChatFailure(
      {
        code: "missing_api_key",
        details: { ...anthropic, category: "credential_missing" },
      },
      "hello",
    );
    expect(failure.title).toBe("Anthropic has no API key configured.");
    expect(failure.guidance).toContain("API Keys");
  });

  it.each([
    ["anthropic_authentication_error", "openai_authentication_error"],
    ["anthropic_permission_denied", "openai_permission_denied"],
    ["anthropic_not_found", "openai_not_found"],
    ["anthropic_quota_exceeded", "openai_quota_exceeded"],
    ["anthropic_rate_limit", "openai_rate_limit"],
    ["anthropic_overloaded", "openai_overloaded"],
    ["anthropic_server_error", "openai_server_error"],
    ["anthropic_timeout", "openai_timeout"],
    ["anthropic_connection_error", "openai_connection_error"],
    ["anthropic_bad_request", "openai_bad_request"],
  ])("describes %s like %s, naming Anthropic", (code, equivalent) => {
    const failure = describeChatFailure({ code, details: anthropic }, "hello");
    const openAiCopy = describeChatFailure(
      { code: equivalent, details: anthropic },
      "hello",
    );
    expect(failure.code).toBe(code);
    expect([failure.title, failure.guidance]).toEqual([
      openAiCopy.title,
      openAiCopy.guidance,
    ]);
    expect(failure.title).toContain("Anthropic");
  });

  it("explains Anthropic's context, credit and interrupted-stream failures", () => {
    expect(
      describeChatFailure(
        {
          code: "anthropic_context_exceeded",
          details: { ...anthropic, category: "context_exceeded" },
        },
        "hello",
      ).title,
    ).toBe("The conversation is too long for Anthropic's model.");
    expect(
      describeChatFailure(
        { code: "anthropic_context_exceeded", details: anthropic },
        "hello",
      ).title,
    ).toBe("The conversation is too long for Anthropic's model.");
    expect(
      describeChatFailure(
        { code: "anthropic_quota_exceeded", details: anthropic },
        "hello",
      ).guidance,
    ).toContain("billing");
    const interrupted = describeChatFailure(
      { code: "anthropic_stream_incomplete", details: anthropic },
      "hello",
      "Partial",
    );
    expect(interrupted.title).toBe("The reply was interrupted.");
  });

  it("waits out Anthropic's rate limit like OpenAI's", () => {
    expect(
      describeChatFailure(
        {
          code: "anthropic_rate_limit",
          details: { ...anthropic, retry_after_seconds: 1.2 },
        },
        "hello",
      ).retryAfterSeconds,
    ).toBe(2);
  });
});
