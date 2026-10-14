import type {
  AnimaCreationDiagnostic,
  AnimaSpecInput,
} from "@animama/runtime-contracts/sdk";
import { useTranslation } from "react-i18next";
import { creationIssueText } from "@/lib/errors/creationErrors";
import type { AnimaCreationSources } from "@/query/hooks/useAnimaCreation";
import { useVoiceClones } from "@/query/hooks/useVoiceClones";
import { pocketVoiceLabel } from "@/lib/speech/pocket/voice-groups";
import { Button } from "@/ui/components/button";
import { MemoryMarkdownPreview } from "@/ui/memory/MemoryMarkdownPreview";
import {
  REACTION_CELL_COUNT,
  reactionCount,
  type CreateAnimaDraft,
  type CreationStep,
} from "./createAnimaDraft";

export function CreateAnimaReviewStep({
  draft,
  sources,
  spec,
  warnings,
  busy,
  onEdit,
}: {
  draft: CreateAnimaDraft;
  sources: AnimaCreationSources;
  spec: AnimaSpecInput | null;
  warnings: AnimaCreationDiagnostic[];
  busy: boolean;
  onEdit: (step: CreationStep) => void;
}) {
  const { t } = useTranslation("create");
  const avatar = sources.avatars.data?.find(
    (item) => item.item_id === draft.avatar?.item_id,
  );
  const voice = draft.voice;
  const clones = useVoiceClones({
    enabled: voice?.pocket.type === "clone" && voice.provider === "pocket_tts",
  });
  const voiceName =
    voice?.provider === "elevenlabs"
      ? voice.elevenlabs_voice_id
      : voice?.pocket.type === "preset"
        ? pocketVoiceLabel(voice.pocket.voice_id)
        : voice?.pocket.type === "clone"
          ? (clones.data?.find(
              (clone) =>
                voice.pocket.type === "clone" &&
                clone.item_id === voice.pocket.source.item_id,
            )?.name ?? t("review.voice.savedClone"))
          : t("review.voice.applicationDefault");
  const count = reactionCount(draft);
  const visibleWarnings = warnings.filter(
    (warning) => warning.path !== "/appearance/profile",
  );
  return (
    <div className="space-y-4">
      <div className="rounded-xl border p-4">
        <div className="min-w-0">
          <h3 className="text-xl font-semibold break-words">
            {draft.display_name.trim()}
          </h3>
          <p className="text-muted-foreground mt-1 text-sm">
            {avatar?.name ?? draft.avatar?.item_id ?? t("review.avatarMissing")}
          </p>
        </div>
      </div>
      <section className="rounded-xl border p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-medium">{t("review.voice.title")}</h3>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onEdit(1)}
            disabled={busy}
          >
            {t("review.voice.edit")}
          </Button>
        </div>
        <p className="text-muted-foreground mt-2 text-sm break-words">
          {voice
            ? t("review.voice.summary", {
                provider:
                  voice.provider === "pocket_tts"
                    ? t("voiceStep.providers.pocketTts")
                    : t("voiceStep.providers.elevenLabs"),
                voice: voiceName ?? "",
              })
            : voiceName}
        </p>
      </section>
      <section className="rounded-xl border p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-medium">{t("review.identity.title")}</h3>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onEdit(2)}
            disabled={busy}
          >
            {t("review.identity.edit")}
          </Button>
        </div>
        <MemoryMarkdownPreview
          value={spec?.identity_markdown ?? draft.identity_markdown}
          allowImages={false}
          className="mt-3 text-sm break-words"
        />
      </section>
      <section className="space-y-3 rounded-xl border p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-medium">{t("review.actions.title")}</h3>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onEdit(3)}
            disabled={busy}
          >
            {t("review.actions.edit")}
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-muted/30 rounded-lg p-3">
            <p className="text-xl font-semibold">{draft.gestures.length}</p>
            <p className="text-muted-foreground text-xs">
              {t("review.actions.gesturesSelected")}
            </p>
          </div>
          <div className="bg-muted/30 rounded-lg p-3">
            <p className="text-xl font-semibold">
              {count}{" "}
              <span className="text-sm font-normal">
                {t("review.actions.reactionTotal", {
                  total: REACTION_CELL_COUNT,
                })}
              </span>
            </p>
            <p className="text-muted-foreground text-xs">
              {t("review.actions.reactionCells")}
            </p>
          </div>
        </div>
      </section>
      {visibleWarnings.length ? (
        <div role="status" className="space-y-2 rounded-xl border p-4">
          <h3 className="text-sm font-medium">{t("review.warnings")}</h3>
          <ul className="text-muted-foreground list-disc space-y-1 pl-4 text-sm">
            {visibleWarnings.map((warning, index) => {
              const text = creationIssueText(warning);
              return (
                <li key={`${warning.code}:${index}`}>
                  {text.message}
                  {text.detail ? (
                    <span className="mt-1 block text-xs">{text.detail}</span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
