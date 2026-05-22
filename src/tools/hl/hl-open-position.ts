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
    'Open a HyperLiquid perp position (long or short) sized in USD through a Factor vault on HyperEVM (chain 999). Main-dex symbols (BTC, ETH, ...) route on-chain via the HL adapter; HIP-3 builder-dex symbols (xyz:GOLD, xyz:BRENTOIL, xyz:COPPER, xyz:AAPL, ...) route off-chain via the HL Exchange API.',
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

    const stateless = configManager.isStateless();

    if (!stateless) {
      const walletName = configManager.getWalletName();
      if (!walletName) {
        throw new WalletError('No wallet configured. Use factor_wallet_setup first.');
      }
    }

    const vault = validated.vault as Address;
    const slippageBps = validated.slippageBps ?? 1000;
    const isLong = validated.side === 'long';
    const isBuilderDex = isBuilderDexSymbol(validated.perp);

    try {
      // In stateless mode + builder-dex symbol path, we DO NOT sign locally.
      // The HL Exchange `order` action is an HL L1 signed action — it must be
      // signed by the agent EOA's private key which lives in the kairos
      // signing-service keystore, not in the MCP server. We build the unsigned
      // action here, return it inside an `l1Action` envelope, and agent-executor
      // routes it to `signing-service /sign-hl-exchange` for signing + POSTing
      // to https://api.hyperliquid.xyz/exchange.
      //
      // The 4 margin-movement tools (deposit_to_perp, withdraw_to_evm,
      // transfer_to_builder_dex, transfer_from_builder_dex) take a different
      // shape because they produce EVM calldata that the sponsor relays
      // through MandateHlSponsorV2.executeAsAgent — see hl-deposit-to-perp.ts.
      if (stateless && isBuilderDex) {
        const hlVault = buildHlVault(vault, {
          password: validated.password,
          requireSigner: false,
        });
        const built = await hlVault.buildOpenPositionOffChainAction({
          perp: validated.perp,
          isLong,
          sizeUsd: validated.sizeUsd,
          slippageBps,
        });
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
          // Routing envelope for agent-executor:
          // when `requiresL1Signing` is true, the executor must call
          // `signing-service /sign-hl-exchange` (NOT `/sign` or
          // `/hl/exec-as-agent`) and POST the resulting envelope to
          // https://api.hyperliquid.xyz/exchange.
          l1Action: {
            requiresL1Signing: true,
            action: built.action,
            nonce: built.nonce,
            vaultAddress: built.vaultAddress,
            isTestnet: false,
            // Diagnostics — useful for audit + decisioning, not used by HL.
            asset: built.asset,
            limitPxReal: built.limitPxReal,
            sizeReal: built.sizeReal,
            sizeUsdEffective: built.sizeUsdEffective,
            markPxReal: built.markPxReal,
          },
        };
      }

      // Stateless + main perp path: build EVM calldata (CoreWriter LimitOrder
      // action 1) WITHOUT a signer. agent-executor routes the returned calldata
      // through MandateHlSponsorV2.executeAsAgent (the same exec-as-agent
      // pipeline the activation flow uses). No L1 signature needed because
      // main-perp orders authenticate via the dispatching contract.
      if (stateless && !isBuilderDex) {
        const hlVaultStateless = buildHlVault(vault, {
          password: validated.password,
          requireSigner: false,
        });
        const sendTxNoSig: SendTransactionParams = await hlVaultStateless.openPosition({
          perp: validated.perp,
          isLong,
          sizeUsd: validated.sizeUsd,
          slippageBps,
        });
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
          transaction: {
            to: sendTxNoSig.to,
            data: sendTxNoSig.data,
            value: typeof sendTxNoSig.value === 'bigint'
              ? sendTxNoSig.value.toString()
              : sendTxNoSig.value,
          },
        };
      }

      const hlVault = buildHlVault(vault, { password: validated.password });

      // Non-stateless builder-dex path — sign + post via HL Exchange API,
      // no EVM tx. The SDK has the manager signer wired in this branch.
      if (isBuilderDex) {
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
