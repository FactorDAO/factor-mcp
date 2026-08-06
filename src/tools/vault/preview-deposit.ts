import { z } from 'zod';
import { isAddress, type Address, formatUnits } from 'viem';
import { configManager } from '../../config/index.js';
import { getWalletAddress } from '../../wallet/key-manager.js';
import { VaultError, SdkError } from '../../utils/errors.js';
import { StudioProVault } from '@factordao/sdk-studio';
import { ChainId } from '@factordao/sdk';
import { getPublicClient } from '../../wallet/signer.js';
import { formatWei, getTokenDecimals } from '../../utils/format.js';

export const previewDepositSchema = z.object({
  vaultAddress: z.string(),
  assetAddress: z.string(),
  amount: z.string(),
  userAddress: z.string().optional(),
});

export type PreviewDepositInput = z.infer<typeof previewDepositSchema>;

function getChainIdEnum(chain: string): ChainId {
  switch (chain) {
    case 'ARBITRUM_ONE':
      return ChainId.ARBITRUM_ONE;
    case 'BASE':
      return ChainId.BASE;
    case 'MAINNET':
      return ChainId.MAINNET;
    case 'ROBINHOOD':
      return 4663 as ChainId;
    case 'GNOSIS':
      return 100 as ChainId;
    case 'GNOSIS': return 100 as ChainId;
    default:
      return ChainId.ARBITRUM_ONE;
  }
}

export const previewDepositTool = {
  name: 'factor_preview_deposit',
  description: 'Preview a deposit to a Factor Pro vault. Returns expected shares to receive. This is a read-only operation.',
  inputSchema: {
    type: 'object',
    properties: {
      vaultAddress: {
        type: 'string',
        description: 'The vault contract address',
      },
      assetAddress: {
        type: 'string',
        description: 'The address of the token to deposit',
      },
      amount: {
        type: 'string',
        description: 'Amount to deposit in base units (wei)',
      },
      userAddress: {
        type: 'string',
        description: 'Address to check balance for. If not provided, uses the active wallet.',
      },
    },
    required: ['vaultAddress', 'assetAddress', 'amount'],
  },
  handler: async (input: PreviewDepositInput) => {
    const validated = previewDepositSchema.parse(input);

    if (!isAddress(validated.vaultAddress)) {
      throw new VaultError('Invalid vault address');
    }

    if (!isAddress(validated.assetAddress)) {
      throw new VaultError('Invalid asset address');
    }

    let amount: bigint;
    try {
      amount = BigInt(validated.amount);
      if (amount <= 0n) {
        throw new VaultError('Amount must be greater than 0');
      }
    } catch {
      throw new VaultError('Invalid amount - must be a non-negative integer string');
    }

    const vaultAddress = validated.vaultAddress as Address;
    const assetAddress = validated.assetAddress as Address;
    const chain = configManager.getConfig().chain;
    const chainId = getChainIdEnum(chain);

    try {
      const proVault = new StudioProVault({
        chainId,
        vaultAddress,
        environment: configManager.getEnvironment(),
        jsonRpcUrl: configManager.getRpcUrl(),
      });

      // Check if asset is a valid deposit asset
      const isDepositAsset = await proVault.isDepositAsset(assetAddress);
      if (!isDepositAsset) {
        throw new VaultError(`Token ${assetAddress} is not a valid deposit asset for this vault`);
      }

      // Preview deposit
      const preview = await proVault.previewDeposit({
        assetAddress,
        assetAmountBN: amount.toString(),
      });

      // Read asset token decimals for formatting
      const publicClient = getPublicClient();
      const assetDecimals = await getTokenDecimals(publicClient, assetAddress);

      // Get user balance if possible
      let userBalance: string | undefined;
      let hasEnoughBalance: boolean | undefined;

      try {
        let userAddress: Address | undefined;

        if (validated.userAddress) {
          if (isAddress(validated.userAddress)) {
            userAddress = validated.userAddress as Address;
          }
        } else {
          const walletName = configManager.getWalletName();
          if (walletName) {
            userAddress = getWalletAddress(walletName) as Address;
          }
        }

        if (userAddress) {
          const balance = await publicClient.readContract({
            address: assetAddress,
            abi: [{ name: 'balanceOf', type: 'function', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' }],
            functionName: 'balanceOf',
            args: [userAddress],
          }) as bigint;
          userBalance = balance.toString();
          hasEnoughBalance = balance >= amount;
        }
      } catch {
        // Ignore balance check errors
      }

      const sharesReceived = preview.shareAmountBN || '0';

      return {
        vault: vaultAddress,
        asset: assetAddress,
        assetDecimals,
        deposit: {
          amount: validated.amount,
          amountFmt: formatWei(validated.amount, assetDecimals),
          sharesReceived,
          sharesReceivedFmt: formatWei(sharesReceived, 18),
        },
        userBalance,
        userBalanceFmt: formatWei(userBalance, assetDecimals),
        hasEnoughBalance,
        chain,
        note: 'This is a preview. Use factor_deposit to execute the actual deposit.',
      };
    } catch (error) {
      if (error instanceof VaultError) {
        throw error;
      }
      throw new SdkError('Failed to preview deposit', error);
    }
  },
};
