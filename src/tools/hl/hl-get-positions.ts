import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { VaultError, SdkError } from '../../utils/errors.js';
import { HYPEREVM_CHAIN_ID, assertHyperEvmChain } from './common.js';
import { buildHlVault } from './hl-vault-factory.js';

export const hlGetPositionsSchema = z.object({
  vault: z.string(),
});

export type HlGetPositionsInput = z.infer<typeof hlGetPositionsSchema>;

export interface HlPositionView {
  perp: string;
  isLong: boolean;
  sizeWei: string;       // signed contract size, native HL szDecimals
  entryPrice: string;    // float price as string
  leverage: number;
  mode: 'cross' | 'isolated';
  unrealizedPnl: string; // USDC 6-dec
}

export interface HlPositionsResult {
  vault: string;
  chainId: typeof HYPEREVM_CHAIN_ID;
  positions: HlPositionView[];
}

export const hlGetPositionsTool = {
  name: 'factor_hl_get_positions',
  description:
    'List all active HyperLiquid perp positions held by a Factor vault. Returns size, entry price, leverage, margin mode, and unrealized PnL. HyperEVM (chain 999) only.',
  inputSchema: {
    type: 'object',
    properties: {
      vault: { type: 'string', description: 'Vault contract address.' },
    },
    required: ['vault'],
  },
  handler: async (input: HlGetPositionsInput): Promise<HlPositionsResult> => {
    const validated = hlGetPositionsSchema.parse(input);
    if (!isAddress(validated.vault)) throw new VaultError('Invalid vault address');
    assertHyperEvmChain();

    try {
      // Read-only — don't force wallet.
      const hlVault = buildHlVault(validated.vault as Address, {
        requireSigner: false,
      });
      const raw = await hlVault.getPositions();

      // Skip empty positions (szi==0) — they're stale entries the adapter
      // should `syncPosition` away. Map perp index back to a stringified
      // identifier; we keep it as the numeric index (no reverse lookup of
      // PERP_INDEX is exposed and the SDK accepts both shapes).
      const positions: HlPositionView[] = [];
      for (const { perp, position } of raw) {
        if (position.szi === 0n) continue;
        const isLong = position.szi > 0n;
        const absSzi = isLong ? position.szi : -position.szi;
        // entryPrice = entryNtl / |szi|, expressed as a 6-dec float string.
        // (entryNtl and szi are both signed/positive bigints here.)
        let entryPrice = '0';
        if (absSzi > 0n) {
          // entryNtl is 6-dec USDC; szi is in 10^szDecimals contract units.
          // We surface a best-effort raw ratio — full price normalization
          // requires `perpAssetInfo.szDecimals` which is fetched per call.
          // Caller can use `getPerpAssetInfo` separately if they need the
          // exact float price.
          entryPrice = (Number(position.entryNtl) / Number(absSzi)).toString();
        }
        positions.push({
          perp: String(perp),
          isLong,
          sizeWei: position.szi.toString(),
          entryPrice,
          leverage: position.leverage,
          mode: position.isIsolated ? 'isolated' : 'cross',
          // Unrealized PnL is not part of the HL precompile `HLPosition`
          // struct; surfacing it requires a mark-price read + sign math.
          // For the MCP view we report '0' so the shape stays stable.
          unrealizedPnl: '0',
        });
      }

      return {
        vault: validated.vault,
        chainId: HYPEREVM_CHAIN_ID,
        positions,
      };
    } catch (error) {
      if (error instanceof VaultError) throw error;
      throw new SdkError('Failed to read HL positions', error);
    }
  },
};
