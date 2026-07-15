// SPDX-FileCopyrightText: 2026 FACTOR
// SPDX-License-Identifier: MIT
//
// Read-only HL spot token universe discovery: USDC, HYPE, PURR, plus the
// bridged equities (AAPL, TSLA, NVDA, ...) and stablecoins. Wraps
// `HLVault.listSpotTokens` (a single `spotMeta` Info round-trip).

import { z } from 'zod';
import { VaultError, SdkError } from '../../utils/errors.js';
import { HYPEREVM_CHAIN_ID, assertHyperEvmChain } from './common.js';
import { buildHlVault } from './hl-vault-factory.js';

export const hlListSpotTokensSchema = z.object({
  limit: z.number().int().positive().max(1000).optional(),
  filter: z.string().optional(),
});

export type HlListSpotTokensInput = z.infer<typeof hlListSpotTokensSchema>;

export interface HlListedSpotToken {
  index: number;
  name: string;
  szDecimals: number;
  weiDecimals: number;
  evmContract?: string;
}

export interface HlListSpotTokensResult {
  chainId: typeof HYPEREVM_CHAIN_ID;
  count: number;
  total: number;
  tokens: HlListedSpotToken[];
}

const ZERO_VAULT_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

export const hlListSpotTokensTool = {
  name: 'factor_hl_list_spot_tokens',
  description:
    'List every HyperLiquid spot token (USDC, HYPE, PURR, bridged equities AAPL/TSLA/NVDA/..., stablecoins) with index, name, szDecimals, weiDecimals and optional evmContract. Read-only — wraps HLVault.listSpotTokens (single spotMeta Info round-trip). Optional substring `filter` (case-insensitive, matches token name). HyperEVM (chain 999) only.',
  inputSchema: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Max tokens to return. Default: no limit (full universe).',
      },
      filter: {
        type: 'string',
        description: 'Optional case-insensitive substring filter on token name.',
      },
    },
    required: [],
  },
  handler: async (input: HlListSpotTokensInput): Promise<HlListSpotTokensResult> => {
    const validated = hlListSpotTokensSchema.parse(input ?? {});
    assertHyperEvmChain();
    try {
      const hlVault = buildHlVault(ZERO_VAULT_ADDRESS, { requireSigner: false });
      const tokens = await hlVault.listSpotTokens();
      let filtered = tokens;
      if (validated.filter && validated.filter.length > 0) {
        const needle = validated.filter.toLowerCase();
        filtered = filtered.filter((t) => t.name.toLowerCase().includes(needle));
      }
      const sliced = typeof validated.limit === 'number' ? filtered.slice(0, validated.limit) : filtered;
      return {
        chainId: HYPEREVM_CHAIN_ID,
        count: sliced.length,
        total: tokens.length,
        tokens: sliced.map((t) => ({
          index: t.index,
          name: t.name,
          szDecimals: t.szDecimals,
          weiDecimals: t.weiDecimals,
          evmContract: t.evmContract,
        })),
      };
    } catch (error) {
      if (error instanceof VaultError) throw error;
      throw new SdkError('Failed to list HL spot tokens', error);
    }
  },
};
