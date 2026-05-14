// SPDX-FileCopyrightText: 2026 FACTOR
// SPDX-License-Identifier: MIT
//
// Compile a `BatchPlan` for opening a HyperLiquid perp position. Returns
// the ordered list of EVM + HL Exchange operations the runner should
// broadcast, plus structured warnings / blockers / estimates. Does NOT
// broadcast — the caller (or `executeBatchPlan` in the SDK) does.

import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { VaultError, SdkError } from '../../utils/errors.js';
import { HYPEREVM_CHAIN_ID, assertHyperEvmChain } from './common.js';
import { buildHlVault } from './hl-vault-factory.js';
import {
  buildInstrumentCatalog,
  compileOpenPosition,
  type BatchPlan,
} from '../../sdk/hl/index.js';

export const hlCompileOpenSchema = z.object({
  vault: z.string(),
  instrumentId: z.string().min(1),
  sizeUsd: z.number().positive(),
  isLong: z.boolean(),
  leverage: z.number().positive().optional(),
  slippageBps: z.number().int().min(0).max(10_000).optional(),
});

export type HlCompileOpenInput = z.infer<typeof hlCompileOpenSchema>;

// JSON-friendly projection of `BatchPlan` (bigints → strings).
interface JsonOperation {
  kind: 'evmTx' | 'hlExchange';
  description: string;
  to?: string;
  data?: string;
  value?: string;
  action?: unknown;
}

export interface HlCompileOpenResult {
  chainId: typeof HYPEREVM_CHAIN_ID;
  vault: string;
  plan: {
    instrument: BatchPlan['instrument'];
    intent: 'open';
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

export const hlCompileOpenTool = {
  name: 'factor_hl_compile_open',
  description:
    'Compile (do NOT broadcast) a `BatchPlan` for opening a HyperLiquid perp position. Returns ordered EVM + HL Exchange ops, structured warnings / blockers, and margin/notional/liquidation estimates. Use `factor_hl_open_position` to actually execute. HyperEVM (chain 999) only.',
  inputSchema: {
    type: 'object',
    properties: {
      vault: { type: 'string', description: 'Vault contract address (HyperEVM).' },
      instrumentId: {
        type: 'string',
        description: 'Catalog id ("perp:main:BTC", "perp:xyz:BRENTOIL"), qualifiedSymbol, or bare ticker.',
      },
      sizeUsd: { type: 'number', description: 'Notional size in USD (must be ≥ HL min notional = $10).' },
      isLong: { type: 'boolean', description: 'true = long, false = short.' },
      leverage: { type: 'number', description: 'Target leverage. Must be ≤ instrument.maxLeverage.' },
      slippageBps: { type: 'number', description: 'Max IOC slippage in basis points (0-10000).' },
    },
    required: ['vault', 'instrumentId', 'sizeUsd', 'isLong'],
  },
  handler: async (input: HlCompileOpenInput): Promise<HlCompileOpenResult> => {
    const validated = hlCompileOpenSchema.parse(input);
    if (!isAddress(validated.vault)) throw new VaultError('Invalid vault address');
    assertHyperEvmChain();
    try {
      const hlVault = buildHlVault(validated.vault as Address, { requireSigner: false });
      const catalog = await buildInstrumentCatalog(hlVault);
      const plan = await compileOpenPosition(hlVault, catalog, {
        instrumentId: validated.instrumentId,
        sizeUsd: validated.sizeUsd,
        isLong: validated.isLong,
        leverage: validated.leverage,
        slippageBps: validated.slippageBps,
      });
      return {
        chainId: HYPEREVM_CHAIN_ID,
        vault: validated.vault,
        plan: {
          instrument: plan.instrument,
          intent: 'open',
          params: plan.params,
          ops: plan.ops.map(jsonifyOp),
          warnings: plan.warnings,
          blockers: plan.blockers,
          estimates: plan.estimates,
        },
      };
    } catch (error) {
      if (error instanceof VaultError) throw error;
      throw new SdkError('Failed to compile HL open-position plan', error);
    }
  },
};
