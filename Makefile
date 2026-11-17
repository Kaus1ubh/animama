SHELL := /bin/bash
.DEFAULT_GOAL := help

.PHONY: help sync test test-q test-v test-cov test-live test-live-v test-full lint mypy format format-check check audit-typed-content check-test check-ci

# pytest-xdist workers for test, test-q and check-test; 0 runs in-process.
# Workers share one PostgreSQL container, each with its own database.
PYTEST_WORKERS ?= 2

help: ## Show backend tasks (frontend tasks use pnpm in src/frontend).
	@awk 'BEGIN {FS = ":.*## "} /^[a-z-]+:.*## / {printf "  %-20s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

sync: ## Install backend development dependencies and supported local extras.
	uv sync --extra voice --extra viz --extra realtime --extra encrypt --extra documents --all-packages --group dev

test: ## Run offline backend tests in PYTEST_WORKERS xdist workers (default 2).
	uv run pytest -n $(PYTEST_WORKERS)

test-q: ## Run offline backend tests with concise output.
	uv run pytest -q -n $(PYTEST_WORKERS)

test-v: ## Run offline backend tests with verbose output.
	uv run pytest -vv

test-cov: ## Run offline tests with terminal, XML and HTML coverage reports.
	uv run pytest --cov=src/backend/animama --cov-report=term-missing --cov-report=xml --cov-report=html

test-live: ## Explicitly run live provider tests using credentials from .env.
	@if [ -f .env ]; then set -a; . ./.env; set +a; fi; \
	ANIMAMA_RUN_LIVE_TESTS=1 uv run pytest tests/live

test-live-v: ## Run live provider tests with verbose output.
	@if [ -f .env ]; then set -a; . ./.env; set +a; fi; \
	ANIMAMA_RUN_LIVE_TESTS=1 uv run pytest tests/live -vv

test-full: test ## Run offline tests followed by explicit live provider tests.
	$(MAKE) test-live

lint: ## Check Python lint rules.
	uv run ruff check

mypy: ## Check backend and test types.
	uv run mypy src/backend/animama tests

format: ## Format backend/tests and apply safe lint fixes.
	uv run ruff format src/backend/animama tests
	uv run ruff check --fix src/backend/animama tests

format-check: ## Check backend and test formatting without editing.
	uv run ruff format --check src/backend/animama tests

check: format-check lint mypy ## Run formatting, lint and typing checks.

audit-typed-content: ## Check typed-content ownership and API invariants.
	bash scripts/audit-typed-content.sh

check-test: audit-typed-content format-check lint mypy test ## Run the full offline backend verification chain.

check-ci: ## Test conservative CI selection, Git discovery and failure aggregation.
	uv run --no-sync python -m unittest discover -s scripts/ci -p 'test_*.py' -v
