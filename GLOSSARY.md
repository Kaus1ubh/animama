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

## Using these terms

For implemented behavior, consult the [backend](docs/backend/README.md) and
[frontend](docs/frontend/README.md) documentation. Architectural reasons and
decision history belong in the [ADR index](docs/adr/README.md); the
[domain documentation guide](docs/agents/domain.md) explains how to maintain them.
