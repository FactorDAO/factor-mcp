// SPDX-FileCopyrightText: 2026 FACTOR
// SPDX-License-Identifier: MIT
//
// Compile a `BatchPlan` for closing a HyperLiquid perp position. Mirror
// of `hl-compile-open`. Does NOT broadcast.

import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { VaultError, SdkError } from '../../utils/errors.js';
import { HYPEREVM_CHAIN_ID, assertHyperEvmChain } from './common.js';
import { buildHlVault } from './hl-vault-factory.js';
import {
  buildInstrumentCatalog,
  compileClosePosition,
  type BatchPlan,
} from '../../sdk/hl/index.js';

export const hlCompileCloseSchema = z.object({
  vault: z.string(),
  instrumentId: z.string().min(1),
  sizeUsd: z.number().positive().optional(),
});

export type HlCompileCloseInput = z.infer<typeof hlCompileCloseSchema>;

interface JsonOperation {
  kind: 'evmTx' | 'hlExchange';
  description: string;
  to?: string;
  data?: string;
  value?: string;
  action?: unknown;
}

export interface HlCompileCloseResult {
  chainId: typeof HYPEREVM_CHAIN_ID;
  vault: string;
  plan: {
    instrument: BatchPlan['instrument'];
    intent: 'close';
    params: BatchPlan['params'];
    ops: JsonOperation[];
    warnings: string[];
    blockers: string[];
    estimates: BatchPlan['estimates'];
  };
}

function jsonifyOp(op: BatchPlan['ops'][number]): JsonOperation {
  if (op.kind === 'evmTx') {
    return {
      kind: 'evmTx',
      description: op.description,
      to: op.to,
      data: op.data,
      value: op.value.toString(),
    };
  }
  return { kind: 'hlExchange', description: op.description, action: op.action };
}

export const hlCompileCloseTool = {
  name: 'factor_hl_compile_close',
  description:
    'Compile (do NOT broadcast) a `BatchPlan` for closing a HyperLiquid perp position. If `sizeUsd` is omitted, defaults to a full close. Returns ordered EVM + HL Exchange ops, structured warnings / blockers, and notional estimates. Use `factor_hl_close_position` to actually execute. HyperEVM (chain 999) only.',
  inputSchema: {
    type: 'object',
    properties: {
      vault: { type: 'string', description: 'Vault contract address (HyperEVM).' },
      instrumentId: {
        type: 'string',
        description: 'Catalog id ("perp:main:BTC", "perp:xyz:BRENTOIL"), qualifiedSymbol, or bare ticker.',
      },
      sizeUsd: {
        type: 'number',
        description: 'Notional size in USD to close. Omit for a full close (uses current position notional).',
      },
    },
    required: ['vault', 'instrumentId'],
  },
  handler: async (input: HlCompileCloseInput): Promise<HlCompileCloseResult> => {
    const validated = hlCompileCloseSchema.parse(input);
    if (!isAddress(validated.vault)) throw new VaultError('Invalid vault address');
    assertHyperEvmChain();
    try {
      const hlVault = buildHlVault(validated.vault as Address, { requireSigner: false });
      const catalog = await buildInstrumentCatalog(hlVault);
      const plan = await compileClosePosition(hlVault, catalog, {
        instrumentId: validated.instrumentId,
        sizeUsd: validated.sizeUsd,
      });
      return {
        chainId: HYPEREVM_CHAIN_ID,
        vault: validated.vault,
        plan: {
          instrument: plan.instrument,
          intent: 'close',
          params: plan.params,
          ops: plan.ops.map(jsonifyOp),
          warnings: plan.warnings,
          blockers: plan.blockers,
          estimates: plan.estimates,
        },
      };
    } catch (error) {
      if (error instanceof VaultError) throw error;
      throw new SdkError('Failed to compile HL close-position plan', error);
    }
  },
};
