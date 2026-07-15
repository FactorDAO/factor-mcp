import { z } from 'zod';
import { encodeFunctionData, isAddress, type Address } from 'viem';
import { studioProV1ABI } from '@factordao/contracts';
import { configManager } from '../../config/index.js';
import { sendTransaction, estimateGas, type TransactionParams } from '../../wallet/signer.js';
import { VaultError, WalletError, SdkError } from '../../utils/errors.js';
import type { SendTransactionParams } from '@factordao/sdk';
import { HYPEREVM_CHAIN_ID, assertHyperEvmChain } from './common.js';
import { encodeAddApiWallet } from '../../sdk/hl/coreWriter.js';
import { HL_ADDRESSES_999 } from '../../sdk/hl/HLVault.js';

const slotEnum = z.enum(['primary', 'risk', 'backup', '']);

export const hlAddApiWalletSchema = z.object({
  vault: z.string(),
  agentEoa: z.string(),
  slotName: slotEnum,
  password: z.string().optional(),
});

export type HlAddApiWalletInput = z.infer<typeof hlAddApiWalletSchema>;

export const hlAddApiWalletTool = {
  name: 'factor_hl_add_api_wallet',
  description:
    'Register a HyperLiquid API wallet (agent EOA) for a vault via CoreWriter action 9. The agent is authorized to sign off-chain EIP-712 actions (setLeverage, addIsolatedMargin, etc.) on behalf of the vault. HyperEVM (chain 999) only.',
  inputSchema: {
    type: 'object',
    properties: {
      vault: { type: 'string', description: 'Vault contract address.' },
      agentEoa: {
        type: 'string',
        description: 'EOA address that will be authorized as the HL API wallet.',
      },
      slotName: {
        type: 'string',
        enum: ['primary', 'risk', 'backup', ''],
        description: 'Named slot for this agent. Empty string = default slot.',
      },
      password: { type: 'string', description: 'Wallet password if encrypted.' },
    },
    required: ['vault', 'agentEoa', 'slotName'],
  },
  handler: async (input: HlAddApiWalletInput) => {
    const validated = hlAddApiWalletSchema.parse(input);
    if (!isAddress(validated.vault)) throw new VaultError('Invalid vault address');
    if (!isAddress(validated.agentEoa)) throw new VaultError('Invalid agentEoa address');
    assertHyperEvmChain();

    const walletName = configManager.getWalletName();
    if (!walletName) throw new WalletError('No wallet configured. Use factor_wallet_setup first.');

    const vault = validated.vault as Address;
    const agent = validated.agentEoa as Address;

    try {
      // The HLVault.ensureAgent() helper only registers the SDK's own
      // `agentSigner.address`. The MCP tool exposes an arbitrary
      // `agentEoa`, so we encode the addApiWallet block directly via the
      // SDK's `encodeAddApiWallet` and wrap it in `executeByManager` against
      // the studioProV1 ABI — matching what HLVault would have produced.
      const innerBlock = encodeAddApiWallet(HL_ADDRESSES_999.adapter, {
        apiWallet: agent,
        name: validated.slotName,
      });
      const sendTx: SendTransactionParams = {
        to: vault,
        data: encodeFunctionData({
          abi: studioProV1ABI,
          functionName: 'executeByManager',
          args: [[innerBlock.to], [innerBlock.data]],
        }),
      };

      const txParams: TransactionParams = {
        to: sendTx.to as Address,
        data: sendTx.data as `0x${string}`,
      };

      if (configManager.isSimulationMode()) {
        const gasEstimate = await estimateGas(txParams).catch(() => ({ gasLimit: 0n, totalCostEth: '0' }));
        return {
          success: true,
          simulationMode: true,
          action: 'hl_add_api_wallet',
          chainId: HYPEREVM_CHAIN_ID,
          vault,
          agentEoa: agent,
          slotName: validated.slotName,
          transaction: { to: sendTx.to, data: sendTx.data },
          gasEstimate: {
            gasLimit: gasEstimate.gasLimit.toString(),
            totalCostEth: gasEstimate.totalCostEth,
          },
        };
      }

      const result = await sendTransaction(txParams, validated.password);
      return {
        success: true,
        simulationMode: false,
        action: 'hl_add_api_wallet',
        chainId: HYPEREVM_CHAIN_ID,
        vault,
        agentEoa: agent,
        slotName: validated.slotName,
        transactionHash: result.hash,
      };
    } catch (error) {
      if (error instanceof VaultError || error instanceof WalletError) throw error;
      throw new SdkError('Failed to register HL API wallet', error);
    }
  },
};
