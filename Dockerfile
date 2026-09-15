# One process: the admin, the commerce core, the agent runtime and every
# storefront. State lives in /app/data (sqlite + uploads); mount it there.
# No VOLUME instruction: the mount is declared by whatever runs the image
# (a named volume in docker-compose.yml, a Railway Volume on Railway, which
# rejects Dockerfiles that carry VOLUME). The app creates the directory.
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
RUN npm ci --omit=dev && npx playwright install --with-deps chromium
COPY src ./src
EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4100)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "src/main.ts"]
