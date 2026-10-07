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

# 2. Production runner stage with NVIDIA CUDA and PyTorch support
FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04 AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data
ENV DEBIAN_FRONTEND=noninteractive
ENV NVIDIA_VISIBLE_DEVICES=all
ENV NVIDIA_DRIVER_CAPABILITIES=compute,utility

# Install system dependencies: Node.js 22, FFmpeg, Python 3, pip, curl
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    ffmpeg \
    python3 \
    python3-pip \
    python3-venv \
    git \
  && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod +x /usr/local/bin/yt-dlp \
  && pip3 install --no-cache-dir --upgrade pip \
  && pip3 install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cu124 \
    numpy \
    torch \
    torchaudio \
    demucs \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# Install only production dependencies
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --ignore-scripts

# Copy compiled backend and frontend from builder
COPY --from=builder /app/dist ./dist

# Copy split.py and server runtime assets
COPY --from=builder /app/server/lib/split.py ./server/lib/split.py

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
