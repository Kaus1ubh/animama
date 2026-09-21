"use client";

import { useMemo, useRef, useState } from "react";
import { Camera } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { useNavigate } from "@tanstack/react-router";

import type { PyAnimaResponse } from "@/lib/content/catalogTypes";
import { getAnimaDisplayName } from "@/lib/anima-profile";
import { runtimeImagePresentation } from "@/lib/runtime-content/animaRuntimeSnapshot";
import { useRuntimeContentMediaUrl } from "@/query/hooks/useRuntimeContentMediaUrl";
import { adaptRuntimeSnapshot } from "@/lib/runtime-content/runtimeSnapshotAdapter";
import { useAnimas } from "@/query/hooks/useAnimas";
import { useAnimaRuntimeCatalog } from "@/query/hooks/useAnimaRuntimeCatalog";
import { useAnimaPresentationImage } from "@/query/hooks/useAnimaPresentationImage";
import {
  AnimaAppearanceDialog,
  type AnimaAppearanceSection,
} from "@/ui/animas/AnimaAppearanceDialog";
import { AnimaIdentitySection } from "@/ui/animas/AnimaIdentitySection";
import { useMemoryEntryByPath } from "@/query/hooks/useMemoryEntries";
import { resolveAnimaIdentityContent } from "@/lib/animas/anima-management-presentation";
import { DialogOverlay } from "@/ui/components/dialog";
import { Button } from "@/ui/components/button";
import { EmotionalState } from "@/ui/components/emotional-state";
import { SectionedModalFrame } from "@/ui/components/sectioned-modal-frame";
import { RuntimeImageFrame } from "@/ui/components/runtime-image-frame";
import { AnimaSettingsModal } from "@/ui/main/header/AnimaSettingsModal";

const sections = ["General", "Emotional State", "Settings"] as const;

export type AnimaInfoSection = (typeof sections)[number];

type AnimaInfoModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeSection: AnimaInfoSection;
  onSectionChange: (section: AnimaInfoSection) => void;
  animaLabel?: string;
  anima?: PyAnimaResponse | null;
  emotionState?: unknown;
  emotionSourceLabel?: string | null;
};

export function AnimaInfoModal({
  open,
  onOpenChange,
  activeSection,
  onSectionChange,
  animaLabel,
  anima,
  emotionState,
  emotionSourceLabel = null,
}: AnimaInfoModalProps) {
  const navigate = useNavigate();
  const appearanceTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [appearanceSection, setAppearanceSection] =
    useState<AnimaAppearanceSection | null>(null);
  const animasQuery = useAnimas({ enabled: open });
  // Editable appearance follows live queries; chat retains its mounted runtime.
  const runtimeQuery = useAnimaRuntimeCatalog(open ? anima?.id : null);
  const backgroundEntry = useMemo(
    () =>
      runtimeQuery.data
        ? adaptRuntimeSnapshot(runtimeQuery.data).background_image
        : null,
    [runtimeQuery.data],
  );
  const identityQuery = useMemoryEntryByPath({
    animaId: anima?.id,
    path: "IDENTITY.md",
    type: "file",
    enabled: open && activeSection === "General" && Boolean(anima?.id),
  });
  const openAnimaDetailsPage = (animaId: string) => {
    onOpenChange(false);
    void navigate({
      to: "/a/animas/$animaId",
      params: { animaId },
    });
  };

  const description = useMemo(() => {
    switch (activeSection) {
      case "General":
        return "High-level anima details and identity.";
      case "Emotional State":
        return "Current mood, baseline affect, and emotional dynamics.";
      case "Settings":
        return "Advanced configuration and integration settings.";
      default:
        return "";
    }
  }, [activeSection]);

  const displayName = anima
    ? getAnimaDisplayName(anima)
    : (animaLabel ?? "Anima");
  const fallbackIdentity = anima?.avatar?.identity?.trim() ?? "";
  const identity = resolveAnimaIdentityContent(
    identityQuery.data?.content,
    fallbackIdentity,
  );
  const profileThumbnail =
    animasQuery.data?.find((candidate) => candidate.id === anima?.id)
      ?.presentation.profile_thumbnail ?? null;
  const profileImage = useAnimaPresentationImage(profileThumbnail);
  const backgroundImage = useRuntimeContentMediaUrl(backgroundEntry);
  const emotionalState = emotionState ?? anima?.emotional_state ?? null;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) setAppearanceSection(null);
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <DialogOverlay className="z-40" />
        <SectionedModalFrame
          title="Anima details"
          description="Configure anima settings and behavior."
          closeLabel="Close anima details"
          sidebarLabel="Anima"
          sidebarTitle={displayName}
          sections={sections}
          activeSection={activeSection}
          onSectionChange={onSectionChange}
          headerTitle={activeSection}
          headerDescription={description}
          headerMeta={
            anima?.id ? (
              <div className="mt-3">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => openAnimaDetailsPage(anima.id)}
                >
                  Open full details
                </Button>
              </div>
            ) : null
          }
        >
          {activeSection === "General" ? (
            <div className="flex min-w-0 flex-1 flex-col gap-5">
              <div className="border-border/60 bg-card shrink-0 overflow-hidden rounded-xl border">
                <div className="bg-muted relative h-36 sm:h-44">
                  {backgroundImage.url ? (
                    <RuntimeImageFrame
                      src={backgroundImage.url}
                      alt={`${displayName} background`}
                      presentation={runtimeImagePresentation(backgroundEntry)}
                      className="size-full"
                    />
                  ) : null}
                  {anima?.id ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        appearanceTriggerRef.current = event.currentTarget;
                        setAppearanceSection("background_image");
                      }}
                      aria-label="Edit background image"
                      className="focus-visible:ring-ring absolute top-1/2 left-1/2 flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white transition-colors hover:bg-black/70 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                    >
                      <Camera className="size-5" aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
                <div className="px-4 pb-5 sm:px-6">
                  <div className="border-card bg-muted relative -mt-12 flex size-24 items-center justify-center rounded-full border-4 sm:-mt-14 sm:size-28">
                    {profileImage.url ? (
                      <RuntimeImageFrame
                        src={profileImage.url}
                        alt={`${displayName} profile`}
                        presentation={profileImage.presentation}
                        className="size-full rounded-full"
                      />
                    ) : (
                      <span className="text-muted-foreground text-2xl font-semibold">
                        {displayName.slice(0, 2).toLocaleUpperCase()}
                      </span>
                    )}
                    {anima?.id ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          appearanceTriggerRef.current = event.currentTarget;
                          setAppearanceSection("profile_image");
                        }}
                        aria-label="Edit profile image"
                        className="focus-visible:ring-ring absolute top-1/2 left-1/2 flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white transition-colors hover:bg-black/70 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                      >
                        <Camera className="size-5" aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                  <h3 className="text-foreground mt-3 text-xl font-semibold [overflow-wrap:anywhere]">
                    {displayName}
                  </h3>
                </div>
              </div>
              {anima?.id ? (
                <div className="min-h-48 flex-1">
                  <AnimaIdentitySection
                    animaId={anima.id}
                    identity={identity}
                    identityLoading={identityQuery.isLoading}
                    identityError={identityQuery.isError}
                    fallbackIdentity={fallbackIdentity}
                    onEdit={() => onOpenChange(false)}
                  />
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">
                  No identity content provided yet.
                </p>
              )}
            </div>
          ) : activeSection === "Emotional State" ? (
            <div className="border-border/60 bg-muted/10 flex flex-1 flex-col gap-6 rounded-xl border p-6">
              <div>
                <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                  Emotional state
                </p>
                <p className="text-muted-foreground mt-2 text-sm">
                  Ranked categorical emotion levels for the current anima state.
                </p>
              </div>
              <EmotionalState
                emotionalState={emotionalState}
                sourceLabel={emotionSourceLabel}
              />
            </div>
          ) : activeSection === "Settings" ? (
            <AnimaSettingsModal />
          ) : (
            <div className="border-border/60 bg-muted/20 text-muted-foreground flex flex-1 items-center justify-center rounded-xl border border-dashed p-8 text-sm">
              Section content coming soon.
            </div>
          )}
          {anima?.id && appearanceSection ? (
            <AnimaAppearanceDialog
              animaId={anima.id}
              animaName={displayName}
              profileThumbnail={profileThumbnail}
              section={appearanceSection}
              onSectionChange={setAppearanceSection}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                appearanceTriggerRef.current?.focus();
              }}
              onOpenChange={(next) => !next && setAppearanceSection(null)}
            />
          ) : null}
        </SectionedModalFrame>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
