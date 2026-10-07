# ==========================================
# YIMLY PRODUCTION DOCKERFILE
# Multi-stage build for optimal image size
# ==========================================

# 1. Build stage
FROM node:22-alpine AS builder
WORKDIR /app

# Install build dependencies
COPY package.json package-lock.json* ./
RUN npm install

# Copy source code and build production bundle
COPY . .
RUN npm run build

# 2. Production runner stage
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data

# Install curl, ffmpeg, python3, ca-certificates and yt-dlp for audio processing
RUN apk add --no-cache curl ffmpeg python3 ca-certificates \
  && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod +x /usr/local/bin/yt-dlp

# Install only production dependencies
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --ignore-scripts

# Copy compiled backend and frontend from builder
COPY --from=builder /app/dist ./dist

# Copy database migrations for production migration runner
COPY --from=builder /app/server/db/migrations ./server/db/migrations

# Create persistent mount points
RUN mkdir -p /app/data /media

# Expose HTTP port
EXPOSE 3000

# Health check using Yimly's built-in /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start production server
CMD ["node", "dist/server.js"]
