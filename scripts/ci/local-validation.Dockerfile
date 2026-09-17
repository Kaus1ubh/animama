# Local Linux verification only; this image is never published or shipped.
FROM node:24.15.0-bookworm AS node
FROM ghcr.io/astral-sh/uv:0.11.28 AS uv
FROM docker:28-cli AS docker
FROM pgvector/pgvector:pg16-bookworm

COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
COPY --from=uv /uv /uvx /usr/local/bin/
COPY --from=docker /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker /usr/local/libexec/docker/cli-plugins /usr/local/libexec/docker/cli-plugins
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && apt-get update \
    && apt-get install --yes --no-install-recommends \
       ca-certificates git git-lfs ripgrep make build-essential \
       libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
       libdbus-1-3 libxcb1 libxkbcommon0 libx11-6 libxcomposite1 libxdamage1 \
       libxext6 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 \
       libasound2 fonts-liberation \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@10.33.0 \
    && git lfs install --system

ENV UV_PYTHON_INSTALL_DIR=/opt/uv-python
RUN uv python install 3.12.13 \
    && ln -s "$(uv python find 3.12.13)" /usr/local/bin/python \
    && ln -s "$(uv python find 3.12.13)" /usr/local/bin/python3
# initdb rejects root. Match the output directory owner without mounting their HOME.
ARG LOCAL_UID=1000
RUN useradd --non-unique --uid "$LOCAL_UID" --gid 0 --no-create-home validator
USER validator
ENTRYPOINT []
