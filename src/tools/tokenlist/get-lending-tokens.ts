import { z } from 'zod';
import { isAddress } from 'viem';
import { configManager } from '../../config/index.js';
import { SdkError, VaultError } from '../../utils/errors.js';
import { FactorTokenlist, Protocols, ChainId } from '@factordao/tokenlist';

const protocolEnum = z.enum(['aave', 'compoundV3', 'morpho']);

export const getLendingTokensSchema = z.object({
  protocol: protocolEnum,
  underlyingAsset: z.string().optional(),
});

export type GetLendingTokensInput = z.infer<typeof getLendingTokensSchema>;

function getChainIdEnum(chain: string): ChainId {
  switch (chain) {
    case 'ARBITRUM_ONE':
      return ChainId.ARBITRUM_ONE;
    case 'BASE':
      return ChainId.BASE;
    case 'MAINNET':
      return ChainId.ETHEREUM;
    case 'ROBINHOOD':
      return 4663 as ChainId;
    default:
      throw new Error(`Unsupported chain for lending tokens: ${chain}`);
  }
}

function getProtocolEnum(protocol: string): Protocols {
  switch (protocol) {
    case 'aave':
      return Protocols.AAVE;
    case 'compoundV3':
      return Protocols.COMPOUND;
    case 'morpho':
      return Protocols.MORPHO;
    default:
      return Protocols.AAVE;
  }
}

export const getLendingTokensTool = {
  name: 'factor_get_lending_tokens',
  description:
    'Get lending token information from the tokenlist for a specific protocol. Returns aTokens, debt tokens, and underlying asset info needed to set up a vault for lending. Use this BEFORE supplying to a lending protocol to know which tokens (assets/debts) the vault needs.',
  inputSchema: {
    type: 'object',
    properties: {
      protocol: {
        type: 'string',
        enum: ['aave', 'compoundV3', 'morpho'],
        description: 'The lending protocol to look up tokens for',
      },
      underlyingAsset: {
        type: 'string',
        description:
          'Optional: underlying token address (e.g., USDC) to filter results. If omitted, returns all tokens for the protocol.',
      },
    },
    required: ['protocol'],
  },
  handler: async (input: GetLendingTokensInput) => {
    const validated = getLendingTokensSchema.parse(input);
    const chain = configManager.getConfig().chain;
    const chainId = getChainIdEnum(chain);

    if (validated.underlyingAsset && !isAddress(validated.underlyingAsset)) {
      throw new VaultError('Invalid underlying asset address');
    }

    try {
      const tokenlist = new FactorTokenlist(chainId);
      const protocol = getProtocolEnum(validated.protocol);

      if (validated.protocol === 'aave') {
        if (validated.underlyingAsset) {
          const token = tokenlist.getDebtToken(validated.underlyingAsset, protocol);
          if (!token) {
            return {
              success: false,
              error: `No Aave token found for underlying asset ${validated.underlyingAsset}`,
              chain,
            };
          }
          return {
            success: true,
            protocol: 'aave',
            chain,
            tokens: [
              {
                symbol: (token as any).symbol,
                underlyingAddress: (token as any).underlyingAddress,
                underlyingSymbol: (token as any).underlyingSymbol,
                aToken: (token as any).aToken,
                variableDebtToken: (token as any).variableDebtToken,
                decimals: (token as any).decimals,
                buildingBlocks: (token as any).buildingBlocks,
              },
            ],
            vaultSetupNotes: [
              `To supply: vault needs the aToken (${(token as any).aToken}) registered as an ASSET with the aave accounting adapter`,
              `To borrow: vault needs the variableDebtToken (${(token as any).variableDebtToken}) registered as a DEBT with the debt accounting adapter`,
              'Vault must have the Aave adapter (factor_aave_adapter_pro) added via factor_add_adapter',
              'Use factor_get_address_book to find adapter and accounting addresses',
              'Use factor_get_factory_addresses to verify the accounting adapter for the aToken/debtToken',
              'Use factor_add_vault_token to add the aToken/debtToken with the correct accounting',
            ],
          };
        }

        const allTokens = tokenlist.getAllAaveTokens();
        return {
          success: true,
          protocol: 'aave',
          chain,
          tokens: allTokens.map((t: any) => ({
            symbol: t.symbol,
            underlyingAddress: t.underlyingAddress,
            underlyingSymbol: t.underlyingSymbol,
            aToken: t.aToken,
            variableDebtToken: t.variableDebtToken,
            decimals: t.decimals,
            buildingBlocks: t.buildingBlocks,
          })),
          total: allTokens.length,
        };
      }

      if (validated.protocol === 'compoundV3') {
        const allTokens = tokenlist.getAllCompoundTokens();
        let filtered = allTokens;

        if (validated.underlyingAsset) {
          filtered = allTokens.filter(
            (t: any) =>
              t.underlyingAddress?.toLowerCase() === validated.underlyingAsset!.toLowerCase()
          );
        }

        return {
          success: true,
          protocol: 'compoundV3',
          chain,
          tokens: filtered.map((t: any) => ({
            symbol: t.symbol,
            baseAssetAddress: t.baseAssetAddress,
            underlyingAddress: t.underlyingAddress,
            underlyingSymbol: t.underlyingSymbol,
            decimals: t.decimals,
            buildingBlocks: t.buildingBlocks,
          })),
          total: filtered.length,
        };
      }

      if (validated.protocol === 'morpho') {
        const allTokens = tokenlist.getAllMorphoTokens();
        let filtered = allTokens;

        if (validated.underlyingAsset) {
          filtered = allTokens.filter(
            (t: any) =>
              t.loanAsset?.address?.toLowerCase() === validated.underlyingAsset!.toLowerCase() ||
              t.collateralAsset?.address?.toLowerCase() === validated.underlyingAsset!.toLowerCase()
          );
        }

        return {
          success: true,
          protocol: 'morpho',
          chain,
          tokens: filtered.map((t: any) => ({
            marketId: t.id,
            name: t.name,
            loanToken: t.loanAsset?.address,
            loanSymbol: t.loanAsset?.symbol,
            loanDecimals: t.loanAsset?.decimals,
            collateralToken: t.collateralAsset?.address,
            collateralSymbol: t.collateralAsset?.symbol,
            collateralDecimals: t.collateralAsset?.decimals,
            buildingBlocks: t.buildingBlocks,
          })),
          total: filtered.length,
        };
      }

      return { success: false, error: 'Unsupported protocol' };
    } catch (error) {
      throw new SdkError('Failed to get lending tokens from tokenlist', error);
    }
  },
};
