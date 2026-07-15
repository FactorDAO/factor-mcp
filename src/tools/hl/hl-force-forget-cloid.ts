// SPDX-FileCopyrightText: 2026 FACTOR
// SPDX-License-Identifier: MIT
//
// Owner-only emergency cleanup of a pending cloid that the adapter's
// time-gated `settlePending` cannot remove. Use only when HL clearly
// never processed an order (e.g. CoreWriter silently dropped because
// the IOC limit landed outside the oracle band, or the request was
// rate-limited) and `settlePending` keeps reverting on MIN_SETTLE_DELAY.
//
// Wraps `HyperLiquidPerpAdapter.forceForgetCloid(uint128 cloid)`, which
// the adapter guards with `onlyVaultOwner`. Submission from a non-owner
// is rejected at chain layer.

import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { configManager } from '../../config/index.js';
import { sendTransaction, estimateGas, type TransactionParams } from '../../wallet/signer.js';
import { VaultError, WalletError, SdkError } from '../../utils/errors.js';
import type { SendTransactionParams } from '@factordao/sdk';
import { HYPEREVM_CHAIN_ID, assertHyperEvmChain } from './common.js';
import { buildHlVault } from './hl-vault-factory.js';

export const hlForceForgetCloidSchema = z.object({
  vault: z.string(),
  cloid: z
    .string()
    .regex(/^0x[0-9a-fA-F]{32}$/, 'cloid must be a 0x-prefixed 16-byte hex string (uint128)'),
  password: z.string().optional(),
});

export type HlForceForgetCloidInput = z.infer<typeof hlForceForgetCloidSchema>;

export const hlForceForgetCloidTool = {
  name: 'factor_hl_force_forget_cloid',
  description:
    'OWNER-ONLY emergency cleanup: delete a pending cloid entry from adapter storage WITHOUT the time gate. Use only when HL clearly never processed an order (e.g. CoreWriter silently dropped due to oracle band) and `settlePending` keeps failing. Wraps HyperLiquidPerpAdapter.forceForgetCloid via executeByOwner — chain rejects non-owner callers. HyperEVM (chain 999) only.',
  inputSchema: {
    type: 'object',
    properties: {
      vault: { type: 'string', description: 'Vault contract address (HyperEVM).' },
      cloid: {
        type: 'string',
        description: '0x-prefixed 16-byte hex string identifying the pending cloid to purge.',
      },
      password: { type: 'string', description: 'Wallet password if encrypted.' },
    },
    required: ['vault', 'cloid'],
  },
  handler: async (input: HlForceForgetCloidInput) => {
    const validated = hlForceForgetCloidSchema.parse(input);
    if (!isAddress(validated.vault)) throw new VaultError('Invalid vault address');
    assertHyperEvmChain();

    const walletName = configManager.getWalletName();
    if (!walletName) throw new WalletError('No wallet configured. Use factor_wallet_setup first.');

    const vault = validated.vault as Address;
    const cloidBig = BigInt(validated.cloid);

    try {
      const hlVault = buildHlVault(vault, { password: validated.password });
      const sendTx: SendTransactionParams = hlVault.forceForgetCloid(cloidBig);

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
          action: 'hl_force_forget_cloid',
          chainId: HYPEREVM_CHAIN_ID,
          vault,
          cloid: validated.cloid,
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
        action: 'hl_force_forget_cloid',
        chainId: HYPEREVM_CHAIN_ID,
        vault,
        cloid: validated.cloid,
        txCalldata: { to: sendTx.to, data: sendTx.data },
        transactionHash: result.hash,
      };
    } catch (error) {
      if (error instanceof VaultError || error instanceof WalletError) throw error;
      throw new SdkError('Failed to forceForgetCloid', error);
    }
  },
};
