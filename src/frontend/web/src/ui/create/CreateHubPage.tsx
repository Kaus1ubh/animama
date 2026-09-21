"use client";

import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Hand,
  HeartPulse,
  ImagePlay,
  Sparkles,
  UsersRound,
  Volume2,
  WandSparkles,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";

import { cn } from "@/lib/utils";
import { AppShellPage } from "@/ui/app/AppShellPage";
import { Button } from "@/ui/components/button";

type CreatorIcon = ComponentType<SVGProps<SVGSVGElement>>;

type AvailableCreatorCard = {
  title: string;
  description: string;
  action: string;
  to:
    | "/a/gestures/new"
    | "/a/reactions/new"
    | "/a/particle-effects/new"
    | "/a/avatar-effects/new"
    | "/a/scene-effects/new"
    | "/a/sound-effects/new";
  icon: CreatorIcon;
  iconClassName: string;
};

type PlannedCreatorCard = {
  title: string;
  description: string;
  icon: CreatorIcon;
  iconClassName: string;
};

type EffectCreatorCard =
  | (AvailableCreatorCard & { status: "available" })
  | (PlannedCreatorCard & { status: "planned" });

const ACTION_CREATORS: AvailableCreatorCard[] = [
  {
    title: "Gesture",
    description: "Choreograph expressive movement and reusable actions.",
    action: "Create Gesture",
    to: "/a/gestures/new",
    icon: Hand,
    iconClassName: "bg-secondary text-secondary-foreground",
  },
  {
    title: "Reaction",
    description: "Design emotional responses your Anima can perform.",
    action: "Create Reaction",
    to: "/a/reactions/new",
    icon: HeartPulse,
    iconClassName: "bg-secondary text-secondary-foreground",
  },
];

const EFFECT_CREATORS: EffectCreatorCard[] = [
  {
    status: "available",
    title: "Particle VFX",
    description: "Add bursts, trails, and atmospheric particles.",
    action: "Create VFX",
    to: "/a/particle-effects/new",
    icon: WandSparkles,
    iconClassName: "bg-accent text-accent-foreground",
  },
  {
    status: "available",
    title: "Avatar VFX",
    description: "Add face decals, hover art, and Avatar textures.",
    action: "Create Avatar VFX",
    to: "/a/avatar-effects/new",
    icon: Sparkles,
    iconClassName: "bg-primary text-primary-foreground",
  },
  {
    status: "available",
    title: "Scene VFX",
    description: "Compose backgrounds and focus lines around your Anima.",
    action: "Create Scene VFX",
    to: "/a/scene-effects/new",
    icon: ImagePlay,
    iconClassName:
      "bg-violet-200 text-violet-950 dark:bg-violet-900 dark:text-violet-100",
  },
  {
    status: "available",
    title: "Sounds",
    description: "Add audio cues and expressive accents.",
    action: "Create sound",
    to: "/a/sound-effects/new",
    icon: Volume2,
    iconClassName: "bg-muted text-muted-foreground",
  },
];

function CreatorIconTile({
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

function AvailableEffectCard({ card }: { card: AvailableCreatorCard }) {
  return (
    <Link
      to={card.to}
      className="border-border/70 bg-card/92 hover:border-primary/45 focus-visible:ring-ring group flex min-h-48 flex-col rounded-2xl border p-5 shadow-lg shadow-black/5 transition-[border-color,box-shadow,transform] outline-none hover:-translate-y-0.5 hover:shadow-xl focus-visible:ring-2"
    >
      <CreatorIconTile icon={card.icon} className={card.iconClassName} />
      <h3 className="mt-5 text-lg font-semibold">{card.title}</h3>
      <p className="text-muted-foreground mt-1.5 flex-1 text-sm leading-6">
        {card.description}
      </p>
      <span className="text-foreground mt-5 flex items-center gap-1 text-sm font-semibold">
        {card.action}
        <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
      </span>
    </Link>
  );
}

function PlannedEffectCard({ card }: { card: PlannedCreatorCard }) {
  return (
    <article className="border-border/60 bg-card/55 text-foreground/80 flex min-h-48 flex-col rounded-2xl border border-dashed p-5 shadow-sm">
      <CreatorIconTile icon={card.icon} className={card.iconClassName} />
      <h3 className="mt-5 text-lg font-semibold">{card.title}</h3>
      <p className="text-muted-foreground mt-1.5 flex-1 text-sm leading-6">
        {card.description}
      </p>
      <span className="bg-muted text-muted-foreground mt-5 w-fit rounded-full px-2.5 py-1 text-xs font-medium">
        In progress
      </span>
    </article>
  );
}

/** Showcase every supported creator while preserving the product hierarchy. */
export function CreateHubPage() {
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
          <Link to="/a/animas/new">
            Create Anima <ArrowRight className="size-4" />
          </Link>
        </Button>
      </section>

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
            Layer reusable effects into Gestures and Reactions.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {EFFECT_CREATORS.map((card) =>
            card.status === "available" ? (
              <AvailableEffectCard key={card.to} card={card} />
            ) : (
              <PlannedEffectCard key={card.title} card={card} />
            ),
          )}
        </div>
      </section>
    </AppShellPage>
  );
}
