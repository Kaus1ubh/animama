/** Requests per attempt; retries cover a lost reply, never a server answer. */
const SENDS_PER_ATTEMPT = 3;

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

/**
 * A network failure, or a gateway failure without a hosted state, may hide a
 * committed setup. Hosted errors (`{"state": ...}`) are answers.
 */
async function replyWasLost(response: Response): Promise<boolean> {
  if (response.status < 500) return false;
  const body: unknown = await response.json().catch(() => null);
  return !(
    body &&
    typeof body === "object" &&
    typeof (body as { state?: unknown }).state === "string"
  );
}

/**
 * Server-owned first-use account setup (`POST /v1/hosted/bootstrap:ensure`).
 * One attempt runs at a time. A lost reply is retried with the same
 * idempotency key, and the key is kept for the next attempt until the server
 * answers, so the server can return its committed result instead of starting
 * new work. Once the server answers, the next attempt chooses a new key. The
 * runtime context, read after each attempt, decides what happens next.
 */
export function createAccountSetup(
  send: (idempotencyKey: string) => Promise<Response>,
  wait: (milliseconds: number) => Promise<void> = sleep,
) {
  let replayKey: string | null = null;
  let running: Promise<void> | null = null;

  async function attempt(): Promise<void> {
    const key = (replayKey ??= crypto.randomUUID());
    for (let sent = 1; sent <= SENDS_PER_ATTEMPT; sent += 1) {
      if (sent > 1) await wait(500 * 2 ** (sent - 2));
      let response: Response | null = null;
      try {
        response = await send(key);
      } catch {
        // The request may still have reached the server.
      }
      if (response && !(await replyWasLost(response))) {
        replayKey = null;
        return;
      }
    }
  }

  return {
    get running(): boolean {
      return running !== null;
    },
    /** Start an attempt, or join the running one; it never rejects. */
    run(): Promise<void> {
      running ??= attempt().finally(() => {
        running = null;
      });
      return running;
    },
  };
}
