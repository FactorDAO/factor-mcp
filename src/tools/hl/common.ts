// Shared helpers for HyperLiquid (chain 999) MCP tools.
//
// Why this exists: every HL tool must reject non-HyperEVM chains and we
// also want one place to surface the off-chain "submitted=true" return
// shape for EIP-712 signed actions that don't produce a tx hash.

import { configManager } from '../../config/index.js';
import { VaultError } from '../../utils/errors.js';

/** HyperEVM mainnet chain id — the only network the HL tools support. */
export const HYPEREVM_CHAIN_ID = 999;

/** SDK adapter's max slippage cap (mirrors HL_MAX_SLIPPAGE_BPS in sdk-studio/hl/types.ts). */
export const HL_MAX_SLIPPAGE_BPS = 3000;

/**
 * Throw `VaultError` if the current request is not on HyperEVM (chain 999).
 *
 * We resolve the chain id from `configManager.getChainId()` which already
 * handles stateless-mode per-request context vs. the global config setter.
 */
export function assertHyperEvmChain(): void {
  const cfg = configManager.getConfig();
  // ConfigManager stores chain by name; resolve the numeric id via getChain().
  let chainId: number | undefined;
  try {
    chainId = configManager.getChain().id;
  } catch {
    chainId = undefined;
  }
  // Accept the special chain name "HYPEREVM" as well, in case the config layer
  // gets a 999-aware enum before viem's chain registry does.
  const matchesByName = (cfg.chain as unknown as string) === 'HYPEREVM';
  if (chainId !== HYPEREVM_CHAIN_ID && !matchesByName) {
    throw new VaultError(
      `HL tools are only available on HyperEVM (chain ${HYPEREVM_CHAIN_ID}). Current chain: ${cfg.chain}${chainId ? ` (id ${chainId})` : ''}.`,
    );
  }
}

/** Shape returned by off-chain EIP-712 signed HL actions (no on-chain tx). */
export interface OffChainHlResult {
  submitted: true;
  txHash: 'off-chain-hl-action';
  action: string;
  chainId: typeof HYPEREVM_CHAIN_ID;
  vault: string;
  details: Record<string, unknown>;
  todo?: string;
}
