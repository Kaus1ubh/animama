import { RuntimeError } from "./errors.js";

export type BackendReadiness = {
  schema_version: number;
  runtime_version: string;
  build_id: string;
  alembic_head: string;
  installation_principal_id: string;
  local_http_schema_version: number;
  process_id: number;
  process_start_token: string;
};

/** A private port can collide before bind; never buffer an unbounded probe response. */
export async function readBackendReadiness(
  response: Response,
): Promise<BackendReadiness> {
  return (await readDesktopControlJson(response)) as BackendReadiness;
}

/**
 * Return a terminal startup failure code, or null while the backend may still
 * become ready. Unrecognized bodies are not UI authority and keep the bounded
 * readiness deadline.
 */
export async function readTerminalStartupFailure(
  response: Response,
): Promise<string | null> {
  if (response.status !== 503) {
    await response.body?.cancel();
    return null;
  }
  try {
    const body = (await readDesktopControlJson(response)) as {
      detail?: { code?: unknown };
    };
    return body.detail?.code === "content_startup_failed"
      ? body.detail.code
      : null;
  } catch {
    return null;
  }
}

/** Control responses have explicit bounds even if a private port was occupied. */
export async function readDesktopControlJson(
  response: Response,
  maximum = 8192,
): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new RuntimeError("backend_readiness_mismatch");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maximum) throw new RuntimeError("backend_readiness_mismatch");
      chunks.push(chunk.value);
    }
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object") throw new Error();
    return value;
  } catch {
    throw new RuntimeError("backend_readiness_mismatch");
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
