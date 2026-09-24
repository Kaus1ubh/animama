import { useEffect, useId, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  ArrowLeftRight,
  Download,
  FileArchive,
  FolderOpen,
  Upload,
  UserRound,
} from "lucide-react";
import type { LibrarySharingFlow } from "@/lib/content-sharing/types";
import { Button } from "@/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/ui/components/dialog";
import { ContentExportSelection } from "./ContentExportSelection";
import { ContentExportReview } from "./ContentExportReview";
import { ContentImportReview } from "./ContentImportReview";
import { SharingItemRow } from "./SharingPackageDetails";
import { sharingDropSelection, sharingSize } from "./sharingPresentation";

/** Controlled sharing surface; the hook retains operations even when this closes. */
export function LibrarySharingDialog({ flow }: { flow: LibrarySharingFlow }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [dropError, setDropError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (flow.open) heading.current?.focus();
  }, [flow.open, flow.screen]);
  const fileId = useId();
  const chooseFile = () => fileInput.current?.click();
  const title = {
    entry: "Import / Export",
    "export-selection": "Export",
    "export-review": "Review export",
    "import-upload": "Choose file",
    "import-review": "Review import",
    "import-recovery": "Import status",
    complete: "Import complete",
  }[flow.screen];
  const isEntry = flow.screen === "entry";
  const canChooseFile = !flow.busy && !flow.commitPending;
  return (
    <Dialog open={flow.open} onOpenChange={flow.setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <ArrowLeftRight aria-hidden="true" />
          Import / Export
        </Button>
      </DialogTrigger>
      <DialogContent
        avoidSidebar
        className={`flex max-h-[calc(100dvh-2rem)] flex-col gap-5 overflow-hidden p-5 sm:p-8 ${isEntry ? "sm:w-[58rem]" : flow.screen === "import-review" || flow.screen === "import-upload" || flow.screen === "import-recovery" ? "sm:w-[48rem]" : "sm:w-[64rem]"}`}
      >
        <input
          ref={fileInput}
          id={fileId}
          type="file"
          accept=".zip"
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose .zip file"
          disabled={!canChooseFile}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file && canChooseFile) {
              setDropError(null);
              flow.chooseFile(file);
            }
            event.target.value = "";
          }}
        />
        <header className="shrink-0 pr-6">
          <div className="flex items-center gap-3">
            {!isEntry && flow.screen !== "complete" && !flow.commitPending ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Back"
                disabled={flow.busy}
                onClick={flow.back}
              >
                <ArrowLeft aria-hidden="true" />
              </Button>
            ) : null}
            <DialogTitle
              ref={heading}
              tabIndex={-1}
              className="text-2xl font-semibold tracking-tight outline-none"
            >
              {title}
            </DialogTitle>
          </div>
          <DialogDescription className="sr-only">
            Review the content shared through your local Animama application.
          </DialogDescription>
        </header>
        <div key={flow.screen} className="min-h-0 overflow-y-auto">
          <div className="grid gap-5">
            {flow.error ? (
              <p
                role="alert"
                className="text-destructive rounded-lg border p-3 text-sm break-words"
              >
                {flow.error}
              </p>
            ) : null}
            {flow.notice ? (
              <p
                role="status"
                className="bg-muted rounded-lg p-3 text-sm break-words"
              >
                {flow.notice}
              </p>
            ) : null}
            {isEntry ? (
              <>
                {flow.hasRecovery ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
                    <p>An earlier import needs your attention.</p>
                    <Button
                      variant="outline"
                      onClick={flow.recover}
                      disabled={flow.busy}
                    >
                      Check import status
                    </Button>
                  </div>
                ) : null}
                <div className="grid gap-5 md:grid-cols-2">
                  <section className="flex flex-col gap-4 rounded-2xl border p-5 sm:p-6">
                    <div className="flex items-start gap-4">
                      <div className="bg-primary/15 text-foreground flex size-14 shrink-0 items-center justify-center rounded-xl">
                        <Download aria-hidden="true" className="size-7" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-xl font-semibold">Import</h3>
                      </div>
                    </div>
                    <div
                      className="mt-auto space-y-3 rounded-xl border border-dashed p-5 text-center"
                      onDragOver={(event) => {
                        event.preventDefault();
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        if (!canChooseFile) return;
                        const selection = sharingDropSelection(
                          event.dataTransfer.files,
                        );
                        setDropError(selection.error);
                        if (selection.file) flow.chooseFile(selection.file);
                      }}
                    >
                      <p className="text-muted-foreground text-sm">
                        Drop a .zip file here
                      </p>
                      {dropError ? (
                        <p role="alert" className="text-destructive text-sm">
                          {dropError}
                        </p>
                      ) : null}
                      <Button
                        className="w-full"
                        disabled={!canChooseFile}
                        onClick={chooseFile}
                      >
                        Choose file
                      </Button>
                    </div>
                  </section>
                  <section className="flex flex-col gap-4 rounded-2xl border p-5 sm:p-6">
                    <div className="flex items-start gap-4">
                      <div className="bg-secondary text-secondary-foreground flex size-14 shrink-0 items-center justify-center rounded-xl">
                        <Upload aria-hidden="true" className="size-7" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-xl font-semibold">Export</h3>
                      </div>
                    </div>
                    <div className="space-y-4 py-2">
                      <p className="flex items-center gap-3">
                        <UserRound
                          aria-hidden="true"
                          className="text-muted-foreground size-5"
                        />
                        A complete Anima
                      </p>
                      <p className="flex items-center gap-3">
                        <FolderOpen
                          aria-hidden="true"
                          className="text-muted-foreground size-5"
                        />
                        One or more content items
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      className="mt-auto w-full"
                      onClick={flow.chooseExport}
                      disabled={flow.busy || flow.commitPending}
                    >
                      Choose what to export
                      <ArrowRight aria-hidden="true" />
                    </Button>
                  </section>
                </div>
              </>
            ) : null}
            {flow.screen === "export-selection" ? (
              <ContentExportSelection flow={flow} />
            ) : null}
            {flow.screen === "export-review" ? (
              <ContentExportReview flow={flow} />
            ) : null}
            {flow.screen === "import-review" ? (
              <ContentImportReview flow={flow} />
            ) : null}
            {flow.screen === "import-upload" ? (
              <div className="space-y-5">
                <div className="rounded-xl border p-5">
                  <FileArchive
                    aria-hidden="true"
                    className="text-muted-foreground mb-3 size-8"
                  />
                  <p className="font-medium break-words">
                    {flow.stage?.filename ?? "Preparing your file…"}
                  </p>
                  {flow.progress ? (
                    <div className="mt-4 space-y-2">
                      <progress
                        className="w-full"
                        aria-label="File upload"
                        max={flow.progress.total || 1}
                        value={flow.progress.received}
                      />
                      <p
                        role="status"
                        className="text-muted-foreground text-sm"
                      >
                        {sharingSize(flow.progress.received)} of{" "}
                        {sharingSize(flow.progress.total)}
                      </p>
                    </div>
                  ) : (
                    <p role="status" className="text-muted-foreground mt-2">
                      Preparing the package for review…
                    </p>
                  )}
                </div>
                {!flow.busy && !flow.commitPending ? (
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={flow.retryUpload}>Retry upload</Button>
                    {flow.stage ? (
                      <Button variant="outline" onClick={chooseFile}>
                        Choose file to resume
                      </Button>
                    ) : (
                      <Button variant="outline" onClick={chooseFile}>
                        Choose file
                      </Button>
                    )}
                    <Button variant="ghost" onClick={flow.discardImport}>
                      Discard import
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {flow.screen === "import-recovery" ? (
              <div className="space-y-4">
                <p>
                  {flow.commitPending
                    ? "The import may still be running. Check its status before starting another import. You can close this dialog and return later."
                    : "Check the saved import to continue from its current state."}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={flow.recover} disabled={flow.busy}>
                    Check import status
                  </Button>
                  {!flow.commitPending ? (
                    <Button
                      variant="outline"
                      onClick={flow.discardImport}
                      disabled={flow.busy}
                    >
                      Discard import
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
            {flow.screen === "complete" && flow.result ? (
              <div className="space-y-5">
                <p>
                  {flow.result.anima_id
                    ? "Your new Anima and its content have been installed."
                    : "Your content has been added to the Library as independent copies."}
                </p>
                <div className="divide-y rounded-xl border">
                  {flow.result.items
                    .filter(
                      (item) => item.selected || Boolean(flow.result?.anima_id),
                    )
                    .map((item) => (
                      <SharingItemRow
                        key={item.item_id}
                        item={{ id: item.item_id, ...item }}
                      />
                    ))}
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="outline" asChild>
                    <Link to="/a/library" onClick={() => flow.setOpen(false)}>
                      View in Library
                    </Link>
                  </Button>
                  {flow.result.anima_id ? (
                    <Button onClick={flow.openAnima} disabled={flow.busy}>
                      Open Anima
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
