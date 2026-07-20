import { configManager } from '../../config/index.js';
import { getContractAddressesForChainOrThrow, StudioProVaultStats } from '@factordao/sdk-studio';
import { ChainId } from '@factordao/sdk';
import { FactorTokenlist, ChainId as TokenlistChainId } from '@factordao/tokenlist';
import { getPublicClient } from '../../wallet/signer.js';
import { getTokenSymbol, getTokenDecimals } from '../../utils/format.js';
import type { Address } from 'viem';

// Well-known token addresses per chain
const TOKEN_ADDRESSES: Record<string, Record<string, { address: string; decimals: number; symbol: string }>> = {
  ARBITRUM_ONE: {
    USDC: { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6, symbol: 'USDC' },
    'USDC.e': { address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', decimals: 6, symbol: 'USDC.e' },
    USDT: { address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6, symbol: 'USDT' },
    WETH: { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', decimals: 18, symbol: 'WETH' },
  },
  BASE: {
    USDC: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6, symbol: 'USDC' },
    USDbC: { address: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA', decimals: 6, symbol: 'USDbC' },
    WETH: { address: '0x4200000000000000000000000000000000000006', decimals: 18, symbol: 'WETH' },
  },
  MAINNET: {
    USDC: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6, symbol: 'USDC' },
    WETH: { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', decimals: 18, symbol: 'WETH' },
  },
};

function getChainIdEnum(chain: string): ChainId {
  switch (chain) {
    case 'ARBITRUM_ONE': return ChainId.ARBITRUM_ONE;
    case 'BASE': return ChainId.BASE;
    case 'MAINNET': return ChainId.MAINNET;
    case 'ROBINHOOD': return 4663 as ChainId;
    default: return ChainId.ARBITRUM_ONE;
  }
}

function getTokenlistChainId(chain: string): TokenlistChainId {
  switch (chain) {
    case 'ARBITRUM_ONE': return TokenlistChainId.ARBITRUM_ONE;
    case 'BASE': return TokenlistChainId.BASE;
    case 'MAINNET': return TokenlistChainId.ETHEREUM;
    default: return TokenlistChainId.ARBITRUM_ONE;
  }
}

type LendingProtocol = 'aave' | 'compoundV3' | 'morpho';
type VaultType = 'index_fund' | 'lending' | 'general';

interface FactoryActiveAddresses {
  assets: Array<{ asset: string; accounting: string }>;
  debts: Array<{ asset: string; accounting: string }>;
}

export interface AvailableToken {
  address: string;
  symbol: string;
  decimals: number;
}

/**
 * Fetch factory whitelisted assets and resolve their symbols + decimals on-chain.
 */
async function getAvailableTokens(
  chainId: ChainId,
  environment: 'production' | 'staging' | 'testing',
): Promise<AvailableToken[]> {
  const proVaultStats = new StudioProVaultStats({ chainId, environment });
  const factoryAddresses = await proVaultStats.getFactoryActiveAddresses() as FactoryActiveAddresses;

  const publicClient = getPublicClient();
  const uniqueAssets = new Map<string, string>(); // normalized address -> original address
  for (const item of factoryAddresses.assets) {
    const norm = item.asset.toLowerCase();
    if (!uniqueAssets.has(norm)) {
      uniqueAssets.set(norm, item.asset);
    }
  }

  const results: AvailableToken[] = [];
  const entries = Array.from(uniqueAssets.entries());

  // Resolve symbols and decimals in parallel (batches of 10 to avoid rate limits)
  const batchSize = 10;
  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);
    const resolved = await Promise.all(
      batch.map(async ([, addr]) => {
        const [symbol, decimals] = await Promise.all([
          getTokenSymbol(publicClient, addr as Address),
          getTokenDecimals(publicClient, addr as Address),
        ]);
        return { address: addr, symbol, decimals };
      }),
    );
    results.push(...resolved);
  }

  // Sort by symbol for readability, put UNKNOWN at the end
  results.sort((a, b) => {
    if (a.symbol === 'UNKNOWN' && b.symbol !== 'UNKNOWN') return 1;
    if (b.symbol === 'UNKNOWN' && a.symbol !== 'UNKNOWN') return -1;
    return a.symbol.localeCompare(b.symbol);
  });

  return results;
}

/**
 * Find the accounting adapter for a token address from factory active addresses.
 * Checks both assets and debts lists.
 */
function findAccounting(
  factoryAddresses: FactoryActiveAddresses,
  tokenAddress: string,
  list: 'assets' | 'debts'
): string | null {
  const normalized = tokenAddress.toLowerCase();
  const items = list === 'assets' ? factoryAddresses.assets : factoryAddresses.debts;
  for (const item of items) {
    if (item.asset.toLowerCase() === normalized) {
      return item.accounting;
    }
  }
  return null;
}

/**
 * Build lending-specific configuration for Aave.
 * Returns adapter addresses, asset/debt token info, and post-deploy steps.
 */
function buildAaveLendingConfig(
  contractAddresses: any,
  tokenlist: FactorTokenlist,
  factoryAddresses: FactoryActiveAddresses,
  denominatorAddress: string,
  denominatorSymbol: string,
  denominatorAccounting: string | null,
) {
  const aaveAdapter = contractAddresses.factor_aave_adapter_pro as string | undefined;
  if (!aaveAdapter) return null;

  // Look up aToken for the denominator
  try {
    const token = tokenlist.getDebtToken(denominatorAddress, 'AAVE' as any);
    if (!token) return null;

    const aToken = (token as any).aToken as string;
    const variableDebtToken = (token as any).variableDebtToken as string;

    // Find accounting for aToken and debtToken from factory
    const aTokenAccounting = findAccounting(factoryAddresses, aToken, 'assets');
    if (!aTokenAccounting) return null;

    // Build asset arrays: denominator + aToken
    const initialAssetAddresses = [denominatorAddress, aToken];
    const initialAssetAccountingAddresses = denominatorAccounting
      ? [denominatorAccounting, aTokenAccounting]
      : undefined; // let create-vault auto-detect

    // Build debt arrays if debt token has factory accounting
    let initialDebtAddresses: string[] | undefined;
    let initialDebtAccountingAddresses: string[] | undefined;
    const debtAccounting = findAccounting(factoryAddresses, variableDebtToken, 'debts');
    if (variableDebtToken && debtAccounting) {
      initialDebtAddresses = [variableDebtToken];
      initialDebtAccountingAddresses = [debtAccounting];
    }

    return {
      protocol: 'aave' as const,
      protocolAdapter: aaveAdapter,
      lendingTokens: {
        aToken,
        variableDebtToken: variableDebtToken || null,
        aTokenAccounting,
        debtAccounting: debtAccounting || null,
      },
      createVaultExtensions: {
        initialManagerAdapters: [aaveAdapter],
        initialAssetAddresses,
        ...(initialAssetAccountingAddresses && { initialAssetAccountingAddresses }),
        ...(initialDebtAddresses && { initialDebtAddresses }),
        ...(initialDebtAccountingAddresses && { initialDebtAccountingAddresses }),
      },
      postDeploySteps: [
        {
          step: 'deposit',
          tool: 'factor_deposit',
          description: `Deposit ${denominatorSymbol} into the vault`,
          params: {
            vaultAddress: '<DEPLOYED_VAULT_ADDRESS>',
            assetAddress: denominatorAddress,
            amount: '<AMOUNT_IN_WEI>',
          },
        },
        {
          step: 'supply',
          tool: 'factor_lend_supply',
          description: `Supply ${denominatorSymbol} to Aave through the vault`,
          params: {
            vaultAddress: '<DEPLOYED_VAULT_ADDRESS>',
            protocol: 'aave',
            assetAddress: denominatorAddress,
            amount: 'all',
          },
        },
      ],
    };
  } catch {
    return null;
  }
}

/**
 * Build lending-specific configuration for Compound V3.
 * Compound V3 requires TWO adapters and a market registration step.
 */
function buildCompoundV3LendingConfig(
  contractAddresses: any,
  tokenlist: FactorTokenlist,
  factoryAddresses: FactoryActiveAddresses,
  denominatorAddress: string,
  denominatorSymbol: string,
  denominatorAccounting: string | null,
) {
  const compoundAdapter = contractAddresses.factor_compound_v3_adapter_pro as string | undefined;
  const compoundMarketAdapter = contractAddresses.factor_compound_v3_market_adapter_pro as string | undefined;
  if (!compoundAdapter || !compoundMarketAdapter) return null;

  try {
    const allTokens = tokenlist.getAllCompoundTokens();
    const match = allTokens.find(
      (t: any) => t.underlyingAddress?.toLowerCase() === denominatorAddress.toLowerCase()
    );
    if (!match) return null;

    const cToken = (match as any).baseAssetAddress as string;

    // Find accounting for cToken from factory
    const cTokenAccounting = findAccounting(factoryAddresses, cToken, 'assets');
    if (!cTokenAccounting) return null;

    const initialAssetAddresses = [denominatorAddress, cToken];
    const initialAssetAccountingAddresses = denominatorAccounting
      ? [denominatorAccounting, cTokenAccounting]
      : undefined;

    return {
      protocol: 'compoundV3' as const,
      protocolAdapters: {
        compoundV3Adapter: compoundAdapter,
        compoundV3MarketAdapter: compoundMarketAdapter,
      },
      lendingTokens: {
        cToken,
        cTokenAccounting,
        underlyingAddress: denominatorAddress,
      },
      createVaultExtensions: {
        initialManagerAdapters: [compoundAdapter, compoundMarketAdapter],
        initialAssetAddresses,
        ...(initialAssetAccountingAddresses && { initialAssetAccountingAddresses }),
      },
      postDeploySteps: [
        {
          step: 'registerMarket',
          tool: 'factor_execute_manager',
          description: 'Register the Compound V3 market (REQUIRED before supply)',
          params: {
            vaultAddress: '<DEPLOYED_VAULT_ADDRESS>',
            steps: [{
              protocol: 'compoundV3',
              action: 'addMarketToAsset',
              params: { marketAddress: cToken, assetAddress: denominatorAddress },
            }],
          },
        },
        {
          step: 'deposit',
          tool: 'factor_deposit',
          description: `Deposit ${denominatorSymbol} into the vault`,
          params: {
            vaultAddress: '<DEPLOYED_VAULT_ADDRESS>',
            assetAddress: denominatorAddress,
            amount: '<AMOUNT_IN_WEI>',
          },
        },
        {
          step: 'supply',
          tool: 'factor_lend_supply',
          description: `Supply ${denominatorSymbol} to Compound V3 through the vault`,
          params: {
            vaultAddress: '<DEPLOYED_VAULT_ADDRESS>',
            protocol: 'compoundV3',
            marketAddress: cToken,
            assetAddress: denominatorAddress,
            amount: 'all',
          },
        },
      ],
    };
  } catch {
    return null;
  }
}

/**
 * Build lending-specific configuration for Morpho.
 * Morpho requires TWO adapters, BOTH collateral + loan tokens registered with
 * Chainlink accounting, and market registration via addMarketToAssetAndDebt.
 *
 * NOTE: Morpho has multiple markets per token. The template includes ALL available
 * markets so the agent/user can pick one. The postDeploySteps use <MARKET_ID> placeholder.
 */
function buildMorphoLendingConfig(
  contractAddresses: any,
  tokenlist: FactorTokenlist,
  factoryAddresses: FactoryActiveAddresses,
  denominatorAddress: string,
  denominatorSymbol: string,
  denominatorAccounting: string | null,
) {
  const morphoAdapter = contractAddresses.factor_morpho_adapter_pro as string | undefined;
  const morphoMarketAdapter = contractAddresses.factor_morpho_market_adapter_pro as string | undefined;
  const chainlinkAccounting = contractAddresses.factor_chainlink_accounting_adapter_pro as string | undefined;
  if (!morphoAdapter || !morphoMarketAdapter || !chainlinkAccounting) return null;

  try {
    const allTokens = tokenlist.getAllMorphoTokens();
    // Find markets where the denominator is the loan token
    const markets = allTokens.filter(
      (t: any) =>
        t.loanAsset?.address?.toLowerCase() === denominatorAddress.toLowerCase() ||
        t.collateralAsset?.address?.toLowerCase() === denominatorAddress.toLowerCase()
    );

    if (markets.length === 0) return null;

    // Collect unique tokens that need to be registered as assets
    const uniqueTokens = new Set<string>();
    uniqueTokens.add(denominatorAddress.toLowerCase());
    const marketList: Array<{
      marketId: string;
      name: string;
      loanToken: string;
      loanSymbol: string;
      collateralToken: string;
      collateralSymbol: string;
    }> = [];

    for (const m of markets) {
      const market = m as any;
      if (market.loanAsset?.address) uniqueTokens.add(market.loanAsset.address.toLowerCase());
      if (market.collateralAsset?.address) uniqueTokens.add(market.collateralAsset.address.toLowerCase());
      marketList.push({
        marketId: market.id,
        name: market.name || `${market.collateralAsset?.symbol}/${market.loanAsset?.symbol}`,
        loanToken: market.loanAsset?.address,
        loanSymbol: market.loanAsset?.symbol,
        collateralToken: market.collateralAsset?.address,
        collateralSymbol: market.collateralAsset?.symbol,
      });
    }

    // Verify all unique tokens have chainlink accounting in factory
    const assetAddresses: string[] = [];
    const assetAccountingAddresses: string[] = [];
    for (const addr of uniqueTokens) {
      // For Morpho, tokens use chainlink accounting
      const accounting = findAccounting(factoryAddresses, addr, 'assets');
      if (accounting) {
        assetAddresses.push(addr);
        assetAccountingAddresses.push(accounting);
      }
      // If not found, still include in assets but skip accounting (create-vault may auto-detect)
    }

    // At minimum, we need the denominator
    if (!assetAddresses.some(a => a.toLowerCase() === denominatorAddress.toLowerCase())) {
      return null;
    }

    return {
      protocol: 'morpho' as const,
      protocolAdapters: {
        morphoAdapter,
        morphoMarketAdapter,
        chainlinkAccounting,
      },
      availableMarkets: marketList,
      note: 'Morpho has multiple markets. Present these to the user and let them choose. NEVER auto-select a Morpho market.',
      createVaultExtensions: {
        initialManagerAdapters: [morphoAdapter, morphoMarketAdapter],
        initialAssetAddresses: assetAddresses,
        initialAssetAccountingAddresses: assetAccountingAddresses,
      },
      postDeploySteps: [
        {
          step: 'registerMarket',
          tool: 'factor_execute_manager',
          description: 'Register a Morpho market (REQUIRED before supply). Choose a marketId from availableMarkets above.',
          params: {
            vaultAddress: '<DEPLOYED_VAULT_ADDRESS>',
            steps: [{
              protocol: 'morpho',
              action: 'addMarketToAssetAndDebt',
              params: { marketId: '<MARKET_ID>' },
            }],
          },
        },
        {
          step: 'deposit',
          tool: 'factor_deposit',
          description: `Deposit ${denominatorSymbol} into the vault`,
          params: {
            vaultAddress: '<DEPLOYED_VAULT_ADDRESS>',
            assetAddress: denominatorAddress,
            amount: '<AMOUNT_IN_WEI>',
          },
        },
        {
          step: 'supply',
          tool: 'factor_lend_supply',
          description: `Supply to Morpho through the vault`,
          params: {
            vaultAddress: '<DEPLOYED_VAULT_ADDRESS>',
            protocol: 'morpho',
            marketId: '<MARKET_ID>',
            amount: 'all',
          },
        },
      ],
    };
  } catch {
    return null;
  }
}

/**
 * Build a vault template from guided questionnaire answers.
 */
async function buildGuidedTemplate(
  vaultType: VaultType,
  strategyTokens: string[],
  depositWithdrawTokens: string[],
  chain: string,
  chainId: ChainId,
  environment: 'production' | 'staging' | 'testing',
) {
  // Validate depositWithdrawTokens is a subset of strategyTokens
  const strategySet = new Set(strategyTokens.map(t => t.toLowerCase()));
  for (const dt of depositWithdrawTokens) {
    if (!strategySet.has(dt.toLowerCase())) {
      return {
        success: false,
        error: 'INVALID_DEPOSIT_TOKEN',
        message: `Deposit/withdraw token ${dt} is not in the strategy tokens list. It must be a subset.`,
      };
    }
  }

  let contractAddresses: any;
  try {
    contractAddresses = getContractAddressesForChainOrThrow(chainId, environment);
  } catch {
    return {
      success: false,
      error: 'SDK_ERROR',
      message: `Could not load contract addresses for ${chain} (${environment})`,
    };
  }

  const factoryAddress = contractAddresses.factor_studio_pro_factory as string;
  if (!factoryAddress) {
    return {
      success: false,
      error: 'NO_FACTORY',
      message: `No factory address found for ${chain}. Vault creation may not be available on this chain.`,
    };
  }

  // Fetch factory active addresses for accounting resolution
  let factoryActiveAddresses: FactoryActiveAddresses;
  try {
    const proVaultStats = new StudioProVaultStats({ chainId, environment });
    factoryActiveAddresses = await proVaultStats.getFactoryActiveAddresses() as FactoryActiveAddresses;
  } catch {
    return {
      success: false,
      error: 'FACTORY_FETCH_ERROR',
      message: `Could not fetch factory active addresses for ${chain} (${environment}).`,
    };
  }

  // Resolve token symbols/decimals for display
  const publicClient = getPublicClient();
  const tokenInfoMap = new Map<string, { symbol: string; decimals: number }>();
  await Promise.all(
    strategyTokens.map(async (addr) => {
      const [symbol, decimals] = await Promise.all([
        getTokenSymbol(publicClient, addr as Address),
        getTokenDecimals(publicClient, addr as Address),
      ]);
      tokenInfoMap.set(addr.toLowerCase(), { symbol, decimals });
    }),
  );

  // Use the first deposit/withdraw token as the denominator
  const denominatorAddress = depositWithdrawTokens[0];
  const denominatorInfo = tokenInfoMap.get(denominatorAddress.toLowerCase()) || { symbol: 'TOKEN', decimals: 18 };

  // Build accounting arrays for all strategy tokens
  const initialAssetAddresses: string[] = [];
  const initialAssetAccountingAddresses: string[] = [];
  for (const addr of strategyTokens) {
    const accounting = findAccounting(factoryActiveAddresses, addr, 'assets');
    if (accounting) {
      initialAssetAddresses.push(addr);
      initialAssetAccountingAddresses.push(accounting);
    }
  }

  // Build the vault name based on type
  const depositSymbols = depositWithdrawTokens.map(
    t => tokenInfoMap.get(t.toLowerCase())?.symbol || 'TOKEN'
  );
  const vaultTypeName = vaultType === 'index_fund' ? 'Index Fund' : vaultType === 'lending' ? 'Lending Vault' : 'Vault';
  const vaultName = `${depositSymbols.join('/')} ${vaultTypeName}`;

  const template: Record<string, any> = {
    name: `${vaultName} on ${chain}`,
    vaultType,
    denominator: {
      symbol: denominatorInfo.symbol,
      address: denominatorAddress,
      decimals: denominatorInfo.decimals,
    },
    strategyTokens: strategyTokens.map(addr => {
      const info = tokenInfoMap.get(addr.toLowerCase());
      return { address: addr, symbol: info?.symbol || 'UNKNOWN', decimals: info?.decimals || 18 };
    }),
    depositWithdrawTokens: depositWithdrawTokens.map(addr => {
      const info = tokenInfoMap.get(addr.toLowerCase());
      return { address: addr, symbol: info?.symbol || 'UNKNOWN', decimals: info?.decimals || 18 };
    }),
    createVaultParams: {
      name: `My ${vaultName}`,
      symbol: `f${denominatorInfo.symbol}`,
      assetDenominatorAddress: denominatorAddress,
      initialDepositAmount: denominatorInfo.decimals <= 8 ? '1600' : '1000000000000000', // sensible default
      depositFee: 0,
      withdrawFee: 0,
      managementFee: 0,
      performanceFee: 0,
      ...(initialAssetAddresses.length > 0 && { initialAssetAddresses }),
      ...(initialAssetAccountingAddresses.length > 0 && { initialAssetAccountingAddresses }),
      initialDepositAssetAddresses: depositWithdrawTokens,
      initialWithdrawAssetAddresses: depositWithdrawTokens,
    },
    approvalStep: {
      tool: 'factor_give_approval',
      params: {
        tokenAddress: denominatorAddress,
        spenderAddress: factoryAddress,
        amount: 'max',
      },
    },
  };

  // Type-specific enrichment
  if (vaultType === 'lending') {
    // For lending vaults, try to auto-detect the lending protocol from available tokens
    let tokenlist: FactorTokenlist | null = null;
    try {
      tokenlist = new FactorTokenlist(getTokenlistChainId(chain));
    } catch { /* tokenlist unavailable */ }

    if (tokenlist) {
      // Try Aave first, then Compound V3, then Morpho
      const denominatorAccounting = findAccounting(factoryActiveAddresses, denominatorAddress, 'assets');
      const lendingConfig: any =
        buildAaveLendingConfig(contractAddresses, tokenlist, factoryActiveAddresses, denominatorAddress, denominatorInfo.symbol, denominatorAccounting) ||
        buildCompoundV3LendingConfig(contractAddresses, tokenlist, factoryActiveAddresses, denominatorAddress, denominatorInfo.symbol, denominatorAccounting) ||
        buildMorphoLendingConfig(contractAddresses, tokenlist, factoryActiveAddresses, denominatorAddress, denominatorInfo.symbol, denominatorAccounting);

      if (lendingConfig) {
        template.createVaultParams = {
          ...template.createVaultParams,
          ...lendingConfig.createVaultExtensions,
        };
        template.lending = {
          protocol: lendingConfig.protocol,
          ...(lendingConfig.lendingTokens && { tokens: lendingConfig.lendingTokens }),
          ...(lendingConfig.protocolAdapter && { adapter: lendingConfig.protocolAdapter }),
          ...(lendingConfig.protocolAdapters && { adapters: lendingConfig.protocolAdapters }),
          ...(lendingConfig.availableMarkets && { availableMarkets: lendingConfig.availableMarkets }),
          ...(lendingConfig.note && { note: lendingConfig.note }),
        };
        template.postDeploySteps = lendingConfig.postDeploySteps;
      } else {
        template.lendingNote = `No lending protocol auto-detected for ${denominatorInfo.symbol} on ${chain}. You can manually set up lending after vault creation using factor_add_adapter and factor_add_vault_token.`;
      }
    }
  }

  const workflow = [
    '1. Review the template below and customize name/symbol if desired',
    '2. Call factor_give_approval with the approvalStep params to approve the token for the factory',
    '3. Call factor_create_vault with the createVaultParams',
    '4. Use factor_get_transaction_status to check the deployment result',
    ...(template.postDeploySteps ? ['5. Follow the postDeploySteps for any post-deploy configuration'] : []),
    '',
    'SIMULATION (no funds): If the wallet has no funds, skip step 2 and call factor_create_vault directly. It will return an INSUFFICIENT_ALLOWANCE error with a simulationHint containing a scriptRef. Pass that scriptRef to factor_run_forge_script to simulate the full deployment on a forked network.',
  ];

  return {
    success: true,
    mode: 'guided_template',
    chain,
    environment,
    factoryAddress,
    template,
    workflow,
  };
}

export const vaultTemplatesTool = {
  name: 'factor_vault_templates',
  description: 'ALWAYS call this with NO parameters first when creating a vault. Returns a guided questionnaire with vault types and available tokens fetched live from the chain. You MUST present the questions to the user, collect their answers, then call this tool again with vaultType, strategyTokens, and depositWithdrawTokens to get the final template. Do NOT skip the questionnaire even if the user mentions a specific protocol or token — always let them see the options and confirm. The only exception is if you are resuming a previous flow where the user already answered the questions.',
  inputSchema: {
    type: 'object',
    properties: {
      denominator: {
        type: 'string',
        description: 'DIRECT MODE: Filter by denominator token. If not provided, returns all available templates for the current chain.',
        enum: ['USDC', 'USDC.e', 'USDbC', 'USDT', 'WETH'],
      },
      lendingProtocol: {
        type: 'string',
        enum: ['aave', 'compoundV3', 'morpho'],
        description: 'DIRECT MODE: Set this when the task involves lending or supplying. Each protocol has different token designs read from the tokenlist.',
      },
      vaultType: {
        type: 'string',
        enum: ['index_fund', 'lending', 'general'],
        description: 'GUIDED MODE: Type of vault to create. If not provided (and no denominator), returns a guided questionnaire with available options.',
      },
      strategyTokens: {
        type: 'array',
        items: { type: 'string' },
        description: 'GUIDED MODE: Token addresses needed for the vault strategy (from questionnaire step 2).',
      },
      depositWithdrawTokens: {
        type: 'array',
        items: { type: 'string' },
        description: 'GUIDED MODE: Token addresses users can deposit/withdraw (from questionnaire step 3). Must be a subset of strategyTokens.',
      },
    },
    required: [],
  },
  handler: async (input: {
    denominator?: string;
    lendingProtocol?: LendingProtocol;
    vaultType?: VaultType;
    strategyTokens?: string[];
    depositWithdrawTokens?: string[];
  }) => {
    const chain = configManager.getConfig().chain;
    const chainId = getChainIdEnum(chain);
    const environment = configManager.getEnvironment();

    // ──────────────────────────────────────────────────────────────────────
    // GUIDED MODE: Questionnaire (no vaultType AND no denominator)
    // ──────────────────────────────────────────────────────────────────────
    if (!input.vaultType && !input.denominator && !input.lendingProtocol) {
      try {
        const availableTokens = await getAvailableTokens(chainId, environment);

        return {
          success: true,
          mode: 'questionnaire',
          chain,
          questions: [
            {
              id: 'vaultType',
              question: 'What kind of vault are you creating?',
              options: [
                { value: 'index_fund', label: 'Index Fund', description: 'Multi-asset vault that holds and rebalances a portfolio of tokens' },
                { value: 'lending', label: 'Lending Vault', description: 'Vault that supplies assets to lending protocols (Aave, Compound, Morpho)' },
                { value: 'general', label: 'General', description: 'Flexible vault for custom strategies' },
              ],
            },
            {
              id: 'strategyTokens',
              question: 'Which tokens are needed for your strategy?',
              description: 'Select the tokens your vault will interact with',
              availableTokens,
              multiSelect: true,
            },
            {
              id: 'depositWithdrawTokens',
              question: 'What tokens can users deposit & withdraw from your vault?',
              description: 'Select from the strategy tokens above. These will be the vault\'s deposit/withdraw assets.',
              note: 'Must be a subset of the strategy tokens selected above',
              multiSelect: true,
            },
          ],
          instructions: 'Present these questions to the user one at a time. After collecting all answers, call factor_vault_templates again with vaultType, strategyTokens, and depositWithdrawTokens.',
        };
      } catch (err: any) {
        return {
          success: false,
          error: 'QUESTIONNAIRE_FETCH_ERROR',
          message: `Could not fetch available tokens for ${chain}: ${err?.message || 'unknown error'}. You can still use direct mode by passing denominator.`,
        };
      }
    }

    // ──────────────────────────────────────────────────────────────────────
    // GUIDED MODE: Template from answers (vaultType + strategyTokens + depositWithdrawTokens)
    // ──────────────────────────────────────────────────────────────────────
    if (input.vaultType && input.strategyTokens && input.depositWithdrawTokens) {
      return await buildGuidedTemplate(input.vaultType, input.strategyTokens, input.depositWithdrawTokens, chain, chainId, environment);
    }

    // ──────────────────────────────────────────────────────────────────────
    // DIRECT MODE: Existing denominator + lendingProtocol flow
    // ──────────────────────────────────────────────────────────────────────

    const tokens = TOKEN_ADDRESSES[chain];
    if (!tokens) {
      return {
        success: false,
        error: 'UNSUPPORTED_CHAIN',
        message: `No templates available for chain ${chain}`,
      };
    }

    // Get contract addresses for current chain
    let contractAddresses: any;
    try {
      contractAddresses = getContractAddressesForChainOrThrow(chainId, environment);
    } catch {
      return {
        success: false,
        error: 'SDK_ERROR',
        message: `Could not load contract addresses for ${chain} (${environment})`,
      };
    }

    const factoryAddress = contractAddresses.factor_studio_pro_factory as string;
    const adapterManagementAddress = contractAddresses.factor_adapter_management_adapter_pro as string;
    const assetDebtAddress = contractAddresses.factor_asset_debt_adapter_pro as string;

    if (!factoryAddress) {
      return {
        success: false,
        error: 'NO_FACTORY',
        message: `No factory address found for ${chain}. Vault creation may not be available on this chain.`,
      };
    }

    // If lending protocol requested, fetch factory active addresses and tokenlist once
    let factoryActiveAddresses: FactoryActiveAddresses | null = null;
    let tokenlist: FactorTokenlist | null = null;

    if (input.lendingProtocol) {
      try {
        const proVaultStats = new StudioProVaultStats({ chainId, environment });
        factoryActiveAddresses = await proVaultStats.getFactoryActiveAddresses() as FactoryActiveAddresses;
      } catch {
        return {
          success: false,
          error: 'FACTORY_FETCH_ERROR',
          message: `Could not fetch factory active addresses for ${chain} (${environment}). Lending template unavailable.`,
        };
      }

      try {
        const tokenlistChainId = getTokenlistChainId(chain);
        tokenlist = new FactorTokenlist(tokenlistChainId);
      } catch {
        return {
          success: false,
          error: 'TOKENLIST_ERROR',
          message: `Could not load tokenlist for ${chain}. Lending template unavailable.`,
        };
      }
    }

    // Build templates
    const templates: Array<Record<string, any>> = [];

    const filteredTokens = input.denominator
      ? Object.entries(tokens).filter(([key]) => key === input.denominator)
      : Object.entries(tokens);

    for (const [tokenKey, tokenInfo] of filteredTokens) {
      // Find denominator accounting from factory (if available)
      const denominatorAccounting = factoryActiveAddresses
        ? findAccounting(factoryActiveAddresses, tokenInfo.address, 'assets')
        : null;

      const template: Record<string, any> = {
        name: `${tokenInfo.symbol} Vault on ${chain}`,
        denominator: {
          symbol: tokenInfo.symbol,
          address: tokenInfo.address,
          decimals: tokenInfo.decimals,
        },
        createVaultParams: {
          name: `My ${tokenInfo.symbol} Vault`,
          symbol: `f${tokenInfo.symbol}`,
          assetDenominatorAddress: tokenInfo.address,
          initialDepositAmount: '1600',
          depositFee: 0,
          withdrawFee: 0,
          managementFee: 0,
          performanceFee: 0,
        },
        approvalStep: {
          tool: 'factor_give_approval',
          params: {
            tokenAddress: tokenInfo.address,
            spenderAddress: factoryAddress,
            amount: 'max',
          },
        },
      };

      // Enrich with lending protocol config if requested
      if (input.lendingProtocol && tokenlist && factoryActiveAddresses) {
        let lendingConfig: any = null;

        switch (input.lendingProtocol) {
          case 'aave':
            lendingConfig = buildAaveLendingConfig(
              contractAddresses, tokenlist, factoryActiveAddresses,
              tokenInfo.address, tokenInfo.symbol, denominatorAccounting,
            );
            break;
          case 'compoundV3':
            lendingConfig = buildCompoundV3LendingConfig(
              contractAddresses, tokenlist, factoryActiveAddresses,
              tokenInfo.address, tokenInfo.symbol, denominatorAccounting,
            );
            break;
          case 'morpho':
            lendingConfig = buildMorphoLendingConfig(
              contractAddresses, tokenlist, factoryActiveAddresses,
              tokenInfo.address, tokenInfo.symbol, denominatorAccounting,
            );
            break;
        }

        if (lendingConfig) {
          // Merge lending adapter(s) into createVaultParams
          template.createVaultParams = {
            ...template.createVaultParams,
            ...lendingConfig.createVaultExtensions,
          };
          template.name = `${tokenInfo.symbol} ${input.lendingProtocol === 'compoundV3' ? 'Compound V3' : input.lendingProtocol.charAt(0).toUpperCase() + input.lendingProtocol.slice(1)} Vault on ${chain}`;

          // Add lending-specific metadata
          template.lending = {
            protocol: lendingConfig.protocol,
            ...(lendingConfig.lendingTokens && { tokens: lendingConfig.lendingTokens }),
            ...(lendingConfig.protocolAdapter && { adapter: lendingConfig.protocolAdapter }),
            ...(lendingConfig.protocolAdapters && { adapters: lendingConfig.protocolAdapters }),
            ...(lendingConfig.availableMarkets && { availableMarkets: lendingConfig.availableMarkets }),
            ...(lendingConfig.note && { note: lendingConfig.note }),
          };
          template.postDeploySteps = lendingConfig.postDeploySteps;
        } else {
          template.lendingNote = `No ${input.lendingProtocol} lending available for ${tokenInfo.symbol} on ${chain}`;
        }
      }

      templates.push(template);
    }

    // Build workflow instructions
    const workflow = input.lendingProtocol
      ? [
          '1. Pick a template from the list above',
          '2. Call factor_give_approval with the approvalStep params to approve the token for the factory',
          '3. Call factor_create_vault with the createVaultParams (vault deploys with lending adapter + tokens pre-configured)',
          '4. Use factor_get_transaction_status to check the deployment result',
          ...(input.lendingProtocol === 'compoundV3'
            ? ['5. Call factor_execute_manager with the registerMarket step from postDeploySteps (REQUIRED before supply)']
            : input.lendingProtocol === 'morpho'
            ? ['5. Let the user choose a market from lending.availableMarkets', '6. Call factor_execute_manager with addMarketToAssetAndDebt for the chosen marketId (REQUIRED before supply)']
            : []),
          `${input.lendingProtocol === 'morpho' ? '7' : input.lendingProtocol === 'compoundV3' ? '6' : '5'}. Call factor_deposit to add funds to the vault`,
          `${input.lendingProtocol === 'morpho' ? '8' : input.lendingProtocol === 'compoundV3' ? '7' : '6'}. Call factor_lend_supply to supply to ${input.lendingProtocol === 'compoundV3' ? 'Compound V3' : input.lendingProtocol}`,
          '',
          'SIMULATION (no funds): If the wallet has no funds, skip step 2 and call factor_create_vault directly. It will return an INSUFFICIENT_ALLOWANCE error with a simulationHint containing a scriptRef. Pass that scriptRef to factor_run_forge_script to simulate the full deployment on a forked network.',
        ]
      : [
          '1. Pick a template from the list above',
          '2. Call factor_give_approval with the approvalStep params to approve the token for the factory',
          '3. Call factor_create_vault with the createVaultParams (customize name/symbol as needed)',
          '4. Use factor_get_transaction_status to check the deployment result',
          '',
          'SIMULATION (no funds): If the wallet has no funds, skip step 2 and call factor_create_vault directly. It will return an INSUFFICIENT_ALLOWANCE error with a simulationHint containing a scriptRef. Pass that scriptRef to factor_run_forge_script to simulate the full deployment (fund wallet + approve + deploy) on a forked network.',
        ];

    const note = input.lendingProtocol
      ? `Templates include the ${input.lendingProtocol} adapter, lending tokens, and accounting addresses baked into createVaultParams. The vault deploys fully ready for lending. AdapterManagement + AssetDebt adapters are auto-added by factor_create_vault.`
      : 'These are BASIC templates (no lending). If the task involves lending/supplying, call this tool again with lendingProtocol set: "aave" (adds aToken + debtToken), "compoundV3" (adds cToken market + registration step), or "morpho" (adds collateral/loan tokens + market selection). Each protocol has its own token design — the template reads the correct tokens from the tokenlist automatically.';

    return {
      success: true,
      chain,
      environment,
      factoryAddress,
      ...(input.lendingProtocol && { lendingProtocol: input.lendingProtocol }),
      adapters: {
        adapterManagement: adapterManagementAddress || null,
        assetDebt: assetDebtAddress || null,
      },
      templates,
      workflow,
      note,
    };
  },
};
