import { z } from 'zod';
import { VaultError, SdkError } from '../../utils/errors.js';
import { HYPEREVM_CHAIN_ID, assertHyperEvmChain } from './common.js';
import { buildHlVault } from './hl-vault-factory.js';

/**
 * Read-only discovery of HL perp universes. The HL Info API exposes the
 * canonical main dex (230+ crypto perps) and HIP-3 builder dexes such as
 * `xyz` (mixed: commodities, stocks, FX). We do not bind to an enum because
 * HL adds builder dexes on a rolling cadence — let callers pass any name
 * and surface the empty / error result if HL doesn't know it.
 */
export const hlListPerpsSchema = z.object({
  dex: z.string().optional(),
});

export type HlListPerpsInput = z.infer<typeof hlListPerpsSchema>;

export interface HlListedPerp {
  index: number;
  name: string;
  szDecimals: number;
  maxLeverage: number;
  onlyIsolated: boolean;
  /** Mark price (real USD) — present when HL returned `assetCtxs` for the dex. */
  markPx?: number;
}

export interface HlListPerpsResult {
  chainId: typeof HYPEREVM_CHAIN_ID;
  dex: string;
  count: number;
  perps: HlListedPerp[];
}

// Need a *some* vault address to instantiate `HLVault` for read-only calls;
// the listPerps method only hits HL Info API and ignores the vault address.
// Using the canonical zero address keeps the SDK happy without leaking a real one.
const ZERO_VAULT_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

export const hlListPerpsTool = {
  name: 'factor_hl_list_perps',
  description:
    'List every perp available on a HyperLiquid dex with its metadata + mark price. Pass dex="main" (default) for the 230+ canonical crypto perps, dex="xyz" for the HIP-3 builder dex (xyz:GOLD, xyz:BRENTOIL, xyz:COPPER, xyz:AAPL, ...), or any other builder-dex name. HyperEVM (chain 999) only.',
  inputSchema: {
    type: 'object',
    properties: {
      dex: {
        type: 'string',
        description:
          'Which perp dex to query. "main" (default) = canonical HL perp dex. "xyz" = HIP-3 builder dex. Any other string is forwarded to HL as a builder-dex name.',
      },
    },
    required: [],
  },
  handler: async (input: HlListPerpsInput): Promise<HlListPerpsResult> => {
    const validated = hlListPerpsSchema.parse(input ?? {});
    assertHyperEvmChain();

    const dex = validated.dex ?? 'main';

    try {
      const hlVault = buildHlVault(ZERO_VAULT_ADDRESS, { requireSigner: false });
      const perps = await hlVault.listPerps(dex);
      return {
        chainId: HYPEREVM_CHAIN_ID,
        dex,
        count: perps.length,
        perps: perps.map((p) => ({
          index: p.index,
          name: p.name,
          szDecimals: p.szDecimals,
          maxLeverage: p.maxLeverage,
          onlyIsolated: p.onlyIsolated,
          markPx: p.markPx,
        })),
      };
    } catch (error) {
      if (error instanceof VaultError) throw error;
      throw new SdkError(`Failed to list HL perps on dex "${dex}"`, error);
    }
  },
};
