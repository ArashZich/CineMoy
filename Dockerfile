# Server for web/TV use (PC, NAS, Raspberry Pi). Includes ffmpeg for compatibility mode.
FROM node:22-alpine
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server ./server
COPY web ./web
ENV PORT=7070 HOST=0.0.0.0 CINEMOY_TORRENT_PORT=6881 CINEMOY_CACHE=/cache/torrents
EXPOSE 7070 6881/tcp 6881/udp
# Linux: `docker run --network host` is best. Elsewhere (Docker Desktop on macOS/Windows) publish
# the torrent port too, or peers can't connect in: see docker-compose.yml.
CMD ["node", "server/index.js"]
