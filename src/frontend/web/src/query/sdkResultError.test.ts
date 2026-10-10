import { describe, expect, it, vi } from "vitest";

import { sdkResultError } from "./sdkResultError";

class HttpFailure extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

const toHttpError = (status: number, body: unknown) =>
  new HttpFailure(status, body);

describe("failed generated SDK results", () => {
  it("keeps a transport failure without an HTTP response as a transport error", () => {
    const lost = new TypeError("Failed to fetch");
    const toError = vi.fn(toHttpError);
    expect(sdkResultError({ error: lost }, toError)).toBe(lost);
    // A paused hosted scope rejects with an AbortError before any response.
    const paused = new DOMException("Admission is required", "AbortError");
    expect(
      sdkResultError({ error: paused, response: undefined }, toError),
    ).toBe(paused);
    expect(toError).not.toHaveBeenCalled();
  });

  it("reports an unknown transport failure as a connection error", () => {
    const error = sdkResultError({ error: {} }, toHttpError);
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toBe("Failed to fetch");
  });

  it("classifies an HTTP failure with its status and parsed body", () => {
    const body = { detail: { code: "conflict" } };
    const error = sdkResultError(
      { error: body, response: new Response(null, { status: 409 }) },
      toHttpError,
    );
    expect(error).toBeInstanceOf(HttpFailure);
    expect(error).toMatchObject({ status: 409, body });
  });
});
