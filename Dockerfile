# ============================================
# Stage 1: Node builder
# ============================================
FROM node:22-slim AS node-builder

WORKDIR /opt/voicebot
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# ============================================
# Stage 2: Runtime
# ============================================
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv \
    ffmpeg \
    && pip3 install --break-system-packages faster-whisper \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -m -s /bin/bash voicebot

WORKDIR /home/voicebot/app

# Node modules from builder
COPY --from=node-builder /opt/voicebot/node_modules ./node_modules
COPY package.json ./
COPY src/ ./src/

# Tmp directory for audio files
RUN mkdir -p tmp && chown -R voicebot:voicebot /home/voicebot

USER voicebot

CMD ["node", "src/index.js"]
