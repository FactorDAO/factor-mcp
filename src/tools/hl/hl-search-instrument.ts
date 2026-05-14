// SPDX-FileCopyrightText: 2026 FACTOR
// SPDX-License-Identifier: MIT
//
// Fuzzy instrument search — returns scored matches. Use this when the
// caller wants top-N candidates rather than a strict single match (see
// `factor_hl_resolve_instrument` for strict).

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

export const hlSearchInstrumentSchema = z.object({
  query: z.string().min(1),
  type: z.enum(['perp', 'spot']).optional(),
  category: z
    .enum(['crypto', 'stock', 'commodity', 'fx', 'index', 'meme', 'lst', 'stablecoin', 'other'])
    .optional(),
  venue: z.string().optional(),
  limit: z.number().int().positive().max(50).optional(),
});

export type HlSearchInstrumentInput = z.infer<typeof hlSearchInstrumentSchema>;

export interface HlSearchInstrumentResult {
  chainId: typeof HYPEREVM_CHAIN_ID;
  query: string;
  count: number;
  hits: Array<{ instrument: Instrument; score: number }>;
}

const ZERO_VAULT_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

export const hlSearchInstrumentTool = {
  name: 'factor_hl_search_instrument',
  description:
    'Fuzzy-search the HyperLiquid instrument catalog for matches against `query`. Returns ranked hits with a numeric score (exact id > exact symbol > qualifiedSymbol > prefix > substring > displayName substring). Optional filters on type, category, venue. HyperEVM (chain 999) only.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search string. Matches against id, symbol, qualifiedSymbol, and displayName.' },
      type: { type: 'string', enum: ['perp', 'spot'], description: 'Restrict to perps or spot tokens.' },
      category: {
        type: 'string',
        enum: ['crypto', 'stock', 'commodity', 'fx', 'index', 'meme', 'lst', 'stablecoin', 'other'],
        description: 'Category tag.',
      },
      venue: { type: 'string', description: 'Dex name filter (e.g. "main", "xyz").' },
      limit: { type: 'number', description: 'Max hits to return (default 20; hard cap 50).' },
    },
    required: ['query'],
  },
  handler: async (input: HlSearchInstrumentInput): Promise<HlSearchInstrumentResult> => {
    const validated = hlSearchInstrumentSchema.parse(input);
    assertHyperEvmChain();
    try {
      const hlVault = buildHlVault(ZERO_VAULT_ADDRESS, { requireSigner: false });
      const catalog = await buildInstrumentCatalog(hlVault);
      const hits = searchInstruments(catalog, validated.query, {
        type: validated.type as InstrumentType | undefined,
        category: validated.category as InstrumentCategory | undefined,
        venue: validated.venue,
        limit: validated.limit ?? 20,
      });
      return {
        chainId: HYPEREVM_CHAIN_ID,
        query: validated.query,
        count: hits.length,
        hits,
      };
    } catch (error) {
      if (error instanceof VaultError) throw error;
      throw new SdkError('Failed to search HL instruments', error);
    }
  },
};
