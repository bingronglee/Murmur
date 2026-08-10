FROM node:20-alpine

RUN apk add --no-cache ffmpeg

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

COPY server.js organize.js notes-lib.js index.html app.js styles.css notes.html notes.js notes.css ./

ENV VOICE_DATA_DIR=/data
VOLUME /data
EXPOSE 3000

CMD ["node", "server.js"]
