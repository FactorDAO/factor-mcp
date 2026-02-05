# Factor MCP Server Dockerfile
FROM node:20-slim AS builder

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
FROM node:20-slim

WORKDIR /app

# Install dependencies for Rust and Foundry
RUN apt-get update && apt-get install -y \
    curl \
    git \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user for security
RUN groupadd -g 1001 factor && \
    useradd -m -u 1001 -g factor factor

# Switch to non-root user for Rust/Foundry installation
USER factor

# Set home directory
ENV HOME=/home/factor
ENV PATH="${HOME}/.cargo/bin:${HOME}/.foundry/bin:${PATH}"

# Install Rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y

# Install Foundry
RUN curl -L https://foundry.paradigm.xyz | bash && \
    ${HOME}/.foundry/bin/foundryup

# Switch back to root to copy files
USER root

# Copy built files and production dependencies
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Create config directory with correct permissions
RUN mkdir -p /home/factor/.factor-mcp && \
    chown -R factor:factor /home/factor/.factor-mcp && \
    chown -R factor:factor /app

# Switch to non-root user
USER factor

# Default environment variables
ENV NODE_ENV=production
ENV LOG_LEVEL=info
ENV SIMULATION_MODE=false
ENV DEFAULT_CHAIN=ARBITRUM_ONE

# The MCP server uses stdio transport
ENTRYPOINT ["node", "dist/index.js"]
