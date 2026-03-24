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
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -m -s /bin/bash voicebot

WORKDIR /home/voicebot/app

# Node modules from builder
COPY --from=node-builder /opt/voicebot/node_modules ./node_modules
COPY package.json ./
COPY src/ ./src/

RUN chown -R voicebot:voicebot /home/voicebot

USER voicebot

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const http = require('http'); http.get('http://localhost:8080/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

CMD ["node", "src/index.js"]
