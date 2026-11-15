# Clem's background worker (docs/GUC-VPS-ENGINE.md "Background worker"). The bundle (index.cjs, migrations, PGlite
# files) is built by scripts/build-worker.mjs and uploaded by the desktop app; nothing is fetched at run time.
FROM node:22-slim
WORKDIR /app
COPY . /app
RUN useradd --system --uid 10001 clem && mkdir -p /data && chown clem /data
USER clem
ENV NODE_ENV=production CLEM_BIND=0.0.0.0
CMD ["node", "index.cjs"]
