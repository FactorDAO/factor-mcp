// SPDX-FileCopyrightText: 2026 FACTOR
// SPDX-License-Identifier: MIT
//
// Owner-only on-chain config bump for `transferUsdcBetweenLedgers`
// destination dex ceiling. Bumping this here does NOT auto-update the
// SDK `SUPPORTED_PERP_DEXES` whitelist — that is a separate product
// decision; this is just the on-chain gate.

import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { configManager } from '../../config/index.js';
import { sendTransaction, estimateGas, type TransactionParams } from '../../wallet/signer.js';
import { VaultError, WalletError, SdkError } from '../../utils/errors.js';
import type { SendTransactionParams } from '@factordao/sdk';
import { HYPEREVM_CHAIN_ID, assertHyperEvmChain } from './common.js';
import { buildHlVault } from './hl-vault-factory.js';

export const hlSetMaxKnownBuilderDexSchema = z.object({
  vault: z.string(),
  newMax: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe(
      'New ceiling for builder-dex index. Bumping this here does NOT auto-update the SDK SUPPORTED_PERP_DEXES whitelist — that is a separate product decision; this is just the on-chain gate.',
    ),
  password: z.string().optional(),
});

export type HlSetMaxKnownBuilderDexInput = z.infer<typeof hlSetMaxKnownBuilderDexSchema>;

export const hlSetMaxKnownBuilderDexTool = {
  name: 'factor_hl_set_max_known_builder_dex',
  description:
    'OWNER-ONLY: bump the on-chain ceiling for `transferUsdcBetweenLedgers` destination dex (`maxKnownBuilderDex`). Wraps HyperLiquidPerpAdapter.setMaxKnownBuilderDex via executeByOwner — chain rejects non-owner callers. Sanity-capped at 100. Bumping this here does NOT auto-update the SDK SUPPORTED_PERP_DEXES whitelist — that is a separate product decision. HyperEVM (chain 999) only.',
  inputSchema: {
    type: 'object',
    properties: {
      vault: { type: 'string', description: 'Vault contract address (HyperEVM).' },
      newMax: {
        type: 'number',
        description:
          'New ceiling for builder-dex index (uint32). Sanity-capped at 100. Bumping this here does NOT auto-update the SDK SUPPORTED_PERP_DEXES whitelist — that is a separate product decision; this is just the on-chain gate.',
      },
      password: { type: 'string', description: 'Wallet password if encrypted.' },
    },
    required: ['vault', 'newMax'],
  },
  handler: async (input: HlSetMaxKnownBuilderDexInput) => {
    const validated = hlSetMaxKnownBuilderDexSchema.parse(input);
    if (!isAddress(validated.vault)) throw new VaultError('Invalid vault address');
    assertHyperEvmChain();

    const walletName = configManager.getWalletName();
    if (!walletName) throw new WalletError('No wallet configured. Use factor_wallet_setup first.');

    const vault = validated.vault as Address;

    try {
      const hlVault = buildHlVault(vault, { password: validated.password });
      const sendTx: SendTransactionParams = hlVault.setMaxKnownBuilderDex(validated.newMax);

      const txParams: TransactionParams = {
        to: sendTx.to as Address,
        data: sendTx.data as `0x${string}`,
        value: sendTx.value,
      };

      if (configManager.isSimulationMode()) {
        const gasEstimate = await estimateGas(txParams).catch(() => ({ gasLimit: 0n, totalCostEth: '0' }));
        return {
          submitted: true,
          simulationMode: true,
          action: 'hl_set_max_known_builder_dex',
          chainId: HYPEREVM_CHAIN_ID,
          vault,
          newMax: validated.newMax,
          txCalldata: { to: sendTx.to, data: sendTx.data },
          transaction: { to: sendTx.to, data: sendTx.data },
          gasEstimate: {
            gasLimit: gasEstimate.gasLimit.toString(),
            totalCostEth: gasEstimate.totalCostEth,
          },
        };
      }

      const result = await sendTransaction(txParams, validated.password);
      return {
        submitted: true,
        simulationMode: false,
        action: 'hl_set_max_known_builder_dex',
        chainId: HYPEREVM_CHAIN_ID,
        vault,
        newMax: validated.newMax,
        txCalldata: { to: sendTx.to, data: sendTx.data },
        transactionHash: result.hash,
      };
    } catch (error) {
      if (error instanceof VaultError || error instanceof WalletError) throw error;
      throw new SdkError('Failed to setMaxKnownBuilderDex', error);
    }
  },
};
