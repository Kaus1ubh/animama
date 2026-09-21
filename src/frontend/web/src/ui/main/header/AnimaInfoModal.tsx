"use client";

import { useMemo } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useNavigate } from "@tanstack/react-router";

import type { PyAnimaResponse } from "@/lib/content/catalogTypes";
import { getAnimaDisplayName } from "@/lib/anima-profile";
import { runtimeImagePresentation } from "@/lib/runtime-content/animaRuntimeSnapshot";
import { useRuntimeContentMediaUrl } from "@/query/hooks/useRuntimeContentMediaUrl";
import { useMountedAnimaRuntimeContent } from "@/ui/app/AnimaRouteProviders";
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
  const mountedRuntimeContent = useMountedAnimaRuntimeContent();
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
  const runtimeProfileImage = useRuntimeContentMediaUrl(
    mountedRuntimeContent.data?.profile_image,
  );
  const runtimeProfileEntry = mountedRuntimeContent.data?.profile_image;
  const profileImageUrl = runtimeProfileImage.url;
  const emotionalState = emotionState ?? anima?.emotional_state ?? null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
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
            <div className="border-border/60 bg-muted/10 flex flex-1 flex-col gap-6 rounded-xl border p-6 xl:min-h-0">
              <div>
                <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                  Anima
                </p>
                <div className="mt-3 flex items-center gap-3">
                  {profileImageUrl ? (
                    <RuntimeImageFrame
                      src={profileImageUrl}
                      alt={`${displayName} profile`}
                      presentation={runtimeImagePresentation(
                        runtimeProfileEntry,
                      )}
                      className="border-border/70 h-12 w-12 rounded-full border object-cover"
                    />
                  ) : null}
                  <h3 className="text-foreground text-xl font-semibold">
                    {displayName}
                  </h3>
                </div>
              </div>
              {anima?.id ? (
                <div className="min-h-0 flex-1">
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
        </SectionedModalFrame>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
