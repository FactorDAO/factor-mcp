import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { configManager } from '../../config/index.js';
import { sendTransaction, estimateGas, type TransactionParams } from '../../wallet/signer.js';
import { VaultError, WalletError, SdkError } from '../../utils/errors.js';
import type { SendTransactionParams } from '@factordao/sdk';
import { PERP_INDEX, ORDER_TIF, type OrderTif } from '../../sdk/hl/index.js';
import { HYPEREVM_CHAIN_ID, assertHyperEvmChain } from './common.js';
import { buildHlVault } from './hl-vault-factory.js';

/**
 * factor_hl_place_order_raw
 *
 * Advanced placeOrder with explicit limit price + tif. Wraps the SDK's
 * lower-level `HLVault.placeOrder` (main dex, on-chain via CoreWriter)
 * and `HLVault.placeOrderOffChain` (HIP-3 builder dex, off-chain via
 * Exchange API).
 *
 * SAFETY (no-third-party-transfer invariant): this tool routes orders
 * to the vault's OWN positions on HyperLiquid. It does NOT move funds
 * to any third party. The position created (if filled) is fully owned
 * by the vault.
 *
 * Routing:
 *   - perp is numeric OR matches PERP_INDEX → main dex (on-chain)
 *   - perp is qualified (contains ':' e.g. "xyz:GOLD") → builder dex (off-chain)
 */
const tifEnum = z.enum(['Ioc', 'Alo', 'Gtc']);

export const hlPlaceOrderRawSchema = z.object({
  vault: z.string(),
  perp: z
    .union([z.string(), z.number()])
    .describe(
      'Main dex: numeric index (0) or symbol ("ETH"). Builder dex: qualified symbol ("xyz:GOLD").',
    ),
  isLong: z.boolean(),
  sizeUsd: z.number().positive(),
  limitPxReal: z.number().positive().describe('Real USD limit price (NOT 1e8-wire scale).'),
  tif: tifEnum.default('Ioc'),
  reduceOnly: z.boolean().default(false),
  cloid: z
    .string()
    .regex(/^0x[0-9a-fA-F]{32}$/)
    .optional()
    .describe('Optional client order id — 0x + 32 hex chars.'),
  password: z.string().optional(),
});

export type HlPlaceOrderRawInput = z.infer<typeof hlPlaceOrderRawSchema>;

function isBuilderDexSymbol(perp: string | number): boolean {
  return typeof perp === 'string' && perp.includes(':');
}

/// @notice Decide if the symbol resolves to a main-dex perp synchronously
/// (numeric index or in the hardcoded PERP_INDEX). Anything else that's
/// not builder-dex falls through to the SDK's async `resolvePerp` which
/// hits the dynamic universe cache.
function isMainDex(perp: string | number): boolean {
  if (typeof perp === 'number') return true;
  if (perp.includes(':')) return false;
  return perp in PERP_INDEX || /^\d+$/.test(perp);
}

export const hlPlaceOrderRawTool = {
  name: 'factor_hl_place_order_raw',
  description:
    'Advanced HyperLiquid placeOrder with explicit limit price, TIF (Ioc/Alo/Gtc), and reduceOnly. Main-dex symbols (BTC, ETH, ...) route on-chain via CoreWriter; HIP-3 builder-dex symbols (xyz:GOLD, ...) route off-chain via the HL Exchange API. Does NOT move funds to third parties — orders fill into the vault\'s own positions. HyperEVM (chain 999) only.',
  inputSchema: {
    type: 'object',
    properties: {
      vault: { type: 'string', description: 'Vault contract address (HyperEVM).' },
      perp: {
        type: ['string', 'number'],
        description:
          'Perp symbol or index. Main dex: numeric (0) or symbol ("ETH"). Builder dex: qualified ("xyz:GOLD").',
      },
      isLong: { type: 'boolean', description: 'true = buy/long, false = sell/short.' },
      sizeUsd: { type: 'number', description: 'Notional size in USD (float dollars).' },
      limitPxReal: {
        type: 'number',
        description: 'Limit price in REAL USD (NOT 1e8 wire scale), e.g. 4250.5 for $4250.50.',
      },
      tif: {
        type: 'string',
        enum: ['Ioc', 'Alo', 'Gtc'],
        description: 'Time-in-force. Ioc=immediate-or-cancel, Alo=add-liquidity-only, Gtc=good-till-cancel. Default Ioc.',
      },
      reduceOnly: {
        type: 'boolean',
        description: 'true = order only reduces an existing position. Default false.',
      },
      cloid: {
        type: 'string',
        description: 'Optional client order id — 0x + 32 hex chars (128 bits).',
      },
      password: { type: 'string', description: 'Wallet password if encrypted.' },
    },
    required: ['vault', 'perp', 'isLong', 'sizeUsd', 'limitPxReal'],
  },
  handler: async (input: HlPlaceOrderRawInput) => {
    const validated = hlPlaceOrderRawSchema.parse(input);

    if (!isAddress(validated.vault)) throw new VaultError('Invalid vault address');
    assertHyperEvmChain();

    const walletName = configManager.getWalletName();
    if (!walletName) {
      throw new WalletError('No wallet configured. Use factor_wallet_setup first.');
    }

    const vault = validated.vault as Address;
    const tif: OrderTif = ORDER_TIF[
      validated.tif.toUpperCase() as 'IOC' | 'ALO' | 'GTC'
    ] as OrderTif;

    try {
      const hlVault = buildHlVault(vault, { password: validated.password });

      // ----------------------------------------------------------------
      // Builder-dex path: off-chain HL Exchange API.
      // ----------------------------------------------------------------
      if (isBuilderDexSymbol(validated.perp)) {
        const response = await hlVault.placeOrderOffChain({
          perp: validated.perp as string,
          isLong: validated.isLong,
          sizeUsd: validated.sizeUsd,
          limitPxReal: validated.limitPxReal,
          tif: validated.tif,
          reduceOnly: validated.reduceOnly,
          cloid: validated.cloid,
        });

        return {
          submitted: true,
          kind: 'hlExchange' as const,
          action: 'hl_place_order_raw',
          chainId: HYPEREVM_CHAIN_ID,
          vault,
          perp: validated.perp,
          isLong: validated.isLong,
          sizeUsd: validated.sizeUsd,
          limitPxReal: validated.limitPxReal,
          tif: validated.tif,
          reduceOnly: validated.reduceOnly,
          status: (response as { status?: string }).status,
          response: response as unknown as Record<string, unknown>,
        };
      }

      // ----------------------------------------------------------------
      // Main-dex path: on-chain via CoreWriter (executeByManager).
      // ----------------------------------------------------------------
      if (!isMainDex(validated.perp)) {
        // Fall through anyway — SDK's resolvePerp can resolve dynamic
        // universe names like "PAXG"; we let it try.
      }
      const perpArg =
        typeof validated.perp === 'string' && /^\d+$/.test(validated.perp)
          ? Number(validated.perp)
          : (validated.perp as string | number);

      const sendTx: SendTransactionParams = await hlVault.placeOrder({
        perp: perpArg as never, // SDK's PlaceOrderParams.perp = PerpSymbol|number
        isLong: validated.isLong,
        sizeUsd: validated.sizeUsd,
        limitPxReal: validated.limitPxReal,
        tif,
        reduceOnly: validated.reduceOnly,
      });

      const txParams: TransactionParams = {
        to: sendTx.to as Address,
        data: sendTx.data as `0x${string}`,
        value: sendTx.value,
      };

      if (configManager.isSimulationMode()) {
        const gasEstimate = await estimateGas(txParams).catch(() => ({
          gasLimit: 0n,
          totalCostEth: '0',
        }));
        return {
          success: true,
          submitted: true,
          kind: 'evmTx' as const,
          simulationMode: true,
          action: 'hl_place_order_raw',
          chainId: HYPEREVM_CHAIN_ID,
          vault,
          perp: validated.perp,
          isLong: validated.isLong,
          sizeUsd: validated.sizeUsd,
          limitPxReal: validated.limitPxReal,
          tif: validated.tif,
          reduceOnly: validated.reduceOnly,
          txCalldata: { to: sendTx.to, data: sendTx.data, value: sendTx.value?.toString() ?? '0' },
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
        submitted: true,
        kind: 'evmTx' as const,
        simulationMode: false,
        action: 'hl_place_order_raw',
        chainId: HYPEREVM_CHAIN_ID,
        vault,
        perp: validated.perp,
        isLong: validated.isLong,
        sizeUsd: validated.sizeUsd,
        limitPxReal: validated.limitPxReal,
        tif: validated.tif,
        reduceOnly: validated.reduceOnly,
        transactionHash: result.hash,
      };
    } catch (error) {
      if (error instanceof VaultError || error instanceof WalletError) throw error;
      throw new SdkError('Failed to place HL raw order', error);
    }
  },
};
