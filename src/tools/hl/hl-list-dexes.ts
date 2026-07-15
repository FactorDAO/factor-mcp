// SPDX-FileCopyrightText: 2026 FACTOR
// SPDX-License-Identifier: MIT
//
// Read-only HL perp-dex enumeration. By default, `HLVault.listDexes` only
// returns dexes the SDK's `SUPPORTED_PERP_DEXES` whitelist allows — today
// `main` and `xyz`. Pass `includeUnsupported: true` to surface the full HL
// perp-dex universe (currently ~9) for diagnostics / discovery.

import { z } from 'zod';
import { VaultError, SdkError } from '../../utils/errors.js';
import { HYPEREVM_CHAIN_ID, assertHyperEvmChain } from './common.js';
import { buildHlVault } from './hl-vault-factory.js';

export const hlListDexesSchema = z.object({
  includeUnsupported: z.boolean().default(false),
});

export type HlListDexesInput = z.infer<typeof hlListDexesSchema>;

export interface HlListedDex {
  index: number;
  name: string;
  type: 'main' | 'builder';
  deployer?: string;
  feeRecipient?: string;
  assetCount: number;
  supported: boolean;
}

export interface HlListDexesResult {
  chainId: typeof HYPEREVM_CHAIN_ID;
  count: number;
  dexes: HlListedDex[];
}

const ZERO_VAULT_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

export const hlListDexesTool = {
  name: 'factor_hl_list_dexes',
  description:
    'Explicit enumeration of HyperLiquid perp dexes (main + HIP-3 builder dexes). By default returns only SDK-supported dexes (main + xyz). Pass `includeUnsupported: true` for the full HL universe (~9 dexes). Each entry exposes index, name, type, optional deployer/feeRecipient, assetCount and a `supported` boolean. HyperEVM (chain 999) only.',
  inputSchema: {
    type: 'object',
    properties: {
      includeUnsupported: {
        type: 'boolean',
        description:
          'If true, return ALL HL perp dexes (not just SDK-supported ones). Default false: returns only `main` + `xyz` today.',
      },
    },
    required: [],
  },
  handler: async (input: HlListDexesInput): Promise<HlListDexesResult> => {
    const validated = hlListDexesSchema.parse(input ?? {});
    assertHyperEvmChain();
    try {
      const hlVault = buildHlVault(ZERO_VAULT_ADDRESS, { requireSigner: false });
      const dexes = await hlVault.listDexes({ includeUnsupported: validated.includeUnsupported });
      return {
        chainId: HYPEREVM_CHAIN_ID,
        count: dexes.length,
        dexes: dexes.map((d) => ({
          index: d.index,
          name: d.name,
          type: d.type,
          deployer: d.deployer,
          feeRecipient: d.feeRecipient,
          assetCount: d.assetCount,
          supported: d.supported,
        })),
      };
    } catch (error) {
      if (error instanceof VaultError) throw error;
      throw new SdkError('Failed to list HL dexes', error);
    }
  },
};
