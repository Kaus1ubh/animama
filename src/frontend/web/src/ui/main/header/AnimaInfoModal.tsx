"use client";

import { useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useNavigate } from "@tanstack/react-router";

import type { PyAnimaResponse } from "@/lib/content/catalogTypes";
import { getAnimaDisplayName } from "@/lib/anima-profile";
import { runtimeImagePresentation } from "@/lib/runtime-content/animaRuntimeSnapshot";
import { useRuntimeContentMediaUrl } from "@/query/hooks/useRuntimeContentMediaUrl";
import { useMountedAnimaRuntimeContent } from "@/ui/app/AnimaRouteProviders";
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
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
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
  const identity = anima?.avatar?.identity?.trim() ?? "";
  const runtimeProfileImage = useRuntimeContentMediaUrl(
    mountedRuntimeContent.data?.profile_image,
  );
  const runtimeProfileEntry = mountedRuntimeContent.data?.profile_image;
  const profileImageUrl = runtimeProfileImage.url;
  const emotionalState = emotionState ?? anima?.emotional_state ?? null;
  const currentKey = `${anima?.id ?? "anima"}:${activeSection}`;
  const identityExpanded = expandedKey === currentKey;
  const identityLimit = 220;
  const identityNeedsTruncate = identity.length > identityLimit;
  const identityText =
    identityExpanded || !identityNeedsTruncate
      ? identity
      : `${identity.slice(0, identityLimit).trimEnd()}…`;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />
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
            <div className="border-border/60 bg-muted/10 flex flex-1 flex-col gap-6 rounded-xl border p-6">
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
              <div className="grid gap-6">
                <div className="space-y-2">
                  <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                    Identity
                  </p>
                  <p className="text-foreground/90 text-sm">
                    {identityText || "No avatar identity provided yet."}{" "}
                    {identityNeedsTruncate ? (
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedKey((prev) =>
                            prev === currentKey ? null : currentKey,
                          )
                        }
                        className="text-primary inline text-xs font-medium transition hover:underline"
                      >
                        {identityExpanded ? "See less" : "See more"}
                      </button>
                    ) : null}
                  </p>
                </div>
              </div>
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
