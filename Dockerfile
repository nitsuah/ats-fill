# Dockerfile

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM deps AS test
COPY . .
CMD ["npm", "test"]

FROM mcr.microsoft.com/playwright:v1.62.1-noble AS e2e
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
# Install the exact Chromium version matching @playwright/test
RUN npx playwright install chromium
COPY . .
RUN npm run build
CMD ["npm", "run", "test:e2e"]

# Feature-tour video: e2e image + ffmpeg + Kokoro TTS for the voiceover.
# Renders frames from the real extension and assembles the YouTube cut into
# /app/video-build (see video/README.md). Kokoro-82M weights are Apache-2.0.
FROM e2e AS video
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3-venv \
  && rm -rf /var/lib/apt/lists/*
ENV KOKORO_MODEL=/opt/kokoro/kokoro-v1.0.onnx \
  KOKORO_VOICES=/opt/kokoro/voices-v1.0.bin \
  PYTHON=/opt/kokoro/venv/bin/python
RUN python3 -m venv /opt/kokoro/venv \
  && /opt/kokoro/venv/bin/pip install --no-cache-dir kokoro-onnx==0.6.1 soundfile==0.13.1 \
  && curl -fsSL -o "$KOKORO_MODEL" https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx \
  && curl -fsSL -o "$KOKORO_VOICES" https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
CMD ["npm", "run", "video"]
