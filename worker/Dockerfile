# Clem's background worker (docs/GUC-VPS-ENGINE.md "Background worker"). The bundle (index.cjs, migrations, PGlite
# files) is built by scripts/build-worker.mjs and uploaded by the desktop app; nothing is fetched at run time.
FROM node:22-slim
# Chromium draws the files Clem makes here (PDF pages, figures, slides; desktop/chromium-page.ts), with metric-compatible
# fonts for Times, Arial and Courier. No recommended extras: the smallest set that prints and photographs pages.
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-liberation fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
ENV CLEM_CHROMIUM=/usr/bin/chromium
WORKDIR /app
COPY . /app
RUN useradd --system --uid 10001 clem && mkdir -p /data && chown clem /data
USER clem
ENV NODE_ENV=production CLEM_BIND=0.0.0.0
CMD ["node", "index.cjs"]
