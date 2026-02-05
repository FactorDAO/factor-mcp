#!/usr/bin/env node

import { startServer } from './server.js';
import { logger } from './utils/logger.js';
import { configManager } from './config/index.js';

async function main(): Promise<void> {
  try {
    // Set log level from config
    const config = configManager.getConfig();
    logger.setLevel(config.logLevel);

    // Start the MCP server
    await startServer();
  } catch (error) {
    logger.error('Failed to start Factor MCP Server', error);
    process.exit(1);
  }
}

main();
