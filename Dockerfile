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
# Model files are pinned by SHA-256 to the ones the committed narration was
# rendered with (the release publishes no digests); a changed asset fails the build.
RUN python3 -m venv /opt/kokoro/venv \
  && /opt/kokoro/venv/bin/pip install --no-cache-dir kokoro-onnx==0.6.1 soundfile==0.13.1 \
  && curl -fsSL -o "$KOKORO_MODEL" https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx \
  && curl -fsSL -o "$KOKORO_VOICES" https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin \
  && printf '%s  %s\n' \
    7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5 "$KOKORO_MODEL" \
    bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d "$KOKORO_VOICES" \
    | sha256sum -c -
CMD ["npm", "run", "video"]
