const REQUEST_TIMEOUT_MS = 15_000;

function parseOrigin(args: string[]): URL {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  if (normalizedArgs.length !== 2 || normalizedArgs[0] !== "--origin") {
    throw new Error(
      "usage: smoke-accountless-gateway --origin <http(s) origin>",
    );
  }
  const origin = new URL(normalizedArgs[1]!);
  if (
    (origin.protocol !== "http:" && origin.protocol !== "https:") ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    origin.username ||
    origin.password
  ) {
    throw new Error(
      "--origin must be an http(s) origin without credentials or a path",
    );
  }
  return origin;
}

async function checkedFetch(
  url: URL,
  init: RequestInit,
  expectedStatus: number,
  label: string,
): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status !== expectedStatus) {
    await response.body?.cancel();
    throw new Error(`${label} returned an unexpected status`);
  }
  return response;
}

async function main(): Promise<void> {
  const origin = parseOrigin(process.argv.slice(2));
  const sameOriginHeaders = {
    Origin: origin.origin,
    "Sec-Fetch-Site": "same-origin",
  };

  const health = await checkedFetch(
    new URL("/health", origin),
    {},
    200,
    "health",
  );
  const healthBody = (await health.json()) as Record<string, unknown>;
  if (
    healthBody.ok !== true ||
    healthBody.service !== "animama-local-gateway"
  ) {
    throw new Error("health response was not the bounded gateway contract");
  }

  const context = await checkedFetch(
    new URL("/v1/runtime-context", origin),
    { headers: sameOriginHeaders },
    200,
    "runtime context",
  );
  const contextBody = (await context.json()) as Record<string, unknown>;
  if (
    typeof contextBody.principal_id !== "string" ||
    typeof contextBody.first_run_complete !== "boolean"
  ) {
    throw new Error(
      "runtime context response was not the bounded accountless contract",
    );
  }

  const spoofed = await checkedFetch(
    new URL("/v1/runtime-context", origin),
    {
      headers: {
        ...sameOriginHeaders,
        Authorization: "Bearer browser-spoof",
        "X-Animama-Internal-Token": "browser-spoof",
        "X-Animama-Principal-Id": "browser-spoof",
      },
    },
    200,
    "spoof stripping",
  );
  await spoofed.body?.cancel();

  const hostile = await checkedFetch(
    new URL("/v1/runtime-context", origin),
    {
      headers: {
        Origin: "https://hostile.invalid",
        "Sec-Fetch-Site": "cross-site",
      },
    },
    403,
    "hostile metadata",
  );
  await hostile.body?.cancel();

  const bootstrap = await checkedFetch(
    new URL("/v1/runtime/bootstrap:ensure", origin),
    {
      method: "POST",
      headers: {
        ...sameOriginHeaders,
        "X-Animama-CSRF": "1",
      },
    },
    200,
    "bootstrap repair",
  );
  await bootstrap.body?.cancel();

  console.log("gateway smoke: OK");
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown failure";
  console.error(`gateway smoke: FAILED (${message})`);
  process.exitCode = 1;
});
