# ForestShield API - Production Dockerfile
# Multi-stage build for optimal container size and security

# Stage 1: Build dependencies and application
FROM node:18-alpine AS builder

# Set working directory
WORKDIR /app

# Install system dependencies needed for native modules
RUN apk add --no-cache python3 make g++

# Copy package files first (for better Docker layer caching)
COPY package*.json ./
COPY pnpm-lock.yaml ./

# Install pnpm
RUN npm install -g pnpm@8.15.4

# Install all dependencies (including devDependencies for build)
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Clean and Build the application
RUN rm -rf dist && pnpm run build

# Remove dev dependencies to reduce size
RUN pnpm prune --prod

# Stage 2: Production runtime
FROM node:18-alpine AS production

# Create app user (security best practice)
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

# Set working directory
WORKDIR /app

# Install only production runtime dependencies
RUN apk add --no-cache dumb-init curl

# Install pnpm for runtime
RUN npm install -g pnpm@8.15.4

# Copy package files
COPY package*.json ./
COPY pnpm-lock.yaml ./

# Copy built application from builder stage
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules

# Create logs directory
RUN mkdir -p /app/logs && chown nestjs:nodejs /app/logs

# Switch to non-root user
USER nestjs

# Health check removed for simplified deployment

# Expose port
EXPOSE 3000

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "dist/main.js"] 