FROM node:22-slim
WORKDIR /app
COPY package.json server.js ./
COPY public ./public
COPY data ./data
RUN mkdir -p /app/storage && chown -R node:node /app
USER node
ENV NODE_ENV=production DATA_DIR=/app/storage PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
