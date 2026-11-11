FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js backup.mjs ./
COPY public ./public
RUN mkdir -p /data /backups && chown node:node /data /backups
ENV PORT=3000 HOST=0.0.0.0 DB_PATH=/data/board.db BACKUP_DIR=/backups
USER node
EXPOSE 3000
CMD ["node", "server.js"]
