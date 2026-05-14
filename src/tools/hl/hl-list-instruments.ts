// SPDX-FileCopyrightText: 2026 FACTOR
// SPDX-License-Identifier: MIT
//
// List instruments from the unified HL catalog (perps + spot) with optional
// filters. Wraps `HLVault.getInstrumentCatalog` so a single call yields
// everything the strategy / UI / agent layer needs.

import { z } from 'zod';
import { VaultError, SdkError } from '../../utils/errors.js';
import { HYPEREVM_CHAIN_ID, assertHyperEvmChain } from './common.js';
import { buildHlVault } from './hl-vault-factory.js';
import {
  buildInstrumentCatalog,
  searchInstruments,
  type Instrument,
  type InstrumentCategory,
  type InstrumentType,
} from '../../sdk/hl/index.js';

export const hlListInstrumentsSchema = z.object({
  type: z.enum(['perp', 'spot']).optional(),
  category: z
    .enum(['crypto', 'stock', 'commodity', 'fx', 'index', 'meme', 'lst', 'stablecoin', 'other'])
    .optional(),
  venue: z.string().optional(),
  vaultTradable: z.boolean().optional(),
  limit: z.number().int().positive().max(500).optional(),
});

export type HlListInstrumentsInput = z.infer<typeof hlListInstrumentsSchema>;

export interface HlListInstrumentsResult {
  chainId: typeof HYPEREVM_CHAIN_ID;
  count: number;
  total: number;
  instruments: Instrument[];
}

const ZERO_VAULT_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

export const hlListInstrumentsTool = {
  name: 'factor_hl_list_instruments',
  description:
    'List every HyperLiquid instrument a Factor vault can see — perps on the main + builder dexes, plus spot tokens — with category tags, mark price, max leverage, and a `vaultTradable` flag. Optional filters on type, category, venue and vaultTradable. HyperEVM (chain 999) only.',
  inputSchema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['perp', 'spot'],
        description: 'Restrict to perps or spot tokens.',
      },
      category: {
        type: 'string',
        enum: ['crypto', 'stock', 'commodity', 'fx', 'index', 'meme', 'lst', 'stablecoin', 'other'],
        description: 'Category tag (crypto, stock, commodity, fx, index, meme, lst, stablecoin, other).',
      },
      venue: {
        type: 'string',
        description: 'Dex name filter ("main", "xyz", "spot", ...). For perps, "main" is the canonical HL dex.',
      },
      vaultTradable: {
        type: 'boolean',
        description: 'If true, only return instruments the current adapter can route a trade for.',
      },
      limit: {
        type: 'number',
        description: 'Max instruments to return (default 100; hard cap 500).',
      },
    },
    required: [],
  },
  handler: async (input: HlListInstrumentsInput): Promise<HlListInstrumentsResult> => {
    const validated = hlListInstrumentsSchema.parse(input ?? {});
    assertHyperEvmChain();
    try {
      const hlVault = buildHlVault(ZERO_VAULT_ADDRESS, { requireSigner: false });
      const catalog = await buildInstrumentCatalog(hlVault);
      const limit = validated.limit ?? 100;
      // Empty-query search reuses the search module's filtering + tiebreak
      // ordering so the list is stable across calls.
      const hits = searchInstruments(catalog, '', {
        type: validated.type as InstrumentType | undefined,
        category: validated.category as InstrumentCategory | undefined,
        venue: validated.venue,
        vaultTradable: validated.vaultTradable,
        limit,
      });
      return {
        chainId: HYPEREVM_CHAIN_ID,
        count: hits.length,
        total: catalog.length,
        instruments: hits.map((h) => h.instrument),
      };
    } catch (error) {
      if (error instanceof VaultError) throw error;
      throw new SdkError('Failed to list HL instruments', error);
    }
  },
};
