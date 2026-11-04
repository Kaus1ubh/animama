import type { ReactNode } from "react";
import { useParams } from "@tanstack/react-router";

import { SettingsProvider } from "@/ui/settings/SettingsProvider";
import { SoundProvider } from "@/ui/sound/SoundProvider";

export function SettingsGate({ children }: { children: ReactNode }) {
  const params = useParams({ strict: false });
  const animaId = typeof params?.animaId === "string" ? params.animaId : null;

  return (
    <SettingsProvider animaId={animaId}>
      <SoundProvider>{children}</SoundProvider>
    </SettingsProvider>
  );
}
