# Single-image deploy: build the React SPA, then serve it + the FastAPI API from
# one Python process. Targets Google Cloud Run (listens on $PORT, default 8080).
#
# Build context = repo root (the vendored submodule must be checked out first:
#   git submodule update --init).
# Build:  docker build -t hammock-webapp .
# Run:    docker run -p 8080:8080 hammock-webapp

# ---- Stage 1: build the frontend -------------------------------------------
FROM node:22-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build          # -> /app/frontend/dist

# ---- Stage 2: python runtime (serves SPA + API) ----------------------------
FROM python:3.13-slim AS runtime

ENV MPLBACKEND=Agg \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    FRONTEND_DIST=/app/frontend/dist \
    # Snapshot of the vendored hammock_plot pin: the container has no git, so
    # version.py reads this for GET /api/health. Keep in sync with the submodule
    # pin (ROADMAP M0 / `git submodule status`).
    HAMMOCK_PIN=deae4c2b5845ddeb3b9778f8873ecd4639ed8a66

WORKDIR /app

# Install deps first (cached unless requirements or the vendored lib change).
# requirements.txt has `-e ./vendor/hammock_plot`, resolved relative to CWD=/app.
COPY backend/requirements.txt backend/requirements.txt
COPY vendor/ vendor/
RUN pip install -r backend/requirements.txt

# App code + built SPA.
COPY backend/ backend/
COPY --from=frontend-build /app/frontend/dist /app/frontend/dist

WORKDIR /app/backend
EXPOSE 8080
# Shell form so ${PORT} (set by Cloud Run) expands; default 8080 for local runs.
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}
