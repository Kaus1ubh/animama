# 0002: Accountless installation and local HTTP admission

- Status: accepted
- Recorded: 2026-09-17
- Retrospective: yes
- Original decision dates: 2026-08-30 (installation ownership); 2026-09-12 (FastAPI serving and admission).
- Decision basis: Recorded decisions, current HTTP contracts and inspected implementation.

Acceptance records the existing boundary. It does not establish unknown historical
human approval or authorize new implementation, deployment or publication.

## Context and decision

A local installation needs durable ownership without requiring its operator to
create credentials for software and data on their own machine. Generate one
installation principal during schema creation and retain existing owner filters.
The principal is an ownership key, not a secret, login or hosted account.

FastAPI owns product admission and built application delivery. Validate authority,
Origin, browser metadata and mutation CSRF markers before resolving the
bootstrap-established owner from server-owned state. Desktop additionally uses a
per-launch renderer capability; private controls require a separate credential.
Development Vite proxies the permitted application routes without asserting an
identity. Ordinary local application publication remains loopback-only.

## Reason and consequences

Current rationale: separating ownership from credentials preserves authorization
checks while removing local signup and account lifecycle work. Keeping admission
beside API and byte delivery gives one application boundary responsibility for
these checks. Accountless does not mean requests can select an owner or bypass
admission. Remote self-host access still needs an operator-owned TLS and
authentication boundary; admitted callers share the installation owner.

Retaining an invisible local account would preserve account-management complexity.
A separate application gateway is another possible boundary, but the selected
composition places that responsibility in FastAPI. This requires preserving the
transport, static-serving and desktop-control protections there. Consolidation
alone is not evidence of a startup-performance improvement.

## Evidence and historical limits

Observed implementation: [installation principal validation](../../src/backend/animama/local/installation_principal.py),
[HTTP admission](../../src/backend/animama/local/http/admission.py), and
[local composition](../../src/backend/animama/server/app.py).
The [local HTTP contract](../frontend/architecture/auth-server.md) and
[desktop operations](../backend/operations/desktop-runtime.md) describe current
behavior independently of historical planning records.

Recorded historical rationale distinguishes two choices: the 2026-08-30 decision
removed local credentials while retaining ownership; the 2026-09-12 serving
decision retained that owner contract while consolidating the application
boundary. These dates identify recorded choices, not release dates. Earlier
gateway details are not the current contract. This acceptance does not imply a
new human approval of every implementation detail.
