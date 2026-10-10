import { describe, expect, it } from "vitest";
import { safeNavigationUrl } from "@animama/product-ui";

describe("safeNavigationUrl", () => {
  it("accepts an absolute https URL as its normalized href", () => {
    expect(safeNavigationUrl("https://Animama.example/download")).toBe(
      "https://animama.example/download",
    );
  });

  it.each([
    undefined,
    null,
    42,
    "",
    "not a url",
    "/download",
    "//animama.example/download",
    "http://animama.example/download",
    "https://user@animama.example/download",
    "https://user:secret@animama.example/download",
    "javascript:alert(1)",
    "data:text/html,hello",
    "ftp://animama.example/download",
  ])("rejects %s without an application origin", (value) => {
    expect(safeNavigationUrl(value)).toBeNull();
  });

  it("resolves paths and accepts the application's own http origin", () => {
    const origin = "http://localhost:8000";
    expect(safeNavigationUrl("/account", origin)).toBe(
      "http://localhost:8000/account",
    );
    expect(safeNavigationUrl("http://localhost:8000/account", origin)).toBe(
      "http://localhost:8000/account",
    );
    expect(safeNavigationUrl("https://accounts.example/", origin)).toBe(
      "https://accounts.example/",
    );
    expect(safeNavigationUrl("http://accounts.example/", origin)).toBeNull();
    expect(
      safeNavigationUrl("http://user:secret@localhost:8000/", origin),
    ).toBeNull();
  });

  it("never downgrades an https application to http", () => {
    const origin = "https://app.example";
    expect(safeNavigationUrl("/account", origin)).toBe(
      "https://app.example/account",
    );
    expect(safeNavigationUrl("http://app.example/account", origin)).toBeNull();
  });
});
