"use client";

import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useRef, useState } from "react";

import {
  EFFECT_TEMPLATE_KINDS,
  EFFECT_TEMPLATE_KIND_INFO,
  type EffectTemplateKind,
} from "@/lib/effects/effectTemplates";
import { publicResourceUrl } from "@/lib/resource-urls";
import { cn } from "@/lib/utils";
import { AppShellPage } from "@/ui/app/AppShellPage";
import { RuntimeFeatureGate } from "@/ui/app/RuntimeFeatureGate";
import { Button } from "@/ui/components/button";
import { CREATOR_CARD_CLASS_NAME } from "@/ui/create/CreatorCards";
import { EffectTemplatePickerDialog } from "@/ui/create/EffectTemplatePickerDialog";

/** Illustrated header art for each creator card, served from `public/`. */
type CreatorArt = { src: string; className?: string };

const ANIMA_ART = {
  backdrop: publicResourceUrl("illustrations/create/anima-backdrop.webp"),
  character: publicResourceUrl("illustrations/create/anima-character.webp"),
};

const EFFECT_KIND_ART: Record<EffectTemplateKind, CreatorArt> = {
  particle: { src: publicResourceUrl("illustrations/create/particle-fx.webp") },
  // The face sits high in this frame; keep both gag symbols in view.
  avatar: {
    src: publicResourceUrl("illustrations/create/avatar-fx.webp"),
    className: "object-[center_35%]",
  },
  scene: { src: publicResourceUrl("illustrations/create/scene-fx.webp") },
};

/** Card art is decorative; it dims in the dark theme so text stays primary. */
function CreatorCardArt({
  art,
  className,
}: {
  art: CreatorArt;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn("bg-muted relative overflow-hidden", className)}
    >
      <img
        alt=""
        src={art.src}
        loading="lazy"
        decoding="async"
        draggable={false}
        className={cn(
          "size-full object-cover transition-transform duration-300 select-none group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100 dark:brightness-75",
          art.className,
        )}
      />
    </div>
  );
}

type AvailableCreatorCard = {
  title: string;
  description: string;
  action: string;
  to: "/gestures/new" | "/reactions/new";
  art: CreatorArt;
};

const ACTION_CREATORS: AvailableCreatorCard[] = [
  {
    title: "Gesture",
    description: "Choreograph expressive movement and reusable actions.",
    action: "Create Gesture",
    to: "/gestures/new",
    art: { src: publicResourceUrl("illustrations/create/gesture.webp") },
  },
  {
    title: "Reaction",
    description: "Design emotional responses your Anima can perform.",
    action: "Create Reaction",
    to: "/reactions/new",
    art: { src: publicResourceUrl("illustrations/create/reaction.webp") },
  },
];

function ActionCreatorCard({ card }: { card: AvailableCreatorCard }) {
  return (
    <article
      className={cn(CREATOR_CARD_CLASS_NAME, "overflow-hidden rounded-3xl")}
    >
      <CreatorCardArt art={card.art} className="h-40 md:h-44" />
      <div className="flex flex-1 flex-col gap-4 p-5 md:p-6">
        <div className="space-y-1.5">
          <h3 className="text-xl font-semibold">{card.title}</h3>
          <p className="text-muted-foreground text-sm leading-6">
            {card.description}
          </p>
        </div>
        <Button
          asChild
          variant="outline"
          className="mt-auto w-fit rounded-full"
        >
          <Link to={card.to}>
            {card.action}
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </Button>
      </div>
    </article>
  );
}

const ANIMA_CREATOR_ACTION_CLASS_NAME = "mt-7 rounded-full shadow-lg";

/**
 * The Anima creator card: an illustrated stage with a character who leans out
 * above the card's top edge. When the runtime withholds Anima creation, the
 * familiar card stays with its action disabled and the shared reason below it.
 */
function AnimaCreatorCard({
  unavailableReason,
}: {
  unavailableReason?: string;
}) {
  return (
    <section
      aria-labelledby="anima-creator-title"
      className={cn(
        "relative mt-6 flex min-h-72 flex-col items-start justify-center rounded-3xl p-6 md:mt-8 md:p-9",
        // Only an available card lifts on hover; a disabled one never opens.
        !unavailableReason &&
          "group transition-transform hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0",
      )}
    >
      {/* The backdrop is clipped to the card; the character layer is not. */}
      <div
        aria-hidden="true"
        className="border-border/70 bg-card absolute inset-0 overflow-hidden rounded-3xl border shadow-lg shadow-black/5 transition-shadow group-hover:shadow-xl"
      >
        <img
          alt=""
          src={ANIMA_ART.backdrop}
          decoding="async"
          draggable={false}
          className="size-full object-cover select-none dark:brightness-75"
        />
        <div className="from-card via-card/75 md:via-card/55 absolute inset-0 bg-gradient-to-r to-transparent" />
      </div>
      <img
        alt=""
        aria-hidden="true"
        src={ANIMA_ART.character}
        decoding="async"
        draggable={false}
        className="pointer-events-none absolute right-[6%] bottom-0 hidden h-[calc(100%+3.5rem)] w-auto select-none md:block lg:right-[20%]"
      />
      <div className="relative max-w-md space-y-2 md:w-1/2 lg:w-auto">
        <h2
          id="anima-creator-title"
          className="text-3xl font-semibold tracking-tight md:text-4xl"
        >
          Anima
        </h2>
        <p className="text-muted-foreground text-sm leading-6 md:text-base">
          Create the companion at the heart of every conversation.
        </p>
      </div>
      {unavailableReason ? (
        <>
          <Button
            type="button"
            size="lg"
            disabled
            aria-describedby="anima-creator-unavailable"
            className={cn("relative", ANIMA_CREATOR_ACTION_CLASS_NAME)}
          >
            Create Anima <ArrowRight className="size-4" />
          </Button>
          <p
            id="anima-creator-unavailable"
            className="text-muted-foreground relative mt-3 max-w-md text-sm"
          >
            {unavailableReason}
          </p>
        </>
      ) : (
        <Button
          asChild
          size="lg"
          className={cn("relative", ANIMA_CREATOR_ACTION_CLASS_NAME)}
        >
          <Link to="/animas/new">
            Create Anima <ArrowRight className="size-4" />
          </Link>
        </Button>
      )}
    </section>
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
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      className={cn(
        CREATOR_CARD_CLASS_NAME,
        "overflow-hidden rounded-3xl text-left",
      )}
      onClick={(event) => onOpen(kind, event.currentTarget)}
    >
      <CreatorCardArt art={EFFECT_KIND_ART[kind]} className="h-32 w-full" />
      <div className="flex flex-1 flex-col p-5">
        <h3 className="text-lg font-semibold">{info.label}</h3>
        <p className="text-muted-foreground mt-1.5 flex-1 text-sm leading-6">
          {info.description}
        </p>
        <span className="border-input bg-background text-foreground group-hover:bg-accent group-hover:text-accent-foreground mt-5 inline-flex w-fit items-center gap-1 rounded-full border px-3 py-1.5 text-sm font-medium shadow-xs transition-colors">
          {`Create ${info.label}`}
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
        </span>
      </div>
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
          Bring your Animas to life with movement, emotion and effects.
        </p>
      </header>

      <RuntimeFeatureGate
        capability="anima_creation"
        unavailable={(reason) => (
          <AnimaCreatorCard unavailableReason={reason} />
        )}
      >
        <AnimaCreatorCard />
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
