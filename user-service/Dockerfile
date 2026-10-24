FROM node:25-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --chown=node:node server.js app.js ./
USER node
EXPOSE 3001
CMD ["node", "server.js"]
