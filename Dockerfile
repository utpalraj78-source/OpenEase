# OpenEase Production Dockerfile
FROM node:20-alpine

# Create app directory
WORKDIR /usr/src/app

# Install dependencies first for cached layers
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# Bundle app source
COPY . .

# Ensure logs directory exists
RUN mkdir -p logs && chown -R node:node /usr/src/app

# Run as non-root user for security
USER node

# Expose web service port
EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

# Start command
CMD ["node", "server.js"]
