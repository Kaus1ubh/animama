# Shared language

This glossary establishes common meanings between Raymond and AI agents in
conversation, specifications, implementation and reviews. These are Animama's
domain meanings, not universal definitions. Surface conflicting usage rather than
silently choosing another meaning; propose a clarification when a distinction is
missing. Definitions describe the current local product, not promised features.

## Anima

The owned, live companion: its name, private identity, chat state and selected
content. An Anima is not just its Avatar; changing visual content does not replace
the companion's identity or conversations.

## Avatar

The typed content that supplies a companion's visual representation and related
content defaults. Use **Anima** for the live companion and **Avatar** for this
selected content, rather than treating the words as interchangeable.

## Installation owner / installation principal

The single durable owner generated for a local installation; **principal** is its
authorization representation. This is not a login account, a central Cloud account
or the temporary credential used to admit a desktop renderer.

## Chat

A persisted conversation associated with one Anima and its owner, containing
ordered messages. A chat can span many requests; it is not an SSE connection or
one model invocation.

## Turn

One request-local interaction with a companion, potentially involving several
model/tool rounds and stored messages. The existing `ChatMessage.turn` field orders
individual messages; it is not a shared number for all messages in one conversational
turn. A `run_id` identifies the streamed interaction, not the saved chat.

## Included content

Content supplied through read-only library sources, including shipped content and
installed Included-content packs. **Included** describes its source and editability,
not its creator, licensing rights or a hosted deployment mode.

## Local content

Content in the writable local library, including created, imported or manually
added items. **Local** distinguishes this content from Included content; both are
used by the local application and access is governed separately by the catalog.

## Pose

A static set of humanoid bone transforms and expression weights. A saved Pose is
self-contained Included or Local content. Inserting it into a Gesture copies its
effective values; later source edits or deletion do not change that Gesture.

## Pose Clip

A timed animation sequence of poses and optional effects or sounds. A Gesture can
own its clip as an internal file; an independently reusable Pose Clip has its own
catalog item. A standalone Pose has no timeline and is not Anima equipment.

## Loadout

An Anima's persisted, revisioned selection of content and bindings. It describes
what is equipped, not copied content bytes or an already mounted runtime snapshot.

## Runtime snapshot

An owner-scoped, leased resolution of selected content and its dependencies into
an exact runtime revision and catalog. It pins what a runtime can use; it is not
the editable loadout, a live view of changing files or a database backup.

## Feature pack

A verified optional desktop distribution component that adds capability or assets,
such as speech recognition, expanded Included content or document processing.
It is distinct from a portable content import/export package and a wheel/npm
software package set; installation alone does not equip an Anima.

## App settings

Installation-wide preferences chosen in App Settings, stored in
`user_settings` for the installation owner. For memory and emotion behaviour
they are defaults that every Anima follows unless it sets its own value.
Per-machine choices such as the microphone device are local to that machine,
not App settings.

## Anima settings

Per-Anima preferences stored in `anima_settings`. A memory or emotion value
here overrides the App settings default for that Anima only; choosing
"App default" removes the override. Distinct from the **Loadout**, which selects content.

## Companion guardrail

The fixed, server-owned **Companion Guardrails** instruction section that ends
every chat turn's provider instructions: honesty about being an AI, no
therapist claims, no manipulative retention and a caring crisis response. No
identity, memory, setting or safety switch removes it; see
[ADR 0008](docs/adr/0008-non-overridable-companion-guardrail.md).

## AI notice

The app-rendered line reminding the user that an Anima is an AI, not a person.
The backend decides when it is due (a start notice on the first turn of each
local day, and a reminder during a long continuing interaction); it is not
assistant text and is never spoken or saved in the chat.

## Continuing interaction

A run of turns with the same installation owner, across Animas, where each turn
starts less than 30 minutes after the previous one. AI-notice reminders are
measured from its start or the last notice, whichever is later.

## Using these terms

For implemented behavior, consult the [backend](docs/backend/README.md) and
[frontend](docs/frontend/README.md) documentation. Architectural reasons and
decision history belong in the [ADR index](docs/adr/README.md); the
[domain documentation guide](docs/agents/domain.md) explains how to maintain them.
