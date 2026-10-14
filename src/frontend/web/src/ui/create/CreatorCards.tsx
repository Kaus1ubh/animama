import type { TFunction } from "i18next";
import { ImagePlay, Sparkles, WandSparkles } from "lucide-react";
import type { ComponentType, SVGProps } from "react";

import type { EffectTemplateKind } from "@/lib/effects/effectTemplates";
import { cn } from "@/lib/utils";

export type CreatorIcon = ComponentType<SVGProps<SVGSVGElement>>;

/** The Create page's interactive card surface, shared with the effect picker. */
export const CREATOR_CARD_CLASS_NAME =
  "border-border/70 bg-card/92 hover:border-primary/45 focus-visible:ring-ring group flex flex-col rounded-2xl border shadow-lg shadow-black/5 transition-[border-color,box-shadow,transform] outline-none hover:-translate-y-0.5 hover:shadow-xl focus-visible:ring-2";

/** Icon and tile colours for each effect kind, as in the sidebar and Create page. */
export const EFFECT_KIND_ICONS: Record<
  EffectTemplateKind,
  { icon: CreatorIcon; className: string }
> = {
  particle: {
    icon: WandSparkles,
    className: "bg-accent text-accent-foreground",
  },
  avatar: { icon: Sparkles, className: "bg-primary text-primary-foreground" },
  scene: {
    icon: ImagePlay,
    className:
      "bg-violet-200 text-violet-950 dark:bg-violet-900 dark:text-violet-100",
  },
};

/** Display text for an effect kind's cards and picker step. */
export function effectKindText(
  t: TFunction<"create">,
  kind: EffectTemplateKind,
): { label: string; description: string; create: string; new: string } {
  switch (kind) {
    case "particle":
      return {
        label: t("effectKinds.particle.label"),
        description: t("effectKinds.particle.description"),
        create: t("effectKinds.particle.create"),
        new: t("effectKinds.particle.new"),
      };
    case "avatar":
      return {
        label: t("effectKinds.avatar.label"),
        description: t("effectKinds.avatar.description"),
        create: t("effectKinds.avatar.create"),
        new: t("effectKinds.avatar.new"),
      };
    case "scene":
      return {
        label: t("effectKinds.scene.label"),
        description: t("effectKinds.scene.description"),
        create: t("effectKinds.scene.create"),
        new: t("effectKinds.scene.new"),
      };
  }
}

export function CreatorIconTile({
  icon: Icon,
  className,
  large = false,
}: {
  icon: CreatorIcon;
  className: string;
  large?: boolean;
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-xl shadow-sm ring-1 ring-black/5",
        large ? "size-16 md:size-20" : "size-14",
        className,
      )}
    >
      <Icon className={large ? "size-8 md:size-10" : "size-7"} />
    </span>
  );
}
