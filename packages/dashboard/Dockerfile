# Build stage: vite build the SPA
FROM node:22-bookworm-slim AS build
WORKDIR /build
COPY package.json package-lock.json* ./
COPY packages/dashboard/package.json ./packages/dashboard/
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY packages/dashboard ./packages/dashboard
WORKDIR /build/packages/dashboard
RUN npm run build

# Runtime stage: nginx serves the static dist/
FROM nginx:1.27-alpine
RUN rm -rf /usr/share/nginx/html/* /etc/nginx/conf.d/*
COPY --from=build /build/packages/dashboard/dist /usr/share/nginx/html
COPY <<'EOF' /etc/nginx/conf.d/default.conf
server {
  listen 8080;
  server_name _;
  root /usr/share/nginx/html;
  index index.html;

  add_header X-Frame-Options "SAMEORIGIN" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;

  location = /healthz {
    add_header Content-Type text/plain;
    return 200 "ok\n";
  }

  # SPA fallback — every unmatched path serves index.html so client-side router works
  location / {
    try_files $uri $uri/ /index.html;
  }

  # Long-cache for hashed asset bundles
  location /assets/ {
    expires 1y;
    add_header Cache-Control "public, immutable";
  }
}
EOF
EXPOSE 8080
