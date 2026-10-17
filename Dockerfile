# Бэкенд ИДЕЛЬ (Express + better-sqlite3) в Docker.
#
# Фронтенд живёт отдельно на GitHub Pages, поэтому здесь только API.
# База и загруженные файлы должны лежать на постоянном диске:
#   DB_PATH=/data/database.db
#   UPLOAD_DIR=/data/uploads
#
# Сборка:   docker build -t idel-api .
# Запуск:   docker run -p 5001:5001 -v idel-data:/data --env-file backend/.env idel-api

FROM node:22-bookworm-slim

# better-sqlite3 — нативный модуль: нужны python3/make/g++ для сборки.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY backend/ ./

ENV NODE_ENV=production \
    PORT=5001 \
    DB_PATH=/data/database.db \
    UPLOAD_DIR=/data/uploads

RUN mkdir -p /data/uploads
VOLUME ["/data"]
EXPOSE 5001

CMD ["node", "server.js"]
