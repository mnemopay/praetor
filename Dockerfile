# Praetor — multi-stage Docker build.
#
#   docker build -t praetor:latest .
#   docker run -p 8788:8788 \
#     -e SUPABASE_URL=… \
#     -e SUPABASE_SERVICE_ROLE_KEY=… \
#     -e ANTHROPIC_API_KEY=… \
#     praetor:latest
#
# The image runs the @praetor/api server on port 8788 and serves the
# dashboard from there. The api spawns the @praetor/cli process per
# mission (charter run), so /usr/local/bin/node + the workspace dist/
# are the only runtime deps.

# ─── Stage 1: build everything ──────────────────────────────────────────
FROM node:22-bookworm-slim AS build

WORKDIR /app

# Cache deps separately from source for faster rebuilds.
COPY package.json package-lock.json tsconfig.json ./
COPY packages/ packages/
RUN npm ci --no-audit --no-fund --ignore-scripts

# Compile every workspace via the project-references config.
RUN npx tsc -b

# Drop devDependencies after build to shrink the image we copy from.
RUN npm prune --omit=dev

# ─── Stage 2: slim runtime ──────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8788
ENV HOST=0.0.0.0

# Praetor runs charters that may shell out to git / mkdir / node / python.
# Install the minimal toolchain — the coding-agent allowlist will gate
# what charters can actually invoke.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Copy the built workspace + production node_modules.
COPY --from=build /app/package.json /app/package.json
COPY --from=build /app/package-lock.json /app/package-lock.json
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/packages /app/packages

# Drop into a non-root user. The api itself doesn't need root, and
# charters that need elevated access should declare a Docker sandbox
# (which spins up its own privileged-or-not container per the security
# doctrine).
RUN useradd --uid 10001 --create-home --shell /bin/sh praetor \
 && mkdir -p /app/praetor-out /app/.praetor \
 && chown -R praetor:praetor /app
USER praetor

EXPOSE 8788

# Health check — the api ships /health out of the box.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch(\`http://127.0.0.1:${PORT}/health\`).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Default: run the api server. Override CMD to run the cli or a charter.
CMD ["node", "packages/api/dist/index.js"]
