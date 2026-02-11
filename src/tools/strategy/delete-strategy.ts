import { z } from 'zod';
import { configManager } from '../../config/index.js';
import { getWalletAddress } from '../../wallet/key-manager.js';
import { signMessage } from '../../wallet/signer.js';
import { WalletError, SdkError } from '../../utils/errors.js';
import { statsApiFetch } from '../../utils/stats-api.js';

export const deleteStrategySchema = z.object({
  hash: z.string(),
  password: z.string().optional(),
});

export type DeleteStrategyInput = z.infer<typeof deleteStrategySchema>;

export const deleteStrategyTool = {
  name: 'factor_delete_strategy',
  description: 'Delete a strategy from the Factor Studio Stats API by its hash. Requires a configured wallet for signing.',
  inputSchema: {
    type: 'object',
    properties: {
      hash: {
        type: 'string',
        description: 'The hash of the strategy to delete',
      },
      password: {
        type: 'string',
        description: 'Wallet password if the wallet is encrypted',
      },
    },
    required: ['hash'],
  },
  handler: async (input: DeleteStrategyInput) => {
    const validated = deleteStrategySchema.parse(input);

    const walletName = configManager.getWalletName();
    if (!walletName) {
      throw new WalletError('No wallet configured. Use factor_wallet_setup first.');
    }

    const address = getWalletAddress(walletName);
    const message = `Delete strategy: ${validated.hash}`;
    const signature = await signMessage(message, validated.password);

    const chain = configManager.getChainId();

    try {
      const response = await statsApiFetch('/strategies/delete', {
        method: 'POST',
        body: JSON.stringify({
          chain,
          hash: validated.hash,
          owner: address,
          signature,
        }),
      });

      const data: any = await response.json();

      if (!response.ok || data.error) {
        throw new SdkError(data.message || `Stats API error: ${response.status}`, data);
      }

      return {
        success: true,
        hash: validated.hash,
        data,
      };
    } catch (error) {
      if (error instanceof WalletError || error instanceof SdkError) {
        throw error;
      }
      throw new SdkError('Failed to delete strategy', error);
    }
  },
};
