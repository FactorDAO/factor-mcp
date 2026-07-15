// SPDX-FileCopyrightText: 2026 FACTOR
// SPDX-License-Identifier: MIT
//
// Strict single-match resolver. Throws on ambiguity or no match. Use this
// when the caller has a concrete instrument in mind (e.g. about to compile
// an open-position plan) and wants a sharp error message rather than a
// silent best-effort.

import { z } from 'zod';
import { VaultError, SdkError } from '../../utils/errors.js';
import { HYPEREVM_CHAIN_ID, assertHyperEvmChain } from './common.js';
import { buildHlVault } from './hl-vault-factory.js';
import {
  buildInstrumentCatalog,
  resolveInstrument,
  type Instrument,
} from '../../sdk/hl/index.js';

export const hlResolveInstrumentSchema = z.object({
  query: z.string().min(1),
});

export type HlResolveInstrumentInput = z.infer<typeof hlResolveInstrumentSchema>;

export interface HlResolveInstrumentResult {
  chainId: typeof HYPEREVM_CHAIN_ID;
  query: string;
  instrument: Instrument;
}

const ZERO_VAULT_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

export const hlResolveInstrumentTool = {
  name: 'factor_hl_resolve_instrument',
  description:
    'Resolve a single HyperLiquid instrument by id, qualifiedSymbol, or bare symbol. Throws on ambiguity (same symbol on multiple dexes) or no match. Use `factor_hl_search_instrument` first if the input is uncertain. HyperEVM (chain 999) only.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Instrument id ("perp:xyz:BRENTOIL"), qualifiedSymbol ("xyz:BRENTOIL"), or bare ticker ("BTC", "OPENAI").',
      },
    },
    required: ['query'],
  },
  handler: async (input: HlResolveInstrumentInput): Promise<HlResolveInstrumentResult> => {
    const validated = hlResolveInstrumentSchema.parse(input);
    assertHyperEvmChain();
    try {
      const hlVault = buildHlVault(ZERO_VAULT_ADDRESS, { requireSigner: false });
      const catalog = await buildInstrumentCatalog(hlVault);
      const instrument = resolveInstrument(catalog, validated.query);
      return {
        chainId: HYPEREVM_CHAIN_ID,
        query: validated.query,
        instrument,
      };
    } catch (error) {
      if (error instanceof VaultError) throw error;
      // The strict resolver throws plain Error — wrap so MCP sees a clean message.
      throw new SdkError(
        error instanceof Error ? error.message : 'Failed to resolve HL instrument',
        error,
      );
    }
  },
};
