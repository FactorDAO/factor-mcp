// SPDX-FileCopyrightText: 2026 FACTOR
// SPDX-License-Identifier: MIT
//
// Intra-HL spot transfer (CoreWriter action 6) — restricted to self.
//
// **CRITICAL INVARIANT**: Destination is hardcoded to the vault itself in the
// adapter — this tool CANNOT transfer to a third-party HL account. Do NOT
// add a `to` parameter to this schema; the adapter ignores any caller-supplied
// destination and writes `address(this)` (the vault) on every call.
//
// Use case: shuffling spot tokens between HL ledgers within the vault's
// own HyperCore accounts (rare, but completes coverage of the adapter
// surface).

import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { configManager } from '../../config/index.js';
import { sendTransaction, estimateGas, type TransactionParams } from '../../wallet/signer.js';
import { VaultError, WalletError, SdkError } from '../../utils/errors.js';
import type { SendTransactionParams } from '@factordao/sdk';
import { HYPEREVM_CHAIN_ID, assertHyperEvmChain } from './common.js';
import { buildHlVault } from './hl-vault-factory.js';

export const hlSpotSendSchema = z.object({
  vault: z.string(),
  token: z
    .number()
    .int()
    .min(0)
    .describe(
      'HyperCore spot token id (USDC = 0, HYPE = 150, ...). Destination is hardcoded to the vault itself in the adapter — vault-to-vault only, cannot send to a third address.',
    ),
  amountWei: z
    .string()
    .describe('Amount in token-native HL wei units (USDC: 8 decimals).'),
  password: z.string().optional(),
});

export type HlSpotSendInput = z.infer<typeof hlSpotSendSchema>;

export const hlSpotSendTool = {
  name: 'factor_hl_spot_send',
  description:
    'Intra-HL spot transfer (CoreWriter action 6) RESTRICTED TO SELF. Destination is hardcoded to the vault itself in the adapter — this tool CANNOT transfer to a third-party HL account. Vault-to-vault only. Used for shuffling spot tokens between HL ledgers within the vault\'s own HyperCore accounts. HyperEVM (chain 999) only.',
  inputSchema: {
    type: 'object',
    properties: {
      vault: { type: 'string', description: 'Vault contract address (HyperEVM).' },
      token: {
        type: 'number',
        description:
          'HyperCore spot token id (USDC = 0, HYPE = 150, ...). Vault-to-vault only. Cannot send to a third address.',
      },
      amountWei: {
        type: 'string',
        description:
          'Amount in token-native HL wei units (USDC uses 8 decimals on HL spot). Vault-to-vault only. Cannot send to a third address.',
      },
      password: { type: 'string', description: 'Wallet password if encrypted.' },
    },
    required: ['vault', 'token', 'amountWei'],
  },
  handler: async (input: HlSpotSendInput) => {
    const validated = hlSpotSendSchema.parse(input);
    if (!isAddress(validated.vault)) throw new VaultError('Invalid vault address');
    assertHyperEvmChain();

    const walletName = configManager.getWalletName();
    if (!walletName) throw new WalletError('No wallet configured. Use factor_wallet_setup first.');

    const vault = validated.vault as Address;
    let amountWeiBig: bigint;
    try {
      amountWeiBig = BigInt(validated.amountWei);
    } catch {
      throw new VaultError(`Invalid amountWei: ${validated.amountWei} (must be a base-10 integer string)`);
    }
    if (amountWeiBig <= 0n) {
      throw new VaultError(`amountWei must be > 0 (got ${validated.amountWei})`);
    }

    try {
      const hlVault = buildHlVault(vault, { password: validated.password });
      const sendTx: SendTransactionParams = hlVault.spotSend({
        token: validated.token,
        amountWei: amountWeiBig,
      });

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
          action: 'hl_spot_send',
          chainId: HYPEREVM_CHAIN_ID,
          vault,
          token: validated.token,
          amountWei: validated.amountWei,
          note: 'Destination is hardcoded to the vault itself in the adapter — vault-to-vault only.',
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
        action: 'hl_spot_send',
        chainId: HYPEREVM_CHAIN_ID,
        vault,
        token: validated.token,
        amountWei: validated.amountWei,
        note: 'Destination is hardcoded to the vault itself in the adapter — vault-to-vault only.',
        txCalldata: { to: sendTx.to, data: sendTx.data },
        transactionHash: result.hash,
      };
    } catch (error) {
      if (error instanceof VaultError || error instanceof WalletError) throw error;
      throw new SdkError('Failed to spotSend', error);
    }
  },
};
