# Server for web/TV use (PC, NAS, Raspberry Pi). Includes ffmpeg for compatibility mode.
FROM node:22-alpine
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server ./server
COPY web ./web
ENV PORT=7070 HOST=0.0.0.0
EXPOSE 7070
# Use `docker run --network host` so the torrent engine can reach peers directly.
CMD ["node", "server/index.js"]
