import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { configManager } from '../../config/index.js';
import { getWalletAddress } from '../../wallet/key-manager.js';
import { VaultError, WalletError, SdkError } from '../../utils/errors.js';
import { StudioProVaultStats } from '@factordao/sdk-studio';
import { ChainId } from '@factordao/sdk';

export const getOwnedVaultsSchema = z.object({
  ownerAddress: z.string().optional(),
});

export type GetOwnedVaultsInput = z.infer<typeof getOwnedVaultsSchema>;

function getChainIdEnum(chain: string): ChainId {
  switch (chain) {
    case 'ARBITRUM_ONE':
      return ChainId.ARBITRUM_ONE;
    case 'BASE':
      return ChainId.BASE;
    case 'MAINNET':
      return ChainId.MAINNET;
    default:
      return ChainId.ARBITRUM_ONE;
  }
}

export const getOwnedVaultsTool = {
  name: 'factor_get_owned_vaults',
  description: 'Get all Factor Pro vaults owned by an address. If no address is provided, uses the active wallet address.',
  inputSchema: {
    type: 'object',
    properties: {
      ownerAddress: {
        type: 'string',
        description: 'Ethereum address to check vaults for. If not provided, uses the active wallet.',
      },
    },
  },
  handler: async (input: GetOwnedVaultsInput) => {
    const validated = getOwnedVaultsSchema.parse(input);

    let ownerAddress: Address;

    if (validated.ownerAddress) {
      if (!isAddress(validated.ownerAddress)) {
        throw new VaultError('Invalid owner address');
      }
      ownerAddress = validated.ownerAddress as Address;
    } else {
      const walletName = configManager.getWalletName();
      if (!walletName) {
        throw new WalletError('No wallet configured and no ownerAddress provided. Use factor_wallet_setup first or provide an ownerAddress.');
      }
      ownerAddress = getWalletAddress(walletName) as Address;
    }

    const chain = configManager.getConfig().chain;
    const chainId = getChainIdEnum(chain);

    try {
      const proVaultStats = new StudioProVaultStats({
        chainId,
        environment: 'production',
        jsonRpcUrl: configManager.getRpcUrl(),
      });

      const vaults = await proVaultStats.getOwnedVaults(ownerAddress);

      return {
        ownerAddress,
        chain,
        chainId: configManager.getChainId(),
        vaults: vaults.map(v => ({
          address: v.address,
          name: v.name,
          symbol: v.symbol,
          totalSupply: v.totalSupply,
          pricePerShare: v.pricePerShare,
          netVaultValue: v.netVaultValue,
          denominator: v.denominator,
          managers: v.managers,
          riskManager: v.riskManager,
          feesReceiver: v.feesReceiver,
          managerAdapters: v.managerAdapters,
          ownerAdapters: v.ownerAdapters,
          createdAt: v.timestamp,
          block: v.block,
        })),
        totalVaults: vaults.length,
      };
    } catch (error) {
      throw new SdkError('Failed to get owned vaults', error);
    }
  },
};
