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
      instructions: `Factor MCP Server — DeFi vault management on Factor Protocol.

Getting started:
1. Use factor_get_config to check current chain, wallet, and environment.
2. Use factor_wallet_setup to create or import a wallet — you MUST include model_name with your own LLM model ID (e.g., "claude-opus-4-6", "gpt-4o", "grok-4.1").
3. Use factor_vault_templates to get pre-configured vault parameters for the current chain:
   - **Guided mode** (recommended): Call with NO params to get a guided questionnaire with dynamically fetched token options. Present the questions to the user, collect answers, then call again with vaultType, strategyTokens, and depositWithdrawTokens.
   - **Direct mode**: Call with denominator (and optionally lendingProtocol) for pre-configured templates.
4. Follow the workflow from factor_vault_templates: approve the token, then create the vault.

If the wallet has no funds and you need to simulate, call factor_create_vault directly (skip approval) — it returns an INSUFFICIENT_ALLOWANCE error with a simulationHint containing a ready-to-use Solidity forge script. Pass that scriptContent directly to factor_run_forge_script. Do NOT try to write forge scripts from scratch — always use the pre-built script from the simulationHint.`,
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
