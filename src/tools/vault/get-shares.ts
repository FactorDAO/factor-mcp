import { z } from 'zod';
import { isAddress, type Address, formatUnits } from 'viem';
import { configManager } from '../../config/index.js';
import { getWalletAddress } from '../../wallet/key-manager.js';
import { VaultError, WalletError, SdkError } from '../../utils/errors.js';
import { StudioProVault } from '@factordao/sdk-studio';
import { ChainId } from '@factordao/sdk';

export const getSharesSchema = z.object({
  vaultAddress: z.string(),
  userAddress: z.string().optional(),
});

export type GetSharesInput = z.infer<typeof getSharesSchema>;

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

export const getSharesTool = {
  name: 'factor_get_shares',
  description: 'Get the user\'s shares in a vault, including the total supply, price per share, and calculated value.',
  inputSchema: {
    type: 'object',
    properties: {
      vaultAddress: {
        type: 'string',
        description: 'The vault contract address',
      },
      userAddress: {
        type: 'string',
        description: 'Address to check shares for. If not provided, uses the active wallet.',
      },
    },
    required: ['vaultAddress'],
  },
  handler: async (input: GetSharesInput) => {
    const validated = getSharesSchema.parse(input);

    if (!isAddress(validated.vaultAddress)) {
      throw new VaultError('Invalid vault address');
    }

    let userAddress: Address;

    if (validated.userAddress) {
      if (!isAddress(validated.userAddress)) {
        throw new VaultError('Invalid user address');
      }
      userAddress = validated.userAddress as Address;
    } else {
      const walletName = configManager.getWalletName();
      if (!walletName) {
        throw new WalletError('No wallet configured and no userAddress provided. Use factor_wallet_setup first or provide a userAddress.');
      }
      userAddress = getWalletAddress(walletName) as Address;
    }

    const vaultAddress = validated.vaultAddress as Address;
    const chain = configManager.getConfig().chain;
    const chainId = getChainIdEnum(chain);

    try {
      const proVault = new StudioProVault({
        chainId,
        vaultAddress,
        jsonRpcUrl: configManager.getRpcUrl(),
      });

      const [shares, totalSupply, pricePerShare] = await Promise.all([
        proVault.balanceOf(userAddress),
        proVault.getTotalSupply(),
        proVault.getPricePerShare(),
      ]);

      // Calculate ownership percentage
      const percentage = totalSupply > 0n
        ? (Number(shares) / Number(totalSupply)) * 100
        : 0;

      // Calculate share value (shares * pricePerShare / 1e18)
      const shareValueRaw = (shares * pricePerShare) / BigInt(1e18);

      return {
        vaultAddress,
        userAddress,
        shares: {
          raw: shares.toString(),
          formatted: formatUnits(shares, 18),
        },
        totalSupply: {
          raw: totalSupply.toString(),
          formatted: formatUnits(totalSupply, 18),
        },
        pricePerShare: {
          raw: pricePerShare.toString(),
          formatted: formatUnits(pricePerShare, 18),
        },
        ownershipPercentage: percentage.toFixed(4) + '%',
        estimatedValue: {
          raw: shareValueRaw.toString(),
          formatted: formatUnits(shareValueRaw, 18),
          note: 'Value is denominated in the vault\'s denominator asset',
        },
        chain,
      };
    } catch (error) {
      throw new SdkError('Failed to get shares', error);
    }
  },
};
