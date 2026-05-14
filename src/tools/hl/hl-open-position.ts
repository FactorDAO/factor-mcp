import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { configManager } from '../../config/index.js';
import { sendTransaction, estimateGas, type TransactionParams } from '../../wallet/signer.js';
import { VaultError, WalletError, SdkError } from '../../utils/errors.js';
import type { SendTransactionParams } from '@factordao/sdk';
import { HYPEREVM_CHAIN_ID, assertHyperEvmChain } from './common.js';
import { buildHlVault } from './hl-vault-factory.js';

const sideEnum = z.enum(['long', 'short']);

export const hlOpenPositionSchema = z.object({
  vault: z.string(),
  perp: z.string().min(1),
  side: sideEnum,
  sizeUsd: z.number().positive(),
  slippageBps: z.number().int().min(0).max(10_000).optional(),
  password: z.string().optional(),
});

export type HlOpenPositionInput = z.infer<typeof hlOpenPositionSchema>;

/**
 * A perp symbol like `xyz:GOLD` / `xyz:BRENTOIL` / `xyz:COPPER` lives on
 * an HIP-3 builder dex. CoreWriter does not (yet) route HIP-3 orders, so
 * we sign + post off-chain via the HL Exchange API instead of returning
 * a `SendTransactionParams` envelope.
 */
function isBuilderDexSymbol(perp: string): boolean {
  return perp.includes(':');
}

export const hlOpenPositionTool = {
  name: 'factor_hl_open_position',
  description:
    'Open a HyperLiquid perp position (long or short) sized in USD through a Factor vault on HyperEVM (chain 999). Main-dex symbols (BTC, ETH, ...) route on-chain via the HL adapter; HIP-3 builder-dex symbols (xyz:GOLD, xyz:BRENTOIL, xyz:COPPER, ...) route off-chain via the HL Exchange API.',
  inputSchema: {
    type: 'object',
    properties: {
      vault: {
        type: 'string',
        description: 'Vault contract address (HyperEVM).',
      },
      perp: {
        type: 'string',
        description:
          'Perp symbol. Main dex: "ETH", "BTC", "SOL". Builder dex (HIP-3): "xyz:GOLD", "xyz:BRENTOIL", "xyz:COPPER", "xyz:AAPL", etc.',
      },
      side: {
        type: 'string',
        enum: ['long', 'short'],
        description: 'Position direction.',
      },
      sizeUsd: {
        type: 'number',
        description: 'Notional size in USD (float dollars, e.g. 250.50 = $250.50).',
      },
      slippageBps: {
        type: 'number',
        description: 'Max slippage in basis points (0-10000). Default 1000 (10%).',
      },
      password: {
        type: 'string',
        description: 'Wallet password if encrypted.',
      },
    },
    required: ['vault', 'perp', 'side', 'sizeUsd'],
  },
  handler: async (input: HlOpenPositionInput) => {
    const validated = hlOpenPositionSchema.parse(input);

    if (!isAddress(validated.vault)) throw new VaultError('Invalid vault address');
    assertHyperEvmChain();

    const walletName = configManager.getWalletName();
    if (!walletName) {
      throw new WalletError('No wallet configured. Use factor_wallet_setup first.');
    }

    const vault = validated.vault as Address;
    const slippageBps = validated.slippageBps ?? 1000;
    const isLong = validated.side === 'long';

    try {
      const hlVault = buildHlVault(vault, { password: validated.password });

      // HIP-3 builder dex path — sign + post via HL Exchange API, no EVM tx.
      if (isBuilderDexSymbol(validated.perp)) {
        const hlResponse = await hlVault.openPositionOffChain({
          perp: validated.perp,
          isLong,
          sizeUsd: validated.sizeUsd,
          slippageBps,
        });
        return {
          submitted: true,
          action: 'hl_open_position',
          chainId: HYPEREVM_CHAIN_ID,
          vault,
          asset: validated.perp,
          side: validated.side,
          sizeUsd: validated.sizeUsd,
          slippageBps,
          hlResponse: hlResponse as unknown as Record<string, unknown>,
        };
      }

      const sendTx: SendTransactionParams = await hlVault.openPosition({
        perp: validated.perp,
        isLong,
        sizeUsd: validated.sizeUsd,
        slippageBps,
      });

      const txParams: TransactionParams = {
        to: sendTx.to as Address,
        data: sendTx.data as `0x${string}`,
        value: sendTx.value,
      };

      if (configManager.isSimulationMode()) {
        const gasEstimate = await estimateGas(txParams).catch(() => ({ gasLimit: 0n, totalCostEth: '0' }));
        return {
          success: true,
          simulationMode: true,
          action: 'hl_open_position',
          chainId: HYPEREVM_CHAIN_ID,
          vault,
          perp: validated.perp,
          side: validated.side,
          sizeUsd: validated.sizeUsd,
          slippageBps,
          transaction: { to: sendTx.to, data: sendTx.data },
          gasEstimate: {
            gasLimit: gasEstimate.gasLimit.toString(),
            totalCostEth: gasEstimate.totalCostEth,
          },
          note: 'Simulation mode - transaction was not broadcast.',
        };
      }

      const result = await sendTransaction(txParams, validated.password);

      return {
        success: true,
        simulationMode: false,
        action: 'hl_open_position',
        chainId: HYPEREVM_CHAIN_ID,
        vault,
        perp: validated.perp,
        side: validated.side,
        sizeUsd: validated.sizeUsd,
        slippageBps,
        transactionHash: result.hash,
      };
    } catch (error) {
      if (error instanceof VaultError || error instanceof WalletError) throw error;
      throw new SdkError('Failed to open HL perp position', error);
    }
  },
};
