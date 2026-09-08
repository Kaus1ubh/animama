import { Pool } from "pg";

import type { InstallationPrincipalProvider } from "./provider.js";

const DEFAULT_READY_TIMEOUT_MS = 120_000;
const DEFAULT_RETRY_INTERVAL_MS = 500;

type PostgresInstallationPrincipalProviderOptions = {
  connectionString: string;
  readyTimeoutMs?: number;
  retryIntervalMs?: number;
};

/** Waits for Alembic, reads the installation singleton once, then closes PG. */
export class PostgresInstallationPrincipalProvider implements InstallationPrincipalProvider {
  readonly #connectionString: string;
  readonly #readyTimeoutMs: number;
  readonly #retryIntervalMs: number;

  constructor(options: PostgresInstallationPrincipalProviderOptions) {
    if (!options.connectionString.trim()) {
      throw new Error("gateway database configuration is required");
    }
    this.#connectionString = options.connectionString;
    this.#readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
    this.#retryIntervalMs =
      options.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS;
  }

  async getInstallationPrincipalId(): Promise<string> {
    const deadline = Date.now() + this.#readyTimeoutMs;
    let lastFailure: unknown;

    while (Date.now() < deadline) {
      const pool = new Pool({
        connectionString: this.#connectionString,
        max: 1,
        connectionTimeoutMillis: 5_000,
      });
      try {
        const result = await pool.query<{
          installation_principal_id: string;
        }>(
          "SELECT installation_principal_id FROM installation_settings WHERE id = 1",
        );
        if (result.rowCount !== 1) {
          throw new Error("installation principal is unavailable");
        }
        const principalId = String(
          result.rows[0]?.installation_principal_id ?? "",
        ).trim();
        if (!principalId) {
          throw new Error("installation principal is unavailable");
        }
        return principalId;
      } catch (error) {
        lastFailure = error;
      } finally {
        await pool.end().catch(() => undefined);
      }

      await new Promise((resolve) =>
        setTimeout(resolve, this.#retryIntervalMs),
      );
    }

    // Do not include database connection details or driver messages.
    throw new Error(
      `installation principal was unavailable before gateway readiness (${lastFailure instanceof Error ? lastFailure.name : "unknown error"})`,
    );
  }
}
