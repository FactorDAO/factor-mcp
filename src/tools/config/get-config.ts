import { configManager } from '../../config/index.js';
import { listWallets } from '../../wallet/key-manager.js';

export const getConfigTool = {
  name: 'factor_get_config',
  description: 'Get the current Factor MCP server configuration including active chain, RPC endpoint, simulation mode, and wallet info.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async () => {
    const fullConfig = configManager.getFullConfig();
    const wallets = listWallets();

    return {
      runtime: {
        chain: fullConfig.runtime.chain,
        chainId: configManager.getChainId(),
        rpcUrl: fullConfig.runtime.rpcUrl,
        simulationMode: fullConfig.runtime.simulationMode,
        activeWallet: fullConfig.runtime.walletName,
      },
      configFile: {
        path: fullConfig.path,
        content: fullConfig.file,
      },
      wallets: wallets.map(w => ({
        name: w.name,
        address: w.address,
        encrypted: w.encrypted,
        isActive: w.name === fullConfig.runtime.walletName,
      })),
    };
  },
};
