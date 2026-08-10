# apps/api Dockerfile — multi-stage, two runtime targets: `server` and `worker`.
#
# Build from the MONOREPO ROOT, not this directory, since apps/api depends on
# the workspace package @ilovemusic/engine and npm workspaces need the root
# package.json/lockfile to resolve it correctly:
#
#   docker build -f apps/api/Dockerfile --target server -t ilovemusic-api-server .
#   docker build -f apps/api/Dockerfile --target worker -t ilovemusic-api-worker .
#
# `server` is deliberately minimal — it never shells out to spotdl/yt-dlp/
# ffmpeg/aubio/python3, so none of that is installed in it. `worker` is the
# only target that needs the heavy CLI/Python toolchain, since it's the only
# process that actually runs packages/engine's download pipeline.

# ---- deps: install once, shared by both targets ----
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/package.json
COPY apps/api/package.json apps/api/package.json
RUN npm ci

# ---- build: compile packages/engine and apps/api TypeScript ----
FROM deps AS build
COPY packages/engine packages/engine
COPY apps/api apps/api
RUN npm run build --workspace @ilovemusic/engine \
 && npm run build --workspace @ilovemusic/api \
 && npm prune --omit=dev

# ---- runtime-base: the Node.js layer shared by server and worker ----
# Not used directly as a build target — `docker build --target runtime-base`
# would work but isn't meaningful on its own (no entrypoint set).
FROM node:22-bookworm-slim AS runtime-base
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
# packages/engine/scripts (detect_key.py, requirements.txt) is NOT optional
# here — processing/key.ts resolves its path relative to __dirname two
# levels up from dist/processing/key.js, so it must ship alongside dist/,
# not just dist/ on its own, or key detection silently fails at runtime.
COPY --from=build /app/packages/engine/dist ./packages/engine/dist
COPY --from=build /app/packages/engine/scripts ./packages/engine/scripts
COPY --from=build /app/packages/engine/package.json ./packages/engine/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json

# ---- server: HTTP layer only ----
FROM runtime-base AS server
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/server.js"]

# ---- worker: HTTP-less job processor, needs the full download toolchain ----
FROM runtime-base AS worker

# ffmpeg (audio conversion/tagging) + aubio-tools (BPM CLI) from apt;
# python3 + venv for spotdl/yt-dlp/librosa (all installed into an isolated
# venv, not system python, to avoid apt/pip conflicts on Debian).
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      aubio-tools \
      python3 \
      python3-venv \
      python3-pip \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/venv

# venv bin dir first on PATH so bare `python3`/`spotdl`/`yt-dlp` all resolve
# to it — matches how packages/engine/src/binaries.ts falls back to a bare
# command name via PATH when no explicit *_PATH env var is set. No
# SPOTDL_PATH/PYTHON_PATH overrides needed as a result.
ENV PATH="/opt/venv/bin:$PATH"

RUN pip install --no-cache-dir spotdl yt-dlp \
 && pip install --no-cache-dir -r /app/packages/engine/scripts/requirements.txt

CMD ["node", "apps/api/dist/worker.js"]
