/**
 * Public IPC contracts contain status only; credentials and host paths stay in
 * main. Built-in provider keys, in the order App Settings → API Keys lists them.
 */
export const credentialProviders = [
  "openai",
  "anthropic",
  "elevenlabs",
] as const;
export type CredentialProvider = (typeof credentialProviders)[number];
/**
 * Environment name the backend reads for a model connection's managed key
 * (`ANIMAMA_CONNECTION_<ID>_API_KEY`); main stores at most
 * `maxConnectionCredentials` of them.
 */
export const connectionCredentialPattern =
  /^ANIMAMA_CONNECTION_[A-Z0-9_]{1,64}_API_KEY$/u;
export const maxConnectionCredentials = 32;
/** Largest renderer batch: every provider plus several connection keys. */
export const maxCredentialChanges = 8;
type CredentialState = {
  configured: boolean;
  updatedAt: string | null;
  restartRequired: boolean;
  error?: string;
};
export type ProviderCredentialStatus = CredentialState & {
  provider: CredentialProvider;
};
/** A saved model-connection key, named by its environment variable. */
export type ConnectionCredentialStatus = CredentialState & {
  connection: string;
};
export type CredentialStatus =
  | ProviderCredentialStatus
  | ConnectionCredentialStatus;
/** Narrow a status to a built-in provider key. */
export function isProviderCredential(
  status: CredentialStatus,
): status is ProviderCredentialStatus {
  return "provider" in status;
}
export type RuntimeStage =
  | "validating"
  | "vault"
  | "application"
  | "database"
  | "migrations"
  | "backend";
export type RuntimeStatus =
  | { state: "external" }
  | { state: "starting"; stage: RuntimeStage }
  | { state: "ready"; origin: string }
  | { state: "error"; code: string; backup?: string }
  | { state: "stopping" }
  | { state: "updating" }
  | { state: "stopped" };
export type RuntimeBridge = {
  status(): Promise<RuntimeStatus>;
  retry(): Promise<void>;
  openLogs(): Promise<void>;
  openBackups(): Promise<void>;
  quit(): Promise<void>;
  onStatus(callback: (status: RuntimeStatus) => void): () => void;
};
/**
 * One key change in a batch, for a built-in provider or a model connection;
 * an omitted value removes the saved key.
 */
export type CredentialChange =
  | { provider: CredentialProvider; value?: string }
  | { connection: string; value?: string };
/** The provider name or connection variable a change or status refers to. */
export function credentialTarget(
  item: CredentialChange | CredentialStatus,
): string {
  return "provider" in item ? item.provider : item.connection;
}
export type CredentialsBridge = {
  /** Every provider's status, then each saved or failed connection key. */
  list(): Promise<CredentialStatus[]>;
  /**
   * Save or remove several keys and apply them to the running backend without
   * a restart. Returns every status; failed entries carry their own `error`.
   */
  apply(changes: CredentialChange[]): Promise<CredentialStatus[]>;
};
export const featurePackIds = [
  "expanded-included-content",
  "document-processing",
] as const;
export type FeaturePackId = (typeof featurePackIds)[number];
export type FeaturePackStatus = {
  id: FeaturePackId;
  state:
    | "not_installed"
    | "downloading"
    | "verifying"
    | "installing"
    | "installed"
    | "failed"
    | "update_available";
  available: boolean;
  version?: string;
  activeVersion?: string;
  hasInstalledFiles?: boolean;
  assetVersion?: string;
  downloadBytes?: number;
  installedBytes?: number;
  minimumFreeBytes?: number;
  transferredBytes?: number;
  progress?: number;
  error?: string;
  blockers?: { kind: string; id: string; label: string }[];
};
export type FeaturePacksBridge = {
  list(): Promise<FeaturePackStatus[]>;
  install(id: FeaturePackId): Promise<void>;
  cancel(id: FeaturePackId): Promise<void>;
  remove(id: FeaturePackId): Promise<void>;
  onProgress(callback: (value: FeaturePackStatus) => void): () => void;
};
export type UpdatesBridge = {
  status(): Promise<UpdateStatus>;
  check(): Promise<UpdateStatus>;
  download(): Promise<UpdateStatus>;
  restart(): Promise<void>;
  onStatus(callback: (status: UpdateStatus) => void): () => void;
};
export type UpdateStatus =
  | { state: "unavailable" | "idle" | "checking" | "up_to_date" }
  | {
      state: "available" | "downloaded";
      version: string;
      downloadBytes: number;
      minimumFreeBytes: number;
    }
  | {
      state: "downloading";
      version: string;
      downloadBytes: number;
      minimumFreeBytes: number;
      progress: number;
    }
  | { state: "restarting"; version: string }
  | {
      state: "error";
      code: string;
      retry: "check" | "download" | "restart";
      version?: string;
    };
