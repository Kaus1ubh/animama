import { describe, expect, it, vi } from "vitest";
import { createAccountSetup } from "./account-setup";

const answered = () => Response.json({ state: "active", ready: true });
const noWait = async () => {};

describe("hosted account setup", () => {
  it("replays the same key after a lost reply and a bare gateway failure", async () => {
    const keys: string[] = [];
    const replies = [
      () => Promise.reject(new TypeError("Failed to fetch")),
      () => Promise.resolve(new Response("Bad gateway", { status: 502 })),
      () => Promise.resolve(answered()),
    ];
    const setup = createAccountSetup((key) => {
      keys.push(key);
      return replies[keys.length - 1]();
    }, noWait);
    await setup.run();
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toMatch(/^[A-Za-z0-9._:-]{16,128}$/);
  });

  it("keeps an unanswered key for the next attempt and chooses a new key after an answer", async () => {
    const keys: string[] = [];
    let online = false;
    const setup = createAccountSetup((key) => {
      keys.push(key);
      return online
        ? Promise.resolve(answered())
        : Promise.reject(new TypeError("Failed to fetch"));
    }, noWait);
    await setup.run();
    expect(keys).toHaveLength(3);
    online = true;
    await setup.run();
    expect(keys.at(-1)).toBe(keys[0]);
    await setup.run();
    expect(keys.at(-1)).not.toBe(keys[0]);
  });

  it("treats a hosted error state as the server's answer", async () => {
    const keys: string[] = [];
    const setup = createAccountSetup((key) => {
      keys.push(key);
      return Promise.resolve(
        Response.json({ state: "identity_unavailable" }, { status: 503 }),
      );
    }, noWait);
    await setup.run();
    await setup.run();
    expect(keys).toHaveLength(2);
    expect(keys[1]).not.toBe(keys[0]);
  });

  it("runs one attempt at a time", async () => {
    let finish!: (response: Response) => void;
    const send = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const setup = createAccountSetup(send, noWait);
    const first = setup.run();
    const joined = setup.run();
    expect(setup.running).toBe(true);
    expect(send).toHaveBeenCalledOnce();
    finish(answered());
    await Promise.all([first, joined]);
    expect(setup.running).toBe(false);
  });
});
