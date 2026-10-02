import { randomBytes } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import {
  connectionCredentialPattern,
  credentialProviders,
  maxConnectionCredentials,
  maxCredentialChanges,
  type CredentialChange,
  type CredentialProvider,
  type CredentialStatus,
} from "../../../../shared/desktop-runtime.js";
import path from "node:path";
import {
  atomicWrite,
  privateDirectory,
  privateFileMode,
} from "./atomic-file.js";
import { RuntimeError } from "./errors.js";

export type Encryption = {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
};
type VaultEntry = { value: string; updatedAt: string };
type VaultData = {
  version: 1;
  postgresPassword: string;
  providers: Partial<Record<CredentialProvider, VaultEntry>>;
  /** Model-connection keys by environment name; absent in older vaults. */
  connections?: Record<string, VaultEntry>;
};
const providerEnvironment: Record<CredentialProvider, string> = {
  openai: "OPENAI_API_KEY",
  elevenlabs: "ELEVENLABS_API_KEY",
};
/** Provider keys earlier releases stored; they are dropped when a vault loads. */
const retiredProviders = new Set(["deepseek", "huggingface", "gemini"]);
/** Room for both providers and every connection key at the value limit. */
const maxVaultBytes = 512 * 1024;

export function validateProvider(value: unknown): CredentialProvider {
  if (
    typeof value !== "string" ||
    !credentialProviders.includes(value as CredentialProvider)
  )
    throw new RuntimeError("credential_provider_invalid");
  return value as CredentialProvider;
}
export function validateConnectionCredential(value: unknown): string {
  if (typeof value !== "string" || !connectionCredentialPattern.test(value))
    throw new RuntimeError("credential_connection_invalid");
  return value;
}
/**
 * Validate a renderer-supplied batch: 1..N changes, one per provider or
 * connection, each an object with exactly one of `provider` or `connection`
 * and an optional `value`.
 */
export function validateCredentialChanges(value: unknown): CredentialChange[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > maxCredentialChanges
  )
    throw new RuntimeError("credential_changes_invalid");
  const seen = new Set<string>();
  return value.map((change: unknown): CredentialChange => {
    if (!change || typeof change !== "object" || Array.isArray(change))
      throw new RuntimeError("credential_changes_invalid");
    const keys = Object.keys(change);
    const target = keys.includes("provider") ? "provider" : "connection";
    if (keys.some((key) => key !== target && key !== "value"))
      throw new RuntimeError("credential_changes_invalid");
    const record = change as {
      provider?: unknown;
      connection?: unknown;
      value?: unknown;
    };
    const name =
      target === "provider"
        ? validateProvider(record.provider)
        : validateConnectionCredential(record.connection);
    if (seen.has(name)) throw new RuntimeError("credential_changes_invalid");
    seen.add(name);
    const value =
      record.value === undefined ? undefined : validateCredential(record.value);
    if (target === "provider")
      return value === undefined
        ? { provider: name as CredentialProvider }
        : { provider: name as CredentialProvider, value };
    return value === undefined
      ? { connection: name }
      : { connection: name, value };
  });
}
export function validateCredential(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 8192 ||
    /[\x00-\x20\x7f]/u.test(value)
  )
    throw new RuntimeError("credential_value_invalid");
  return value;
}
function validateEntry(entry: VaultEntry): void {
  validateCredential(entry.value);
  if (
    typeof entry.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(entry.updatedAt))
  )
    throw new Error();
}

/** Only main can decrypt. Public methods return configured/missing status. */
export class CredentialVault {
  private data: VaultData;
  constructor(
    private file: string,
    private encryption: Encryption,
    databaseExists: boolean,
  ) {
    if (!encryption.isEncryptionAvailable())
      throw new RuntimeError("secure_storage_unavailable");
    privateDirectory(path.dirname(file));
    if (existsSync(file)) {
      try {
        const stat = lstatSync(file);
        if (
          !stat.isFile() ||
          stat.isSymbolicLink() ||
          stat.nlink !== 1 ||
          !privateFileMode(stat) ||
          stat.size > maxVaultBytes
        )
          throw new Error();
        const data = JSON.parse(
          encryption.decryptString(readFileSync(file)),
        ) as VaultData;
        if (
          data.version !== 1 ||
          !/^[a-f0-9]{64}$/u.test(data.postgresPassword) ||
          !data.providers ||
          typeof data.providers !== "object"
        )
          throw new Error();
        const providers: VaultData["providers"] = {};
        for (const [name, entry] of Object.entries(data.providers)) {
          if (retiredProviders.has(name)) continue;
          validateEntry(entry);
          providers[validateProvider(name)] = entry;
        }
        const connections = data.connections ?? {};
        if (
          typeof connections !== "object" ||
          Array.isArray(connections) ||
          Object.keys(connections).length > maxConnectionCredentials
        )
          throw new Error();
        for (const [name, entry] of Object.entries(connections)) {
          validateConnectionCredential(name);
          validateEntry(entry);
        }
        this.data = { ...data, providers, connections };
      } catch {
        throw new RuntimeError("vault_unreadable");
      }
    } else {
      if (databaseExists) throw new RuntimeError("vault_missing_for_database");
      this.data = {
        version: 1,
        postgresPassword: randomBytes(32).toString("hex"),
        providers: {},
        connections: {},
      };
      this.save(this.data);
    }
  }
  private save(next: VaultData): void {
    if (!this.encryption.isEncryptionAvailable())
      throw new RuntimeError("secure_storage_unavailable");
    let encrypted: Buffer;
    try {
      encrypted = this.encryption.encryptString(JSON.stringify(next));
    } catch {
      // Windows reports encryption as available once the app is ready; a
      // failing DPAPI call surfaces only here.
      throw new RuntimeError("secure_storage_unavailable");
    }
    atomicWrite(this.file, encrypted);
    this.data = next;
  }
  databasePassword(): string {
    return this.data.postgresPassword;
  }
  childEnvironment(): Record<string, string> {
    return {
      ...Object.fromEntries(
        Object.entries(this.data.providers).map(([provider, entry]) => [
          providerEnvironment[provider as CredentialProvider],
          entry.value,
        ]),
      ),
      ...Object.fromEntries(
        Object.entries(this.data.connections ?? {}).map(([name, entry]) => [
          name,
          entry.value,
        ]),
      ),
    };
  }
  list(): CredentialStatus[] {
    return [
      ...credentialProviders.map((provider) => ({
        provider,
        configured: Boolean(this.data.providers[provider]),
        updatedAt: this.data.providers[provider]?.updatedAt ?? null,
        restartRequired: false,
      })),
      ...Object.entries(this.data.connections ?? {})
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([connection, entry]) => ({
          connection,
          configured: true,
          updatedAt: entry.updatedAt,
          restartRequired: false,
        })),
    ];
  }
  set(provider: CredentialProvider, value: string): void {
    validateProvider(provider);
    validateCredential(value);
    this.save({
      ...this.data,
      providers: {
        ...this.data.providers,
        [provider]: { value, updatedAt: new Date().toISOString() },
      },
    });
  }
  delete(provider: CredentialProvider): void {
    this.apply([{ provider }]);
  }
  /**
   * Set or remove several keys in one encrypted write, so a batch is
   * all-or-nothing on disk (an omitted value removes that key).
   */
  apply(changes: ReadonlyArray<CredentialChange>): void {
    this.assertCapacity(changes);
    const providers = { ...this.data.providers };
    const connections = { ...(this.data.connections ?? {}) };
    const updatedAt = new Date().toISOString();
    for (const change of changes) {
      const value =
        change.value === undefined
          ? undefined
          : { value: validateCredential(change.value), updatedAt };
      if ("provider" in change) {
        validateProvider(change.provider);
        if (value) providers[change.provider] = value;
        else delete providers[change.provider];
      } else {
        validateConnectionCredential(change.connection);
        if (value) connections[change.connection] = value;
        else delete connections[change.connection];
      }
    }
    this.save({ ...this.data, providers, connections });
  }
  /**
   * Refuse a batch that would store more than `maxConnectionCredentials`
   * connection keys, before anything is written.
   */
  private assertCapacity(changes: ReadonlyArray<CredentialChange>): void {
    const names = new Set(Object.keys(this.data.connections ?? {}));
    for (const change of changes) {
      if (!("connection" in change)) continue;
      if (change.value === undefined) names.delete(change.connection);
      else names.add(change.connection);
    }
    if (names.size > maxConnectionCredentials)
      throw new RuntimeError("connection_credentials_full");
  }
}
