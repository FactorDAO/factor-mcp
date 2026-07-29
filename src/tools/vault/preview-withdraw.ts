import { z } from 'zod';
import { isAddress, type Address, formatUnits } from 'viem';
import { configManager } from '../../config/index.js';
import { getWalletAddress } from '../../wallet/key-manager.js';
import { VaultError, SdkError } from '../../utils/errors.js';
import { StudioProVault } from '@factordao/sdk-studio';
import { ChainId } from '@factordao/sdk';
import { getPublicClient } from '../../wallet/signer.js';
import { formatWei, getTokenDecimals } from '../../utils/format.js';

export const previewWithdrawSchema = z.object({
  vaultAddress: z.string(),
  shares: z.string(),
  userAddress: z.string().optional(),
});

export type PreviewWithdrawInput = z.infer<typeof previewWithdrawSchema>;

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
    default:
      return ChainId.ARBITRUM_ONE;
  }
}

export const previewWithdrawTool = {
  name: 'factor_preview_withdraw',
  description: 'Preview a withdrawal from a Factor Pro vault. Returns expected assets to receive. This is a read-only operation.',
  inputSchema: {
    type: 'object',
    properties: {
      vaultAddress: {
        type: 'string',
        description: 'The vault contract address',
      },
      shares: {
        type: 'string',
        description: 'Amount of shares to redeem in base units (wei)',
      },
      userAddress: {
        type: 'string',
        description: 'Address to check share balance for. If not provided, uses the active wallet.',
      },
    },
    required: ['vaultAddress', 'shares'],
  },
  handler: async (input: PreviewWithdrawInput) => {
    const validated = previewWithdrawSchema.parse(input);

    if (!isAddress(validated.vaultAddress)) {
      throw new VaultError('Invalid vault address');
    }

    let shares: bigint;
    try {
      shares = BigInt(validated.shares);
      if (shares <= 0n) {
        throw new VaultError('Shares must be greater than 0');
      }
    } catch {
      throw new VaultError('Invalid shares - must be a non-negative integer string');
    }

    const vaultAddress = validated.vaultAddress as Address;
    const chain = configManager.getConfig().chain;
    const chainId = getChainIdEnum(chain);

    try {
      const proVault = new StudioProVault({
        chainId,
        vaultAddress,
        environment: configManager.getEnvironment(),
        jsonRpcUrl: configManager.getRpcUrl(),
      });

      // Get vault data for context
      const vaultData = await proVault.getVaultData();
      const assetAddress = vaultData.metadata.assetDenominatorAddress;

      // Read denominator decimals for formatting
      const publicClient = getPublicClient();
      const denominatorDecimals = await getTokenDecimals(publicClient, assetAddress as Address);

      // Preview withdraw
      const preview = await proVault.previewWithdraw({
        assetAddress,
        shareAmountBN: shares.toString(),
      });

      // Get user share balance if possible
      let userShares: string | undefined;
      let hasEnoughShares: boolean | undefined;

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
          const balance = await proVault.balanceOf(userAddress);
          userShares = balance.toString();
          hasEnoughShares = balance >= shares;
        }
      } catch {
        // Ignore balance check errors
      }

      const assetsReceived = preview.assetAmountBN || '0';

      return {
        vault: {
          address: vaultAddress,
          name: vaultData.metadata.name,
          symbol: vaultData.metadata.symbol,
        },
        denominatorDecimals,
        withdrawal: {
          shares: validated.shares,
          sharesFmt: formatWei(validated.shares, 18),
          assetsReceived,
          assetsReceivedFmt: formatWei(assetsReceived, denominatorDecimals),
        },
        userShares,
        userSharesFmt: formatWei(userShares, 18),
        hasEnoughShares,
        chain,
        note: 'This is a preview. Use factor_withdraw to execute the actual withdrawal.',
      };
    } catch (error) {
      if (error instanceof VaultError) {
        throw error;
      }
      throw new SdkError('Failed to preview withdrawal', error);
    }
  },
};
