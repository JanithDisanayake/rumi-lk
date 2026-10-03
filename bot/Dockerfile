# Rumi bot image for Roar AI Cloud.
#
# The platform's generated image (node:alpine) has no system libraries, so the
# optional `canvas` package cannot load there — and exam-checker annotation,
# coaching cards and reading images require it at boot. Debian + cairo/pango
# fixes that; Chromium is for the PDF reports and test papers.
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libjpeg62-turbo libgif7 librsvg2-2 \
      fontconfig fonts-dejavu-core chromium \
      python3 make g++ pkg-config libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

CMD ["npm", "start"]
