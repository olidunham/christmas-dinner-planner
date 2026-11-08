FROM node:24-alpine
WORKDIR /app
COPY server.js ./
COPY public ./public
COPY seed ./seed
ENV PORT=3000 DB_PATH=/data/planner.db
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "server.js"]
