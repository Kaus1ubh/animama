import { createFileRoute, notFound } from "@tanstack/react-router";
import { useState, type ChangeEvent } from "react";

import { AppShellPage } from "@/ui/app/AppShellPage";
import { CreateAnimaAvatarPreview } from "@/ui/create/CreateAnimaAvatarPreview";
import { DEBUG_ENABLED } from "@/platform/env";

export const Route = createFileRoute("/a/avatar-portrait-debug")({
  beforeLoad: () => {
    if (!DEBUG_ENABLED) throw notFound();
  },
  component: AvatarPortraitDebugRoute,
});

/** Development-only visual harness for Phase 1 portrait acceptance. */
function AvatarPortraitDebugRoute() {
  const [file, setFile] = useState<File | null>(null);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setFile(event.target.files?.[0] ?? null);
  };

  return (
    <AppShellPage contentClassName="max-w-5xl">
      <header className="space-y-2">
        <p className="text-muted-foreground text-xs font-semibold tracking-[0.18em] uppercase">
          Development tool
        </p>
        <h1 className="text-foreground text-3xl font-semibold">
          Avatar portrait capture
        </h1>
        <p className="text-muted-foreground max-w-3xl text-sm leading-6">
          Load a local VRM, then use Capture portrait in the preview controls.
          The exact 512 × 512 result is generated locally and is not saved to an
          Anima or uploaded.
        </p>
      </header>

      <CreateAnimaAvatarPreview
        file={file}
        fileInputProps={{
          id: "avatar-portrait-debug-file",
          accept: ".vrm,model/vrm,application/octet-stream",
          onChange: handleFileChange,
        }}
        className="w-full"
      />
    </AppShellPage>
  );
}
