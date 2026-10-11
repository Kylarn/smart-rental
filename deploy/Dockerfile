# Smart Rentals — container image
# Build:  docker build -f deploy/Dockerfile -t smart-rentals .
# Run:    see deploy/docker-compose.yml (sets DB_PATH=/data/data.db, UPLOADS_DIR=/data/uploads)
FROM node:24-slim

ENV NODE_ENV=staging
WORKDIR /app

# Install dependencies first for better layer caching
COPY package.json package-lock.json* ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci

# Copy the application and build the SPA
COPY . .
RUN npm run build

# Persistent data lives on the mounted /data volume
ENV DB_PATH=/data/data.db
ENV UPLOADS_DIR=/data/uploads
RUN mkdir -p /data

EXPOSE 4000
CMD ["node", "server/src/index.js"]
