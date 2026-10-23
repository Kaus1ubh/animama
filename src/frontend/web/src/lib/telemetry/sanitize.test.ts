import { describe, expect, it } from "vitest";
import {
  MAX_ATTRIBUTES,
  MAX_ATTRIBUTE_LENGTH,
  MAX_STACK_LENGTH,
  MAX_STACK_LINES,
  sanitizeAttributes,
  sanitizeStack,
  sanitizeText,
} from "./sanitize";

const uuid = "123e4567-e89b-42d3-a456-426614174000";

describe("browser telemetry sanitization", () => {
  it("reduces URLs to their path, without origin, query or fragment", () => {
    expect(
      sanitizeText(
        "GET https://app.example.test/v1/chats?token=abc&q=hello#frag failed",
        512,
      ),
    ).toBe("GET /v1/chats failed");
    expect(sanitizeText("fetch /v1/animas?cursor=next#top", 512)).toBe(
      "fetch /v1/animas",
    );
    // Stack positions survive; a development cache-busting query does not.
    expect(
      sanitizeText(
        "at load (http://localhost:8000/src/main.tsx?t=1712:12:34)",
        512,
      ),
    ).toBe("at load (/src/main.tsx:12:34)");
  });

  it("replaces identifiers, emails, tokens and user agents", () => {
    const text = sanitizeText(
      [
        `anima ${uuid.toUpperCase()} at /v1/animas/${uuid}/chat`,
        "owner person.name+tag@example.co.uk",
        "digest 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
        "bearer eyJhbGciOiJIUzI1NiJ9xxxxxxxxxxxxxxxxxxxxxxxxxx",
        "agent Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      ].join(" | "),
      1024,
    );
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
    expect(text).not.toContain("@example");
    expect(text).not.toContain("9f86d081");
    expect(text).not.toContain("eyJhbGci");
    expect(text).not.toContain("Macintosh");
    expect(text).toBe(
      "anima <id> at /v1/animas/<id>/chat | owner <email> | digest <id> | bearer <id> | agent <user-agent>",
    );
  });

  it("truncates text to its limit after sanitizing", () => {
    expect(sanitizeText("x".repeat(40), 10)).toBe("xxxxxxxxx…");
    // Truncating first would leave part of the identifier behind.
    expect(sanitizeText(`${uuid} tail`, 9)).toBe("<id> tail");
    // A cut input drops its partial last word instead of exporting half of it.
    // The 1 KiB input bound falls six characters into the identifier.
    const collapsing = `https://app.example.test/p?${"q".repeat(990)} ${uuid}`;
    expect(sanitizeText(collapsing, 20)).toBe("/p");
  });

  it("caps stacks by frame count and length and sanitizes every frame", () => {
    const frames = Array.from(
      { length: 60 },
      (_, index) =>
        `    at frame${index} (https://app.example.test/assets/index-abc.js?v=${uuid}:1:${index})`,
    );
    const stack = sanitizeStack(`Error: boom ${uuid}\n${frames.join("\n")}`);
    const lines = stack.split("\n");
    expect(lines.length).toBeLessThanOrEqual(MAX_STACK_LINES);
    expect(stack.length).toBeLessThanOrEqual(MAX_STACK_LENGTH);
    expect(lines[0]).toBe("Error: boom <id>");
    expect(lines[1]).toBe("    at frame0 (/assets/index-abc.js:1:0)");
    expect(stack).not.toContain("example.test");
    expect(sanitizeStack("y".repeat(MAX_STACK_LENGTH * 3)).length).toBe(
      MAX_STACK_LENGTH,
    );
  });

  it("keeps bounded scalar attributes and drops identifier, URL and agent keys", () => {
    expect(
      sanitizeAttributes({
        action: "chat.submit",
        status: "ok",
        retries: 2,
        streaming: true,
        anima_id: uuid,
        chatId: "chat-1",
        "user.id": "u",
        "url.full": "https://app.example.test/v1",
        "http.target": "/v1?x=1",
        user_agent: "Mozilla/5.0",
        email: "a@b.co",
        session_token: "s",
        note: `see ${uuid}`,
        nan: Number.NaN,
        long: "z".repeat(MAX_ATTRIBUTE_LENGTH * 2),
        "bad key": "x",
      }),
    ).toEqual({
      action: "chat.submit",
      status: "ok",
      retries: 2,
      streaming: true,
      note: "see <id>",
      long: `${"z".repeat(MAX_ATTRIBUTE_LENGTH - 1)}…`,
    });
  });

  it("bounds the number of attributes", () => {
    const many = Object.fromEntries(
      Array.from({ length: MAX_ATTRIBUTES + 10 }, (_, index) => [
        `key${index}`,
        index,
      ]),
    );
    expect(Object.keys(sanitizeAttributes(many))).toHaveLength(MAX_ATTRIBUTES);
  });
});
