import { useProductApiClient } from "@animama/product-ui";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getI18n, useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import type {
  ExportReview,
  PackageSelectionRequest,
} from "@animama/runtime-contracts/api-types";
import {
  useRuntimeCacheKey,
  useRuntimeOwnerId,
} from "@/app/runtime/RuntimeOwnerContext";
import {
  PackageImportSession,
  type RecoveryStore,
} from "@/lib/content-sharing/importSession";
import { importRecoveryStore } from "@/lib/content-sharing/recoveryStore";
import {
  isAbsentPackageStage,
  sharingErrorMessage,
} from "@/lib/content-sharing/errors";
import type {
  LibrarySharingFlow,
  SharingScreen,
} from "@/lib/content-sharing/types";
import { offerCreationRuntime } from "@/lib/runtime-content/creationRuntimeHandoff";
import {
  RuntimeMountPreparer,
  type PreparedRuntimeMount,
} from "@/lib/runtime-content/RuntimeMountPreparer";
import { invalidateContentCatalogViews } from "@/query/contentCatalogInvalidation";
import { queryKeys } from "@/query/keys";
import {
  createPackageExportApi,
  createPackageImportApi,
} from "@/query/mutations/packageSharingApi";
import { useAnimas } from "./useAnimas";
import { useSharingInventory } from "./useSharingInventory";
import { fetchAnimaRuntimeCatalog } from "./useAnimaRuntimeCatalog";
import { useRuntimeCapabilities } from "./useRuntimeCapabilities";

function storage(owner: string): RecoveryStore {
  try {
    return importRecoveryStore(owner, window.localStorage);
  } catch {
    const t = getI18n().getFixedT(null, "library");
    return {
      read: () => {
        throw new Error(t("sharing.import.storageUnavailable"));
      },
      write: () => {
        throw new Error(t("sharing.import.enableStorage"));
      },
    };
  }
}

/** Own exact export snapshots and one recoverable import independently of dialog presentation. */
export function useLibrarySharingFlow(): LibrarySharingFlow {
  const apiClient = useProductApiClient();
  const { t } = useTranslation("library");

  const packageImportApi = useMemo(
    () => createPackageImportApi(apiClient),
    [apiClient],
  );
  const packageExportApi = useMemo(
    () => createPackageExportApi(apiClient),
    [apiClient],
  );
  const owner = useRuntimeCacheKey() ?? "__anon__";
  const installationOwner = useRuntimeOwnerId() ?? "__anon__";
  const recoveryOwner = owner.startsWith("hosted:") ? owner : installationOwner;
  const client = useQueryClient();
  const navigate = useNavigate();
  const session = useMemo(
    // Only opaque receipt identifiers survive reentry; private queries, drafts and
    // bytes still belong to the fresh session. The server authorizes every receipt.
    () => new PackageImportSession(packageImportApi, storage(recoveryOwner)),
    [recoveryOwner, packageImportApi],
  );
  const imported = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  const { data: capabilities } = useRuntimeCapabilities();
  const animaImportUnavailable =
    imported.review?.kind === "anima" && capabilities?.anima_creation !== true;
  const [open, setOpenState] = useState(false);
  const [page, setPage] = useState<
    "export-selection" | "export-review" | "import"
  >("import");
  const [mode, setModeState] = useState<"content" | "anima">("content");
  const [selectedIds, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [animaId, setAnima] = useState<string | null>(null);
  const [exportReview, setExportReview] = useState<ExportReview | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const exportLock = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [downloadStarted, setDownloadStarted] = useState(false);
  const runtimeAbort = useRef<AbortController | null>(null);
  const inventory = useSharingInventory(open && page === "export-selection");
  const animas = useAnimas({ enabled: open && page === "export-selection" });
  const selection = useMemo<PackageSelectionRequest>(
    () =>
      mode === "content"
        ? { item_ids: [...selectedIds].sort() }
        : { anima_id: animaId },
    [mode, selectedIds, animaId],
  );
  const hasSelection =
    mode === "content" ? selectedIds.size > 0 : Boolean(animaId);
  const summary = useQuery({
    queryKey: queryKeys.content.sharingSummary(
      owner,
      JSON.stringify(selection),
    ),
    enabled:
      owner !== "__anon__" &&
      open &&
      page === "export-selection" &&
      hasSelection,
    retry: false,
    staleTime: 0,
    queryFn: ({ signal }) => packageExportApi.summary(selection, signal),
  });
  useEffect(
    () => () => {
      session.pause();
      runtimeAbort.current?.abort();
    },
    [session],
  );
  useEffect(() => {
    if (!imported.result) return;
    void client.invalidateQueries({ queryKey: queryKeys.content.all(owner) });
    void client.invalidateQueries({ queryKey: queryKeys.animas.all(owner) });
    if (imported.result.anima_id) {
      void client.invalidateQueries({
        queryKey: queryKeys.memoryEntries.animaIdentities(owner),
      });
    }
    void invalidateContentCatalogViews(client, owner);
  }, [client, owner, imported.result]);

  async function releaseExport() {
    // A click may precede the browser's download lease. The server can reclaim
    // finished attempts under quota pressure; DELETE here could race its startup.
    if (exportReview && !downloadStarted) {
      try {
        await packageExportApi.discard(exportReview.export_id);
      } catch (failure) {
        if (!isAbsentPackageStage(failure)) throw failure;
      }
    }
    setExportReview(null);
    setDownloadStarted(false);
  }
  async function runExport(action: () => Promise<void>) {
    if (exportLock.current) return;
    exportLock.current = true;
    setExportBusy(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(sharingErrorMessage(failure));
    } finally {
      exportLock.current = false;
      setExportBusy(false);
    }
  }
  function setOpen(next: boolean) {
    if (next) {
      setOpenState(true);
      return;
    }
    if (imported.pending || (imported.busy && page === "import")) {
      session.pause();
      setOpenState(false);
      return;
    }
    if (exportLock.current) return;
    void runExport(async () => {
      if (imported.hasRecovery && !(await session.discard())) {
        setPage("import");
        return;
      }
      await releaseExport();
      setOpenState(false);
      setPage("import");
      setNotice(null);
    });
  }
  /** Either entry point resumes an unresolved import before starting another operation. */
  function openFlow(target: "import" | "export-selection") {
    if (exportLock.current) return;
    setOpenState(true);
    setError(null);
    setNotice(null);
    setPage(imported.hasRecovery ? "import" : target);
    if (imported.hasRecovery) void session.recover();
  }
  const screen: SharingScreen =
    page === "import"
      ? (
          {
            idle: "import-selection",
            upload: "import-upload",
            review: "import-review",
            recovery: "import-recovery",
            complete: "complete",
          } as const
        )[imported.phase]
      : page;
  const busy = exportBusy || imported.busy;
  const canChange = !busy;
  return {
    open,
    screen,
    mode,
    items: inventory.data ?? [],
    animas: animas.data ?? [],
    inventoryLoading: inventory.isLoading || animas.isLoading,
    inventoryError:
      inventory.error || animas.error
        ? sharingErrorMessage(inventory.error ?? animas.error)
        : null,
    selectedIds,
    animaId,
    summary: hasSelection ? (summary.data ?? null) : null,
    summaryLoading: hasSelection && summary.isFetching,
    exportReview,
    importReview: imported.review,
    stage: imported.stage,
    result: imported.result,
    busy,
    progress: imported.progress,
    error:
      (animaImportUnavailable ? t("sharing.import.animaUnavailable") : null) ??
      error ??
      (page === "import"
        ? imported.error
        : summary.error
          ? sharingErrorMessage(summary.error)
          : null),
    notice,
    hasRecovery: imported.hasRecovery,
    commitPending: imported.pending,
    downloadStarted,
    downloadUrl: exportReview
      ? `/v1/content/package-exports/${encodeURIComponent(exportReview.export_id)}/file`
      : null,
    setOpen,
    back: () => {
      if (!canChange || imported.pending) return;
      void runExport(async () => {
        if (page === "import") {
          if (await session.discard()) setPage("import");
        } else if (page === "export-review") {
          await releaseExport();
          setPage("export-selection");
        } else setPage("import");
        setNotice(null);
      });
    },
    chooseImport: () => openFlow("import"),
    chooseExport: () => openFlow("export-selection"),
    setMode: (value) => {
      if (canChange) {
        setModeState(value);
        setError(null);
      }
    },
    toggleItem: (id) => {
      if (!canChange) return;
      setSelected((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      setError(null);
    },
    selectAnima: (id) => {
      if (canChange) {
        setAnima(id);
        setError(null);
      }
    },
    refreshInventory: () => {
      void inventory.refetch();
      void animas.refetch();
    },
    refreshSummary: () => {
      setError(null);
      if (hasSelection) void summary.refetch();
    },
    prepareExport: () => {
      if (
        !hasSelection ||
        !summary.data ||
        summary.isFetching ||
        summary.isError ||
        busy
      )
        return;
      const frozenSelection = selection;
      const digest = summary.data.digest;
      void runExport(async () => {
        const reviewed = await packageExportApi.prepare(
          frozenSelection,
          digest,
        );
        setExportReview(reviewed);
        setDownloadStarted(false);
        setPage("export-review");
        setNotice(null);
      });
    },
    download: () => {
      if (!exportReview || busy) return;
      if (Date.parse(exportReview.expires_at) <= Date.now()) {
        setError(t("sharing.export.expired"));
        return;
      }
      const anchor = document.createElement("a");
      anchor.href = `/v1/content/package-exports/${encodeURIComponent(exportReview.export_id)}/file`;
      anchor.download = exportReview.filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setDownloadStarted(true);
      setNotice(t("sharing.export.downloadNotice"));
    },
    chooseFile: (file) => {
      if (!busy) {
        setError(null);
        setNotice(null);
        setPage("import");
        void session.upload(file);
      }
    },
    retryUpload: () => {
      void session.retryUpload();
    },
    refreshImport: () => {
      void session.refresh();
    },
    commitImport: () => {
      if (!animaImportUnavailable) void session.commit();
    },
    recover: () => {
      setPage("import");
      setError(null);
      void session.recover();
    },
    discardImport: () => {
      void session.discard().then((discarded) => {
        if (discarded) {
          setPage("import");
          setError(null);
          setNotice(null);
        }
      });
    },
    openAnima: () => {
      const id = imported.result?.anima_id;
      if (!id || busy) return;
      void runExport(async () => {
        const controller = new AbortController();
        runtimeAbort.current = controller;
        const signal = AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(90_000),
        ]);
        let mount: PreparedRuntimeMount | null = null;
        let transferred = false;
        setNotice(t("sharing.import.preparingAnima"));
        try {
          const typed = await fetchAnimaRuntimeCatalog(apiClient, id, signal);
          mount = await new RuntimeMountPreparer().prepare(typed, { signal });
          signal.throwIfAborted();
          if (mount.playbackStatus === "degraded" || !typed.can_chat)
            throw new Error(t("sharing.import.runtimeUnavailable"));
          client.setQueryData(
            queryKeys.animaLoadouts.runtime(owner, id),
            typed,
          );
          offerCreationRuntime(owner, id, typed, mount, () => {
            void session.discard();
          });
          transferred = true;
          await navigate({ to: "/$animaId", params: { animaId: id } });
        } finally {
          if (!transferred) mount?.dispose();
          runtimeAbort.current = null;
          setNotice(null);
        }
      });
    },
  };
}
