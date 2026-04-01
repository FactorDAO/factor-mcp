import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  InitializeRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { allTools, type ToolName } from './tools/index.js';
import { formatError, FactorMcpError } from './utils/errors.js';
import { logger } from './utils/logger.js';
import { configManager, type RequestContext } from './config/index.js';

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
3. ALWAYS call factor_vault_templates with NO parameters first when creating a vault. This returns a guided questionnaire with available vault types and tokens fetched live from the chain. Present the questions to the user, collect their answers, then call factor_vault_templates again with vaultType, strategyTokens, and depositWithdrawTokens to get the final template. Do NOT skip the questionnaire — even if the user mentions a specific token or protocol, use the guided flow so they can see all available options and confirm their choices.
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

  // Handle tool calls — wraps with per-request context in stateless mode
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = toolMap.get(name);

    if (!tool) {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }

    // Extract chainId and environment from tool args for per-request context
    const toolArgs = (args as Record<string, unknown>) || {};
    const ctx: RequestContext = {};
    if (toolArgs.chainId != null) ctx.chainId = Number(toolArgs.chainId);
    if (toolArgs.environment) ctx.environment = toolArgs.environment as RequestContext['environment'];

    const execute = async () => {
      try {
        logger.debug(`Executing tool: ${name}`, { args: toolArgs, stateless: configManager.isStateless(), ctx });
        const result = await tool.handler(toolArgs as any);
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
    };

    // In stateless mode or when context params are provided, wrap with context
    if (ctx.chainId || ctx.environment) {
      return configManager.runWithContext(ctx, execute) as ReturnType<typeof execute>;
    }

    return execute();
  });

  return server;
}

export async function startServer(): Promise<void> {
  // Enable stateless mode if env var is set (used by MCP Gateway)
  if (process.env.STATELESS_MODE === 'true') {
    configManager.enableStatelessMode();
    logger.info('Factor MCP running in STATELESS mode — chainId and environment required per-request');
  }

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
