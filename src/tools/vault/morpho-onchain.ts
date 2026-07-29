import { createPublicClient, formatUnits, http, parseAbi } from 'viem';
import { arbitrum, base, mainnet, optimism } from 'viem/chains';

/** CREATE2 Morpho Blue singleton (Base / Eth / Arb / Op). RHC uses era-2 deploy. */
const MORPHO_BLUE_CREATE2 = '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb';
const MORPHO_BLUE_ROBINHOOD = '0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010';

function morphoBlueAddress(chainId: number): `0x${string}` {
  return (chainId === 4663 ? MORPHO_BLUE_ROBINHOOD : MORPHO_BLUE_CREATE2) as `0x${string}`;
}

const MORPHO_MARKET_ID_RE = /0x[a-fA-F0-9]{64}/;
const MORPHO_ABI = parseAbi([
  'function position(bytes32 id, address user) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)',
  'function market(bytes32 id) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)',
  'function idToMarketParams(bytes32 id) view returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)',
]);

const robinhood = {
  id: 4663,
  name: 'Robinhood Chain',
  network: 'robinhood',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.mainnet.chain.robinhood.com'] },
    public: { http: ['https://rpc.mainnet.chain.robinhood.com'] },
  },
} as const;

function morphoClient(chainId: number, alchemyApiKey: string) {
  const cfg = (() => {
    switch (chainId) {
      case 1:
        return { chain: mainnet, host: 'eth-mainnet' };
      case 8453:
        return { chain: base, host: 'base-mainnet' };
      case 42161:
        return { chain: arbitrum, host: 'arb-mainnet' };
      case 10:
        return { chain: optimism, host: 'opt-mainnet' };
      case 4663:
        return { chain: robinhood, host: 'robinhood-mainnet' };
      default:
        return null;
    }
  })();
  if (!cfg) return null;
  return createPublicClient({
    chain: cfg.chain as any,
    transport: http(`https://${cfg.host}.g.alchemy.com/v2/${alchemyApiKey}`),
  });
}

export function shareAssets(shares: bigint, totalAssets: bigint, totalShares: bigint): bigint {
  if (shares === 0n || totalShares === 0n) return 0n;
  return (shares * totalAssets) / totalShares;
}

function updateDepositAmount(token: any, rawBalance: bigint) {
  const previousBalance = Number(token.balance_fmt || 0);
  const previousValue = Number(token.value_usd || 0);
  const unitPrice =
    previousBalance > 0 && previousValue > 0 ? previousValue / previousBalance : 1;
  const balanceFmt = Number(formatUnits(rawBalance, token.metadata.decimals));

  token.balance = rawBalance;
  token.balance_fmt = balanceFmt;
  token.value_usd = balanceFmt * unitPrice;
}

export async function reconcileMorphoDepositsWithChain(
  deposits: Record<string, any>,
  vaultAddress: `0x${string}`,
  chainId: number,
  alchemyApiKey: string,
) {
  const client = morphoClient(chainId, alchemyApiKey);
  if (!client) return deposits;

  const marketIds = Array.from(
    new Set(
      Object.entries(deposits)
        .filter(([, token]) => token.protocol === 'morpho')
        .map(
          ([address]) =>
            address.match(MORPHO_MARKET_ID_RE)?.[0] as `0x${string}` | undefined,
        )
        .filter((marketId): marketId is `0x${string}` => Boolean(marketId)),
    ),
  );
  if (marketIds.length === 0) return deposits;

  const byMarket = new Map<
    string,
    {
      loanToken: string;
      collateralToken: string;
      supplyAssets: bigint;
      borrowAssets: bigint;
      collateral: bigint;
    }
  >();

  await Promise.all(
    marketIds.map(async (marketId) => {
      try {
        const morpho = morphoBlueAddress(chainId);
        const [position, market, params] = await Promise.all([
          client.readContract({
            address: morpho,
            abi: MORPHO_ABI,
            functionName: 'position',
            args: [marketId, vaultAddress],
          }) as Promise<readonly [bigint, bigint, bigint]>,
          client.readContract({
            address: morpho,
            abi: MORPHO_ABI,
            functionName: 'market',
            args: [marketId],
          }) as Promise<
            readonly [bigint, bigint, bigint, bigint, bigint, bigint]
          >,
          client.readContract({
            address: morpho,
            abi: MORPHO_ABI,
            functionName: 'idToMarketParams',
            args: [marketId],
          }) as Promise<
            readonly [
              `0x${string}`,
              `0x${string}`,
              `0x${string}`,
              `0x${string}`,
              bigint,
            ]
          >,
        ]);

        byMarket.set(marketId.toLowerCase(), {
          loanToken: params[0].toLowerCase(),
          collateralToken: params[1].toLowerCase(),
          supplyAssets: shareAssets(position[0], market[0], market[1]),
          borrowAssets: shareAssets(position[1], market[2], market[3]),
          collateral: position[2],
        });
      } catch {
        // Fall back to the Morpho API values for this market if RPC reads fail.
      }
    }),
  );

  for (const [address, token] of Object.entries(deposits)) {
    if (token.protocol !== 'morpho') continue;

    const marketId = address.match(MORPHO_MARKET_ID_RE)?.[0]?.toLowerCase();
    const market = marketId ? byMarket.get(marketId) : undefined;
    if (!market) continue;

    const tokenAddress = token.metadata.address.toLowerCase();
    if (
      (token.type === 'credit' || token.type === 'supply') &&
      tokenAddress === market.loanToken
    ) {
      updateDepositAmount(token, market.supplyAssets);
    } else if (
      (token.type === 'credit' || token.type === 'supply') &&
      tokenAddress === market.collateralToken
    ) {
      updateDepositAmount(token, market.collateral);
    } else if (token.type === 'debt' && tokenAddress === market.loanToken) {
      updateDepositAmount(token, market.borrowAssets);
    }
  }

  return deposits;
}
