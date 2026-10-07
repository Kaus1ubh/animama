"use client";

import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Hand, HeartPulse, UsersRound } from "lucide-react";
import { useRef, useState } from "react";

import {
  EFFECT_TEMPLATE_KINDS,
  EFFECT_TEMPLATE_KIND_INFO,
  type EffectTemplateKind,
} from "@/lib/effects/effectTemplates";
import { cn } from "@/lib/utils";
import { AppShellPage } from "@/ui/app/AppShellPage";
import { RuntimeFeatureGate } from "@/ui/app/RuntimeFeatureGate";
import { Button } from "@/ui/components/button";
import {
  CREATOR_CARD_CLASS_NAME,
  CreatorIconTile,
  EFFECT_KIND_ICONS,
  type CreatorIcon,
} from "@/ui/create/CreatorCards";
import { EffectTemplatePickerDialog } from "@/ui/create/EffectTemplatePickerDialog";

type AvailableCreatorCard = {
  title: string;
  description: string;
  action: string;
  to: "/gestures/new" | "/reactions/new";
  icon: CreatorIcon;
  iconClassName: string;
};

const ACTION_CREATORS: AvailableCreatorCard[] = [
  {
    title: "Gesture",
    description: "Choreograph expressive movement and reusable actions.",
    action: "Create Gesture",
    to: "/gestures/new",
    icon: Hand,
    iconClassName: "bg-secondary text-secondary-foreground",
  },
  {
    title: "Reaction",
    description: "Design emotional responses your Anima can perform.",
    action: "Create Reaction",
    to: "/reactions/new",
    icon: HeartPulse,
    iconClassName: "bg-secondary text-secondary-foreground",
  },
];

function ActionCreatorCard({ card }: { card: AvailableCreatorCard }) {
  return (
    <article className="border-border/70 bg-card/92 hover:border-primary/45 group flex min-h-48 flex-col justify-between rounded-2xl border p-5 shadow-lg shadow-black/5 transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:shadow-xl md:p-6">
      <div className="flex items-start gap-4">
        <CreatorIconTile icon={card.icon} className={card.iconClassName} />
        <div className="min-w-0 space-y-1.5">
          <h3 className="text-xl font-semibold">{card.title}</h3>
          <p className="text-muted-foreground text-sm leading-6">
            {card.description}
          </p>
        </div>
      </div>
      <Button
        asChild
        className="bg-foreground text-background hover:bg-foreground/90 mt-5 w-fit shadow-md"
      >
        <Link to={card.to}>
          {card.action}
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </Button>
    </article>
  );
}

/** An effect kind's card; it opens the template picker at that kind. */
function EffectKindCard({
  kind,
  onOpen,
}: {
  kind: EffectTemplateKind;
  onOpen: (kind: EffectTemplateKind, opener: HTMLButtonElement) => void;
}) {
  const info = EFFECT_TEMPLATE_KIND_INFO[kind];
  const { icon, className } = EFFECT_KIND_ICONS[kind];
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      className={cn(CREATOR_CARD_CLASS_NAME, "min-h-48 p-5 text-left")}
      onClick={(event) => onOpen(kind, event.currentTarget)}
    >
      <CreatorIconTile icon={icon} className={className} />
      <h3 className="mt-5 text-lg font-semibold">{info.label}</h3>
      <p className="text-muted-foreground mt-1.5 flex-1 text-sm leading-6">
        {info.description}
      </p>
      <span className="text-foreground mt-5 flex items-center gap-1 text-sm font-semibold">
        {`Create ${info.label}`}
        <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
      </span>
    </button>
  );
}

/**
 * Showcase every supported creator while preserving the product hierarchy.
 * Effect cards open the Effects template picker in place. `/effects/new`
 * renders this page with the picker open (`effectPickerRoute`); closing it
 * there returns to `/create`.
 */
export function CreateHubPage({
  effectPickerRoute = false,
}: {
  effectPickerRoute?: boolean;
}) {
  const navigate = useNavigate();
  const [picker, setPicker] = useState<{
    open: boolean;
    kind: EffectTemplateKind | null;
  }>({ open: effectPickerRoute, kind: null });
  /** The effect card that opened the picker in place; focus returns to it. */
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const closePicker = () => {
    // Replace, so browser Back does not reopen the picker route.
    if (effectPickerRoute) void navigate({ to: "/create", replace: true });
    else setPicker((current) => ({ ...current, open: false }));
  };
  return (
    <AppShellPage contentClassName="max-w-6xl gap-9 py-8 md:py-10">
      <header className="space-y-2">
        <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
          Create
        </h1>
        <p className="text-muted-foreground max-w-3xl text-base leading-7 md:text-lg">
          Create characters, actions, and effects for your Animas.
        </p>
      </header>

      <RuntimeFeatureGate capability="anima_creation">
        <section
          aria-labelledby="anima-creator-title"
          className="border-border/70 bg-card/92 hover:border-primary/45 group flex min-h-72 flex-col items-start justify-center rounded-3xl border p-6 shadow-lg shadow-black/5 transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:shadow-xl md:p-9"
        >
          <div className="flex items-start gap-5">
            <CreatorIconTile
              icon={UsersRound}
              className="bg-primary text-primary-foreground"
              large
            />
            <div className="space-y-2">
              <h2
                id="anima-creator-title"
                className="text-3xl font-semibold tracking-tight md:text-4xl"
              >
                Anima
              </h2>
              <p className="text-muted-foreground max-w-md text-sm leading-6 md:text-base">
                Create the companion at the heart of every conversation.
              </p>
            </div>
          </div>
          <Button
            asChild
            size="lg"
            className="bg-foreground text-background hover:bg-foreground/90 mt-7 shadow-lg"
          >
            <Link to="/animas/new">
              Create Anima <ArrowRight className="size-4" />
            </Link>
          </Button>
        </section>
      </RuntimeFeatureGate>

      <section aria-labelledby="action-creators-title" className="space-y-4">
        <div className="space-y-1">
          <h2
            id="action-creators-title"
            className="text-2xl font-semibold tracking-tight"
          >
            Actions
          </h2>
          <p className="text-muted-foreground text-sm md:text-base">
            Give your Anima movement, personality, and emotion.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {ACTION_CREATORS.map((card) => (
            <ActionCreatorCard key={card.to} card={card} />
          ))}
        </div>
      </section>

      <section
        aria-labelledby="effect-creators-title"
        className="space-y-4 pb-5"
      >
        <div className="space-y-1">
          <h2
            id="effect-creators-title"
            className="text-2xl font-semibold tracking-tight"
          >
            Effects
          </h2>
          <p className="text-muted-foreground text-sm md:text-base">
            Layer reusable effects into Gestures and Reactions. Upload sounds in
            their SFX tabs or the accompanying-sound pickers.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {EFFECT_TEMPLATE_KINDS.map((kind) => (
            <EffectKindCard
              key={kind}
              kind={kind}
              onOpen={(next, opener) => {
                openerRef.current = opener;
                setPicker({ open: true, kind: next });
              }}
            />
          ))}
        </div>
      </section>
      <EffectTemplatePickerDialog
        open={picker.open}
        initialKind={picker.kind}
        onOpenChange={(open) => {
          if (!open) closePicker();
        }}
        returnFocus={() => openerRef.current}
        onChoose={() => {
          // On `/effects/new` the chosen creator route replaces this page.
          if (!effectPickerRoute)
            setPicker((current) => ({ ...current, open: false }));
        }}
      />
    </AppShellPage>
  );
}
