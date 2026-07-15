// SPDX-FileCopyrightText: 2026 FACTOR
// SPDX-License-Identifier: MIT
//
// Diagnose + initialise a Factor vault's HyperLiquid user-account on a
// HIP-3 builder dex (xyz, vntl, flx, hyna, km, ...). Wraps the SDK's
// `HLVault.initializeBuilderDex` so MCP callers can probe the dex's
// collateral-token requirements + enable HL's `dexAbstraction` mode
// without writing TypeScript.
//
// Empirical finding (mainnet 2026-05-14): the original "vntl is locked"
// symptom is NOT a missing init action — it's a collateral-token
// mismatch. HIP-3 dexes pick their own quote token (vntl/flx/km use
// USDH=360, hyna uses USDE=235, cash uses USDT0=268, xyz uses USDC=0).
// The current v5 adapter's `transferUsdcBetweenLedgers` HARDCODES
// `token=0` (USDC), so funding any non-USDC-quote dex silently fails:
// HL receives the action but drops it because the destination ledger
// can't hold USDC. The fix requires an adapter upgrade exposing
// `transferAssetBetweenLedgers(token, srcDex, dstDex, amount)`; until
// then this tool reports the constraint as a structured result.

import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { configManager } from '../../config/index.js';
import { VaultError, WalletError, SdkError } from '../../utils/errors.js';
import { HYPEREVM_CHAIN_ID, assertHyperEvmChain } from './common.js';
import { buildHlVault } from './hl-vault-factory.js';

export const hlInitializeBuilderDexSchema = z.object({
  vault: z.string(),
  dexName: z.string().min(1),
  password: z.string().optional(),
});

export type HlInitializeBuilderDexInput = z.infer<typeof hlInitializeBuilderDexSchema>;

export const hlInitializeBuilderDexTool = {
  name: 'factor_hl_initialize_builder_dex',
  description:
    'Diagnose + initialise a Factor vault\'s HyperLiquid user-account on a HIP-3 builder dex. Reads the dex\'s collateral-token (USDC=0, USDH=360, USDE=235, USDT0=268, ...), calls agentEnableDexAbstraction to flag the master as HIP-3-aware, and polls clearinghouseState for credit. Returns a structured report — if the dex uses non-USDC collateral, surfaces the requirement that the adapter\'s on-chain transferUsdcBetweenLedgers (hardcoded to USDC) cannot fund it without an adapter upgrade. HyperEVM (chain 999) only.',
  inputSchema: {
    type: 'object',
    properties: {
      vault: { type: 'string', description: 'Vault contract address (HyperEVM).' },
      dexName: {
        type: 'string',
        description:
          'HIP-3 builder dex name (e.g. "vntl", "xyz", "flx", "hyna", "km", "cash", "abcd", "para"). Discoverable via factor_hl_list_dexes (planned) or by inspecting HL\'s perpDexs Info endpoint.',
      },
      password: { type: 'string', description: 'Wallet password if encrypted.' },
    },
    required: ['vault', 'dexName'],
  },
  handler: async (input: HlInitializeBuilderDexInput) => {
    const validated = hlInitializeBuilderDexSchema.parse(input);
    if (!isAddress(validated.vault)) throw new VaultError('Invalid vault address');
    assertHyperEvmChain();

    const walletName = configManager.getWalletName();
    if (!walletName) throw new WalletError('No wallet configured. Use factor_wallet_setup first.');

    const vault = validated.vault as Address;
    try {
      const hlVault = buildHlVault(vault, { password: validated.password });
      const result = await hlVault.initializeBuilderDex(validated.dexName);
      return {
        simulationMode: false,
        action: 'hl_initialize_builder_dex',
        chainId: HYPEREVM_CHAIN_ID,
        vault,
        ...result,
      };
    } catch (error) {
      if (error instanceof VaultError || error instanceof WalletError) throw error;
      throw new SdkError('Failed to initialize HL builder dex', error);
    }
  },
};
