# Campus Find API. Build:  docker build -t campusfind-api ./server
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY . .
EXPOSE 3000
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "server.js"]
