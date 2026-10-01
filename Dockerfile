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

# Feature-tour video: e2e image + ffmpeg. Renders frames from the real extension
# and assembles the YouTube cut into /app/video-build (see video/README.md).
FROM e2e AS video
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*
CMD ["npm", "run", "video"]
