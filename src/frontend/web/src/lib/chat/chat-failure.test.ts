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
});
