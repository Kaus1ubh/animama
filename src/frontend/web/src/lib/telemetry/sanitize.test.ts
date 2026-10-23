import { describe, expect, it } from "vitest";
import {
  MAX_ATTRIBUTES,
  MAX_ATTRIBUTE_LENGTH,
  MAX_STACK_LENGTH,
  MAX_STACK_LINE_LENGTH,
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
    expect(sanitizeText("open chats?token=abc&q=hello now", 512)).toBe(
      "open chats now",
    );
    expect(sanitizeText("see //evil.example.com/path?x=1", 512)).toBe(
      "see /path",
    );
    expect(
      sanitizeText(`worker blob:https://app.example.test/${uuid}`, 512),
    ).toBe("worker /<id>");
    expect(sanitizeText("Error #42 in /v1/chats#frag", 512)).toBe(
      "Error #42 in /v1/chats",
    );
    expect(
      sanitizeText(
        "path=/cb#access_token=abc123 redirect:/cb#token=abc chats/abc#section",
        512,
      ),
    ).toBe("path=/cb redirect:/cb chats/abc");
    // Hashed chunk names stay, so stacks can still be symbolicated.
    expect(
      sanitizeText(
        "at x (https://app.example.test/assets/ProductChatSessionProvider-BzK3x9Qa.js:1:2345)",
        512,
      ),
    ).toBe("at x (/assets/ProductChatSessionProvider-BzK3x9Qa.js:1:2345)");
  });

  it("replaces identifiers, emails, tokens and user agents", () => {
    const text = sanitizeText(
      [
        `anima ${uuid.toUpperCase()} at /v1/animas/${uuid}/chat`,
        "owner person.name+tag@example.co.uk and josé@exämple.com",
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
      "anima <id> at /v1/animas/<id>/chat | owner <email> and <email> | digest <id> | bearer <id> | agent <user-agent>",
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
    expect(sanitizeStack("word ".repeat(MAX_STACK_LENGTH)).length).toBe(
      MAX_STACK_LINE_LENGTH,
    );
    // An unbroken over-long line may be a secret, so no part of it is kept.
    expect(sanitizeStack("y".repeat(MAX_STACK_LENGTH * 3))).toBe("");
  });

  it("stays fast on long hostile input", () => {
    const run = (unit: string) => unit.repeat(Math.ceil(16_384 / unit.length));
    const started = performance.now();
    for (const unit of [
      "a",
      "a-",
      "a.",
      "z:",
      "/",
      "a://",
      "0a-",
      ":1",
      "a@",
      "a=",
      "?a",
      "Mozilla/5.0 (",
    ]) {
      sanitizeText(run(unit), MAX_STACK_LENGTH);
      sanitizeText(`${run(unit)} tail`, 2_000);
      sanitizeStack(`Error: ${run(unit)}\n${run(unit)}`);
    }
    // Linear expressions take well under a millisecond each here; the
    // quadratic ones took seconds.
    expect(performance.now() - started).toBeLessThan(250);
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
        "server.address": "10.0.0.1",
        "http.host": "app.example.test",
        "user.name": "person",
        query: "q=hello",
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
