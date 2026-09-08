SHELL := /bin/bash

.PHONY: sync test test-q test-v test-cov coverage lint mypy check format format-check test-live test-full audit-typed-content

sync:
	uv sync --extra server --extra voice --extra viz --extra realtime --extra encrypt --all-packages --group dev

test: 
	uv run pytest 

test-v:
	uv run pytest -vv

test-q:
	uv run pytest -q

test-live:
	@if [ -f .env ]; then set -a; . ./.env; set +a; fi; \
	ANIMAMA_RUN_LIVE_TESTS=1 uv run pytest tests/live

test-live-v:
	@if [ -f .env ]; then set -a; . ./.env; set +a; fi; \
	ANIMAMA_RUN_LIVE_TESTS=1 uv run pytest tests/live -vv

test-full:
	uv run pytest
	@if [ -f .env ]; then set -a; . ./.env; set +a; fi; \
	ANIMAMA_RUN_LIVE_TESTS=1 uv run pytest tests/live

test-cov:
	uv run pytest --cov=src/backend/animama --cov-report=term-missing --cov-report=xml --cov-report=html

coverage:
	uv run coverage run -m pytest
	uv run coverage xml -o coverage.xml
	uv run coverage report -m --fail-under=95

lint: 
	uv run ruff check

mypy: 
	uv run mypy src/backend/animama tests --exclude web-ui --exclude deprecated --exclude templates

format: 
	uv run ruff format src/backend/animama tests
	uv run ruff check --fix src/backend/animama tests

format-check:
	uv run ruff format --check src/backend/animama tests


check: format-check lint mypy

audit-typed-content:
	bash scripts/audit-typed-content.sh

check-test: audit-typed-content format-check lint mypy test
