FROM python:3.12-slim AS base

WORKDIR /app

ENV UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:/root/.local/bin:$PATH" \
    PYTHONPATH=/app/src:/app/src/agents/src \
    WATCHFILES_FORCE_POLLING=true

RUN apt-get update -y \
    && apt-get install -y --no-install-recommends curl build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN curl -LsSf https://astral.sh/uv/install.sh | sh
# Only copy needed files into our backend base image
COPY pyproject.toml uv.lock alembic.ini LICENSE ./
RUN touch README.md
COPY alembic ./alembic
COPY content/included ./content/included
COPY src/backend/animama ./src/backend/animama
COPY src/backend/packaging/hatch_build.py src/backend/packaging/shared_catalogs.py ./src/backend/packaging/
COPY src/frontend/web/src/assets/vrm/animations/manifest.json \
    ./src/frontend/web/src/assets/vrm/animations/manifest.json
COPY src/frontend/web/src/assets/effects/vfx/catalog.json \
    ./src/frontend/web/src/assets/effects/vfx/catalog.json

EXPOSE 8000

FROM base AS animama-server

RUN uv sync --frozen --no-dev --extra server

# Container-network-only entrypoint. docker-compose.yml never publishes this
# listener; browser traffic enters through the Hono gateway.
CMD ["uvicorn", "animama.server.app:app", "--host", "0.0.0.0", "--port", "8000", "--reload", "--log-level", "info"]
# CMD ["fastapi", "run", "src/backend/animama/server/app.py"]

FROM base AS animama-file-worker

RUN apt-get update -y \
    && apt-get install -y --no-install-recommends libglib2.0-0 libgl1 libgomp1 libxcb1 \
    && rm -rf /var/lib/apt/lists/*

RUN uv sync --frozen --no-dev --extra file-worker

CMD ["python", "-m", "animama.workers.user_file_processing"]
