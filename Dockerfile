# Dockerfile for contextforge-mcp
#
# Build:  docker build -t contextforge-mcp .
# Run:    docker run -i \
#           -e CONTEXTFORGE_API_KEY=your-api-key \
#           -e CONTEXTFORGE_API_URL=https://your-project.supabase.co \
#           contextforge-mcp
#
# Note: this image is primarily used by Glama (glama.ai/mcp/servers) for
# introspection checks. Real users typically run the server via `npx
# contextforge-mcp` and supply their own API key from contextforge.dev.

# ---- Build stage ----
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

COPY src ./src
RUN npm run build

# ---- Runtime stage ----
FROM node:20-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

# Placeholder credentials so the server passes Glama's startup check
# (zod validates non-empty strings; backend rejects the dummy key at query
# time, but introspection — tools/list, resources/list — is purely static).
# Real users MUST override these via -e CONTEXTFORGE_API_KEY=... at runtime.
ENV CONTEXTFORGE_API_KEY=glama-introspection-placeholder
ENV CONTEXTFORGE_API_URL=https://byzngcpqiqmqpxpmnhmo.supabase.co

CMD ["node", "dist/index.js"]
