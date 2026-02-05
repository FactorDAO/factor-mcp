import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { allTools, type ToolName } from './tools/index.js';
import { formatError, FactorMcpError } from './utils/errors.js';
import { logger } from './utils/logger.js';

export function createServer(): Server {
  const server = new Server(
    {
      name: 'factor-mcp',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Build tool lookup map
  const toolMap = new Map(allTools.map((tool) => [tool.name, tool]));

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: allTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = toolMap.get(name);

    if (!tool) {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }

    try {
      logger.debug(`Executing tool: ${name}`, args);
      const result = await tool.handler(args as any || {});
      logger.debug(`Tool ${name} completed successfully`);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error(`Tool ${name} failed`, error);

      const formattedError = formatError(error);

      // Return error as tool result (not throwing) to give better feedback
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(formattedError, null, 2),
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

export async function startServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();

  logger.info('Starting Factor MCP Server...');

  await server.connect(transport);

  logger.info('Factor MCP Server connected via stdio');

  // Handle shutdown
  process.on('SIGINT', async () => {
    logger.info('Shutting down...');
    await server.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info('Shutting down...');
    await server.close();
    process.exit(0);
  });
}
