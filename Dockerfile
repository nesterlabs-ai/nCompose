# ── Build stage ──
FROM node:22-alpine AS builder

WORKDIR /app

# Install deps first (layer cache)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build
COPY tsconfig.json ./
COPY src/ src/
COPY prompts/ prompts/
RUN npm run build

# ── Production stage ──
FROM node:22-alpine

WORKDIR /app

# Install production deps only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy built output + runtime files
COPY --from=builder /app/dist/ dist/
COPY prompts/ prompts/

# Static files: server.js resolves join(__dirname, 'public') → dist/web/public/
COPY src/web/public/ dist/web/public/

# Starter template: server.js resolves join(__dirname, '..', 'figma-to-code-starter-main')
COPY src/figma-to-code-starter-main/ dist/figma-to-code-starter-main/

# Output directory (persistent via docker volume)
RUN mkdir -p /app/web_output

ENV NODE_ENV=production
ENV PORT=3000
ENV SERVER_OUTPUT_DIR=/app/web_output

EXPOSE 3000

CMD ["node", "dist/web/server.js"]
