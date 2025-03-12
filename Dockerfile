# Backend build stage
FROM python:3.12-slim-bookworm AS backend-builder

# Set environment variables
ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    POETRY_VERSION=1.7.1 \
    POETRY_HOME="/opt/poetry" \
    POETRY_VIRTUALENVS_IN_PROJECT=false \
    POETRY_NO_INTERACTION=1 \
    PIP_NO_CACHE_DIR=1

# Set reliable shell execution environment
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Set working directory
WORKDIR /app

# Install build dependencies (merge RUN commands to reduce layers)
RUN set -ex \
    && apt-get update -o Acquire::http::No-Cache=True -o Acquire::Check-Valid-Until=false \
    && apt-get install -y --no-install-recommends \
        build-essential=12.9 \
        curl=7.88.1-10+deb12u8 \
        ca-certificates=20230311 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install Poetry
RUN curl -sSLf https://install.python-poetry.org | python3 - \
    && ln -s /opt/poetry/bin/poetry /usr/local/bin/poetry

# Create backend directory
RUN mkdir -p /app/backend

# Copy backend project dependency files to backend directory
COPY apps/backend/pyproject.toml /app/backend/
# Create an empty poetry.lock file, which will be overwritten if the source file exists
RUN touch /app/backend/poetry.lock
# Try to copy poetry.lock file (if it exists)
COPY apps/backend/poetry.lock /app/backend/

# Switch to backend directory
WORKDIR /app/backend

# Install dependencies using Poetry and create wheels
RUN poetry config "virtualenvs.create" "false" \
    && poetry install --no-interaction --no-ansi --no-root \
    && pip install --no-cache-dir pip==25.0.1 \
    && poetry export -f requirements.txt --without-hashes > /app/requirements.txt \
    && pip wheel --no-cache-dir --wheel-dir /app/wheels -r /app/requirements.txt

# Frontend build stage
FROM node:20-slim AS frontend-builder

# Set environment variables to disable cache
ENV NODE_ENV=production \
    NPM_CONFIG_CACHE=/tmp/npm-cache \
    PNPM_HOME=/tmp/pnpm-store \
    HUSKY=0

# Set working directory
WORKDIR /app

# Install pnpm with no cache
RUN npm install -g pnpm@10.6.2 --no-cache

# Copy package.json and pnpm related files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml nx.json .npmrc ./
COPY apps/frontend ./apps/frontend

# Install dependencies and build frontend with no cache
RUN pnpm install --frozen-lockfile --no-cache --ignore-scripts && \
    NODE_OPTIONS="--max-old-space-size=4096" NX_DAEMON=false pnpm build

# Final stage
FROM python:3.12-slim-bookworm

# Set environment variables
ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONPATH=/app \
    PYTHONUNBUFFERED=1 \
    POETRY_VERSION=1.7.1 \
    POETRY_HOME="/opt/poetry" \
    POETRY_VIRTUALENVS_IN_PROJECT=false \
    POETRY_NO_INTERACTION=1 \
    PIP_NO_CACHE_DIR=1

# Set reliable shell execution environment
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Set working directory
WORKDIR /app

# Install runtime dependencies (merge RUN commands to reduce layers)
RUN set -ex \
    && apt-get update -o Acquire::http::No-Cache=True -o Acquire::Check-Valid-Until=false \
    && apt-get install -y --no-install-recommends \
        libopencv-dev=4.6.0+dfsg-12 \
        ffmpeg=7:5.1.6-0+deb12u1 \
        libsm6=2:1.2.3-1 \
        libxext6=2:1.3.4-1+b1 \
        libgl1=1.6.0-1 \
        libcurl4=7.88.1-10+deb12u8 \
        curl=7.88.1-10+deb12u8 \
        ca-certificates=20230311 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install Poetry
RUN curl -sSLf https://install.python-poetry.org | python3 - \
    && ln -s /opt/poetry/bin/poetry /usr/local/bin/poetry

# Create backend directory
RUN mkdir -p /app/backend

# Copy wheels and project files from build stage
COPY --from=backend-builder /app/wheels /wheels
COPY --from=backend-builder /app/backend/pyproject.toml /app/backend/
# Create an empty poetry.lock file, which will be overwritten if the source file exists
RUN touch /app/backend/poetry.lock
COPY --from=backend-builder /app/backend/poetry.lock /app/backend/

# Install dependencies
RUN pip install --no-cache-dir --no-index --find-links=/wheels/ /wheels/*.whl \
    && rm -rf /wheels

# Copy backend application code
COPY apps/backend /app/backend/

# Copy frontend build files - ensure we copy from the correct path (dist/apps/frontend)
COPY --from=frontend-builder /app/dist/apps/frontend /app/frontend/dist

# Set up user
RUN useradd -m appuser && \
    chown -R appuser:appuser /app

# Install and configure Caddy as a lightweight web server (replaces Nginx, can run as non-root user)
RUN apt-get update -o Acquire::http::No-Cache=True -o Acquire::Check-Valid-Until=false && \
    apt-get install -y --no-install-recommends \
    debian-archive-keyring=2023.3+deb12u1 \
    apt-transport-https=2.6.1 \
    curl=7.88.1-10+deb12u8 \
    ca-certificates=20230311 \
    gnupg=2.2.40-1.1 \
    && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg \
    && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list \
    && apt-get update -o Acquire::http::No-Cache=True -o Acquire::Check-Valid-Until=false \
    && apt-get install -y --no-install-recommends caddy=2.6.2-5 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Create Caddy configuration file
RUN mkdir -p /app/caddy
COPY <<EOF /app/caddy/Caddyfile
:80 {
    # Frontend static files
    root * /app/frontend/dist
    try_files {path} /index.html
    file_server

    # Backend API proxy
    handle /api/* {
        reverse_proxy localhost:8000
    }
}
EOF

# Create startup script
RUN mkdir -p /app/scripts
COPY <<EOF /app/scripts/start.sh
#!/bin/bash
# Start backend API service
cd /app/backend && poetry run uvicorn main:app --host 0.0.0.0 --port 8000 &
# Start Caddy
caddy run --config /app/caddy/Caddyfile
EOF

# Set execute permission for the startup script and ensure appuser can access all necessary files
RUN chmod +x /app/scripts/start.sh && \
    chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Expose ports
EXPOSE 80 8000

# Startup command
CMD ["/app/scripts/start.sh"]
