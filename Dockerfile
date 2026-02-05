# Factor MCP Server Dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json yarn.lock* package-lock.json* ./

# Install dependencies
RUN npm install

# Copy source code
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S factor && \
    adduser -S factor -u 1001 -G factor

# Copy built files and production dependencies
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Create config directory with correct permissions
RUN mkdir -p /home/factor/.factor-mcp && \
    chown -R factor:factor /home/factor/.factor-mcp

# Switch to non-root user
USER factor

# Set home directory for config storage
ENV HOME=/home/factor

# Default environment variables
ENV NODE_ENV=production
ENV LOG_LEVEL=info
ENV SIMULATION_MODE=false
ENV DEFAULT_CHAIN=ARBITRUM_ONE

# The MCP server uses stdio transport
ENTRYPOINT ["node", "dist/index.js"]
