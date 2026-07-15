import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { configManager } from '../../config/index.js';
import { sendTransaction, estimateGas, type TransactionParams } from '../../wallet/signer.js';
import { VaultError, WalletError, SdkError } from '../../utils/errors.js';
import type { SendTransactionParams } from '@factordao/sdk';
import { HYPEREVM_CHAIN_ID, assertHyperEvmChain } from './common.js';
import { buildHlVault } from './hl-vault-factory.js';

export const hlClosePositionSchema = z.object({
  vault: z.string(),
  perp: z.string().min(1),
  sizeUsd: z.number().positive(),
  slippageBps: z.number().int().min(0).max(10_000).optional(),
  password: z.string().optional(),
});

export type HlClosePositionInput = z.infer<typeof hlClosePositionSchema>;

/** HIP-3 builder-dex symbol → off-chain Exchange API close. */
function isBuilderDexSymbol(perp: string): boolean {
  return perp.includes(':');
}

export const hlClosePositionTool = {
  name: 'factor_hl_close_position',
  description:
    'Reduce / close a HyperLiquid perp position (reduce-only order) sized in USD through a Factor vault. HyperEVM (chain 999) only. Main-dex symbols (BTC, ETH, ...) route on-chain; HIP-3 builder-dex symbols (xyz:GOLD, xyz:BRENTOIL, ...) route off-chain via the HL Exchange API.',
  inputSchema: {
    type: 'object',
    properties: {
      vault: { type: 'string', description: 'Vault contract address.' },
      perp: {
        type: 'string',
        description:
          'Perp symbol. Main dex: "ETH", "BTC", "SOL". Builder dex (HIP-3): "xyz:GOLD", "xyz:BRENTOIL", ...',
      },
      sizeUsd: { type: 'number', description: 'Notional USD to close (reduce-only).' },
      slippageBps: { type: 'number', description: 'Max slippage in bps. Default 1000.' },
      password: { type: 'string', description: 'Wallet password if encrypted.' },
    },
    required: ['vault', 'perp', 'sizeUsd'],
  },
  handler: async (input: HlClosePositionInput) => {
    const validated = hlClosePositionSchema.parse(input);

    if (!isAddress(validated.vault)) throw new VaultError('Invalid vault address');
    assertHyperEvmChain();

    const stateless = configManager.isStateless();

    if (!stateless) {
      const walletName = configManager.getWalletName();
      if (!walletName) throw new WalletError('No wallet configured. Use factor_wallet_setup first.');
    }

    const vault = validated.vault as Address;
    const slippageBps = validated.slippageBps ?? 1000;
    const isBuilderDex = isBuilderDexSymbol(validated.perp);

    try {
      // Stateless mode + builder-dex symbol → return UNSIGNED L1 action.
      // The agent EOA private key lives in signing-service, not here. The
      // executor will POST this envelope to /sign-hl-exchange and then
      // forward the signed body to https://api.hyperliquid.xyz/exchange.
      // See hl-open-position.ts for the symmetric routing.
      if (stateless && isBuilderDex) {
        const hlVault = buildHlVault(vault, {
          password: validated.password,
          requireSigner: false,
        });
        const built = await hlVault.buildClosePositionOffChainAction({
          perp: validated.perp,
          sizeUsd: validated.sizeUsd,
          slippageBps,
        });
        return {
          success: true,
          simulationMode: false,
          action: 'hl_close_position',
          chainId: HYPEREVM_CHAIN_ID,
          vault,
          perp: validated.perp,
          sizeUsd: validated.sizeUsd,
          slippageBps,
          l1Action: {
            requiresL1Signing: true,
            action: built.action,
            nonce: built.nonce,
            vaultAddress: built.vaultAddress,
            isTestnet: false,
            asset: built.asset,
            limitPxReal: built.limitPxReal,
            sizeReal: built.sizeReal,
            isClosingBuy: built.isClosingBuy,
          },
        };
      }

      // Stateless + main perp path: return an UNSIGNED L1 exchange action
      // (same envelope shape as the builder-dex branch above). Reason: the
      // legacy EVM-adapter close (CoreWriter LimitOrder action 1) reads
      // `current.szi` from the on-chain perp-storage precompile, which only
      // sees positions opened through the EVM adapter's `openPosition`.
      // Positions opened via `MandateHlSponsorV2.executeAsAgent` →
      // CoreWriter live exclusively on HyperCore's L1 ledger and are
      // invisible to that precompile, so `closePosition()` would throw
      // `closePosition: no open position on perp <idx>` and the agent
      // would never be able to exit them.
      //
      // HyperCore is authoritative for both EVM-adapter-opened AND
      // L1-native positions, so routing every main-dex close through the
      // L1 native exchange API (via /sign-hl-exchange) closes both
      // classes correctly. The executor's existing builder-dex L1 plumbing
      // (post the calldataRef to the signer, get a signed envelope back,
      // forward to https://api.hyperliquid.xyz/exchange) is reused
      // verbatim.
      if (stateless && !isBuilderDex) {
        const hlVaultStateless = buildHlVault(vault, {
          password: validated.password,
          requireSigner: false,
        });
        const built = await hlVaultStateless.buildClosePositionOffChainAction({
          perp: validated.perp,
          sizeUsd: validated.sizeUsd,
          slippageBps,
        });
        return {
          success: true,
          simulationMode: false,
          action: 'hl_close_position',
          chainId: HYPEREVM_CHAIN_ID,
          vault,
          perp: validated.perp,
          sizeUsd: validated.sizeUsd,
          slippageBps,
          l1Action: {
            requiresL1Signing: true,
            action: built.action,
            nonce: built.nonce,
            vaultAddress: built.vaultAddress,
            isTestnet: false,
            asset: built.asset,
            limitPxReal: built.limitPxReal,
            sizeReal: built.sizeReal,
            isClosingBuy: built.isClosingBuy,
          },
        };
      }

      const hlVault = buildHlVault(vault, { password: validated.password });

      if (isBuilderDex) {
        const hlResponse = await hlVault.closePositionOffChain({
          perp: validated.perp,
          sizeUsd: validated.sizeUsd,
          slippageBps,
        });
        return {
          submitted: true,
          action: 'hl_close_position',
          chainId: HYPEREVM_CHAIN_ID,
          vault,
          asset: validated.perp,
          sizeUsd: validated.sizeUsd,
          slippageBps,
          hlResponse: hlResponse as unknown as Record<string, unknown>,
        };
      }

      const sendTx: SendTransactionParams = await hlVault.closePosition({
        perp: validated.perp,
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
          action: 'hl_close_position',
          chainId: HYPEREVM_CHAIN_ID,
          vault,
          perp: validated.perp,
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
        action: 'hl_close_position',
        chainId: HYPEREVM_CHAIN_ID,
        vault,
        perp: validated.perp,
        sizeUsd: validated.sizeUsd,
        slippageBps,
        transactionHash: result.hash,
      };
    } catch (error) {
      if (error instanceof VaultError || error instanceof WalletError) throw error;
      throw new SdkError('Failed to close HL perp position', error);
    }
  },
};
