/** Public IPC contracts contain status only; credentials and host paths stay in main. */
export const credentialProviders = [
  "openai",
  "deepseek",
  "huggingface",
  "gemini",
  "elevenlabs",
] as const;
export type CredentialProvider = (typeof credentialProviders)[number];
export type CredentialStatus = {
  provider: CredentialProvider;
  configured: boolean;
  updatedAt: string | null;
  restartRequired: boolean;
  error?: string;
};
export type RuntimeStage =
  | "validating"
  | "vault"
  | "gateway"
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
export type CredentialsBridge = {
  list(): Promise<CredentialStatus[]>;
  set(provider: CredentialProvider, value: string): Promise<CredentialStatus>;
  delete(provider: CredentialProvider): Promise<void>;
};
export const featurePackIds = [
  "parakeet-stt",
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
