# 0005: Client-rendered UI and local native composition

[ADR 0016](0016-common-web-application-and-hosted-artifact.md) extends the UI reuse
decision to the complete browser application and its hosted static artifact.
The local/native supervision and acceptance boundaries below remain applicable.

- Status: accepted
- Recorded: 2026-09-17
- Retrospective: yes
- Original decision dates: 2026-09-08 (shared UI extraction); 2026-09-12 (local serving simplification). Original React/Vite/Electron selection dates and rationale are unknown.
- Decision basis: Recorded composition decisions and current client-rendered UI/native boundaries.

Acceptance records the existing boundary. It does not establish unknown historical
human approval or authorize new implementation, deployment or publication.

## Context

Browser and desktop users share companion/chat behavior, while desktop also
needs service supervision, protected credentials and native windows. Sharing
product behavior must not make reusable features depend on installation
readiness, native APIs or a particular application origin.

## Decision

Keep the React UI client-rendered with Vite and TanStack Router. Reusable product
providers receive owner, transport and capability inputs. Local adapters supply
route navigation, voice/avatar effects, settings and installation readiness.

FastAPI owns production local application serving, APIs and permitted bytes.
Development uses Vite with a closed same-origin proxy. Packaged Electron
supervises local services and exposes narrow native capabilities through its
preload bridge; React continues to own the product UI. The installed application
does not require a Vite server or a second native implementation of chat.

## Reason and consequences

The recorded 2026-09-08 extraction rationale was to let an artifact-only consumer
exercise the same Anima/chat behavior without a second hosted implementation or
a local/hosted mode flag. The 2026-09-12 simplification preserved desktop and
single-owner self-hosting while consolidating local serving in FastAPI.

Current rationale: one UI and explicit adapters reduce duplicated behavior and
keep native privileges outside browser features. This costs adapter contracts
and separate verification of browser, shared-package and native lifecycles.
This is a present architectural assessment, not evidence of why React/Vite or
Electron was originally selected, or of a historical comparison with SSR.

Shared-package tests do not establish audio, installed-app or release acceptance.
Native recovery and service readiness remain separate from React readiness and
the first avatar frame. This record accepts existing responsibility boundaries;
it authorizes no new runtime, platform or publication changes.

## Evidence

Historical decision dates are distinguished from recording today. These local
references explain the current architecture without private planning access:

- [Deployment topology](../architecture/deployment-topology.md) and
  [frontend architecture](../frontend/architecture/overview.md): serving and UI flow.
- [Desktop overview](../frontend/desktop/overview.md): native ownership,
  supervised services, recovery and guarded renderer capabilities.
- [React entrypoint](../../src/frontend/web/src/main.local.tsx) and
  [product runtime provider](../../src/frontend/packages/product-ui/src/runtime/ProductRuntimeProvider.tsx):
  client rendering and injected composition inputs.
- [Mounted package checks](../../src/frontend/packages/product-ui/tests/README.md):
  distribution-level chat lifecycle coverage and its limits.
