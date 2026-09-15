# Animama backend and integration tests

The suite uses pytest and pytest-asyncio to exercise direct chat/SSE, persistence,
memory, typed content, installation ownership, and supporting tooling. Database
fixtures create disposable pgvector-enabled PostgreSQL containers through
Testcontainers; Docker must be available, but the tests do not need the running
application's database.

Run from the repository root:

```bash
uv run pytest -q
make check-test
```

The Make target also runs the typed-content audit, lint, formatting and type
checks. For a focused chat change:

```bash
uv run pytest -q tests/test_direct_chat_turn_executor.py tests/test_anima_chat_sse.py
```

Ordinary tests use controlled provider/embedding fixtures. Provider-backed tests
are opt-in; see [Live integration helpers](live/README.md) for their environment
requirements and isolation. Frontend and desktop tests run from `src/frontend`
using the commands in the [frontend guide](../src/frontend/AGENTS.md).

See [backend development](../docs/backend/operations/development.md) for
test configuration and current local-stack conventions. Report unavailable
Docker fixtures and inherited failures explicitly rather than treating skipped
or blocked checks as passes.
