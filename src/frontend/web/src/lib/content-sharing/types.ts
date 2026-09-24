import type {
  ExportReview,
  ExportSummary,
  PackageImportResult,
  PackageStageStatus,
  PyAnimaListItem,
  ReviewedPackageImport,
} from "@animama/runtime-contracts/api-types";

export type SharingItem = {
  item_id: string;
  name: string;
  kind: string;
  description?: string | null;
};

export type SharingScreen =
  | "entry"
  | "export-selection"
  | "export-review"
  | "import-upload"
  | "import-review"
  | "import-recovery"
  | "complete";

/** Controlled UI contract; network, persistence and operation ownership stay in the hook. */
export type LibrarySharingFlow = {
  open: boolean;
  screen: SharingScreen;
  mode: "content" | "anima";
  items: SharingItem[];
  animas: PyAnimaListItem[];
  inventoryLoading: boolean;
  inventoryError: string | null;
  selectedIds: ReadonlySet<string>;
  animaId: string | null;
  summary: ExportSummary | null;
  summaryLoading: boolean;
  exportReview: ExportReview | null;
  importReview: ReviewedPackageImport | null;
  stage: PackageStageStatus | null;
  result: PackageImportResult | null;
  busy: boolean;
  progress: { received: number; total: number } | null;
  error: string | null;
  notice: string | null;
  hasRecovery: boolean;
  /** True only after a commit request may have reached the server. */
  commitPending: boolean;
  downloadStarted: boolean;
  downloadUrl: string | null;
  setOpen: (open: boolean) => void;
  back: () => void;
  chooseExport: () => void;
  setMode: (mode: "content" | "anima") => void;
  toggleItem: (id: string) => void;
  selectAnima: (id: string) => void;
  refreshInventory: () => void;
  prepareExport: () => void;
  refreshSummary: () => void;
  download: () => void;
  chooseFile: (file: File) => void;
  retryUpload: () => void;
  refreshImport: () => void;
  commitImport: () => void;
  recover: () => void;
  discardImport: () => void;
  openAnima: () => void;
};
