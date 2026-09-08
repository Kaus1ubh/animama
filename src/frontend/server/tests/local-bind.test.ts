import { describe, expect, it } from "vitest";

import {
  isLoopbackBindHost,
  resolveNativeGatewayBindHost,
} from "../src/local-bind.js";

describe("native local gateway binding", () => {
  it.each([
    "localhost",
    "animama-test.localhost",
    "127.0.0.1",
    "127.12.0.9",
    "::1",
    "[::1]",
  ])("accepts loopback host %s", (host) => {
    expect(isLoopbackBindHost(host)).toBe(true);
  });

  it.each(["0.0.0.0", "::", "192.168.1.4", "animama.example.com", ""])(
    "rejects published host %s",
    (host) => {
      expect(isLoopbackBindHost(host)).toBe(false);
    },
  );

  it("defaults the native gateway to IPv4 loopback", () => {
    expect(resolveNativeGatewayBindHost({})).toBe("127.0.0.1");
  });

  it("fails before startup for a non-loopback native bind", () => {
    expect(() =>
      resolveNativeGatewayBindHost({ ANIMAMA_LOCAL_BIND_HOST: "0.0.0.0" }),
    ).toThrow(/must stay on loopback/);
  });
});
