import { z } from 'zod';
import { isAddress } from 'viem';
import { configManager } from '../../config/index.js';
import { VaultError, SdkError } from '../../utils/errors.js';
import { redactSecrets } from '../../utils/redact-secrets.js';
import { FactorVaultAnalytics } from '@factordao/vault-analytics';
import { ChainId as TokenlistChainId } from '@factordao/tokenlist';
import { reconcileMorphoDepositsWithChain } from './morpho-onchain.js';

export const vaultAnalyticsSchema = z.object({
  vaultAddress: z.string(),
});

export type VaultAnalyticsInput = z.infer<typeof vaultAnalyticsSchema>;

const CHAIN_MAP: Record<string, number> = {
  ARBITRUM_ONE: TokenlistChainId.ARBITRUM_ONE,
  BASE: TokenlistChainId.BASE,
  MAINNET: TokenlistChainId.ETHEREUM,
  OPTIMISM: TokenlistChainId.OPTIMISM,
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export const vaultAnalyticsTool = {
  name: 'factor_vault_analytics',
  description: 'Get detailed vault position breakdown with per-token balances, USD values, APY/APR by protocol (Aave, Compound, Morpho, Pendle, idle tokens), aggregate stats (weighted APY, TVL breakdown, net return), and — when the vault has lending positions — a `lending` block with per-protocol health metrics: Aave V3 account-level healthFactor + USD totals + LT/LTV; Compound V3 per-market healthFactor + isLiquidatable + collateral breakdown; Morpho per-market healthFactor + collateral/borrow USD. Reads directly from on-chain — always up to date. SAFETY: when leveraging, never enter if any healthFactor < 2.0; deleverage if any healthFactor < 1.3.',
  inputSchema: {
    type: 'object',
    properties: {
      vaultAddress: {
        type: 'string',
        description: 'The vault contract address',
      },
    },
    required: ['vaultAddress'],
  },
  handler: async (input: VaultAnalyticsInput) => {
    const validated = vaultAnalyticsSchema.parse(input);

    if (!isAddress(validated.vaultAddress)) {
      throw new VaultError('Invalid vault address');
    }

    const vaultAddress = validated.vaultAddress as `0x${string}`;
    const chain = configManager.getConfig().chain;
    const chainId = CHAIN_MAP[chain];
    if (!chainId) throw new VaultError(`Unsupported chain for analytics: ${chain}`);

    const alchemyApiKey = process.env.ALCHEMY_API_KEY;
    if (!alchemyApiKey) throw new VaultError('ALCHEMY_API_KEY required for vault analytics');

    try {
      const analytics = new FactorVaultAnalytics(chainId, alchemyApiKey);

      // Retry-on-empty guard: under concurrent load @factordao/vault-analytics
      // occasionally returns an empty deposits object (one of its internal
      // parallel eth_call/eth_getLogs requests times out silently against the
      // Alchemy RPC instead of throwing). The handler would then format
      // positions=[]/tvl=0/stats all zero as a "successful" response and the
      // client treats a live vault as empty. Re-run the fetch once with a
      // small backoff when deposits is unexpectedly empty — a legitimately
      // empty vault is rare in the fleet and costs at most ~200ms extra on
      // that edge case, while the bug is frequent under parallel load.
      let deposits: Awaited<ReturnType<typeof analytics.getVaultDeposits>> = {} as any;
      let tvlUsd = 0;
      for (let attempt = 0; attempt < 2; attempt++) {
        [deposits, tvlUsd] = await Promise.all([
          analytics.getVaultDeposits(vaultAddress),
          analytics.getVaultTVL(vaultAddress, configManager.getEnvironment() as any).catch(() => 0),
        ]);
        const isEmpty = !deposits || Object.keys(deposits).length === 0;
        if (!isEmpty) break;
        if (attempt === 0) await new Promise(r => setTimeout(r, 200));
      }

      deposits = await reconcileMorphoDepositsWithChain(
        deposits,
        vaultAddress,
        chainId,
        alchemyApiKey,
      );

      const stats = await analytics.calculateVaultStats(deposits, tvlUsd);

      const positions = Object.entries(deposits)
        // Drop registry entries the vault knows about but holds nothing of —
        // the AssetDebt registry can carry phantom addresses (zero balance,
        // unknown symbol/protocol/type) that bloat the response without
        // adding signal. A position is considered real if it has any USD
        // value, any non-zero balance, or a known protocol/type.
        .filter(([, token]) => {
          const hasValue = Math.abs(Number(token.value_usd || 0)) > 0;
          const hasBalance = Number(token.balance_fmt || 0) !== 0;
          const known =
            token.type !== 'unknown' || token.protocol !== 'unknown';
          return hasValue || hasBalance || known;
        })
        .map(([address, token]) => ({
          address,
          symbol: token.metadata.symbol,
          name: token.metadata.name,
          type: token.type,
          protocol: token.protocol,
          balance: token.balance_fmt,
          valueUsd: round2(token.value_usd),
          apy: round2(token.apy),
          apr: round2(token.apr),
          underlying: token.metadata.underlying,
        }));

      const typeOrder: Record<string, number> = { credit: 0, supply: 1, idle: 2, unknown: 3, debt: 4 };
      positions.sort((a, b) => (typeOrder[a.type] ?? 3) - (typeOrder[b.type] ?? 3));

      // ── Lending health block ──────────────────────────────────────────────
      // Detects which protocols the vault has exposure to from `deposits`,
      // then issues the health-data RPCs in parallel. Each protocol fetch
      // is independent and fails open: an Aave RPC error doesn't kill
      // Compound/Morpho data and vice versa. Aave returns null + a flag
      // when chain unsupported or RPC fails; Compound/Morpho return [].
      const hasAavePosition    = positions.some(p => p.protocol === 'aave');
      const hasCompoundPosition = positions.some(p => p.protocol === 'compound');
      const hasMorphoPosition   = positions.some(p => p.protocol === 'morpho');

      const [aaveHealth, compoundHealth, morphoPositions] = await Promise.all([
        hasAavePosition
          ? analytics.getAaveAccountHealth(vaultAddress).catch(() => null)
          : Promise.resolve(null),
        hasCompoundPosition
          ? analytics.getCompoundAccountHealth(vaultAddress).catch(() => [])
          : Promise.resolve([]),
        hasMorphoPosition
          ? analytics.getMorphoPositions(vaultAddress).catch(() => [])
          : Promise.resolve([]),
      ]);

      // Flatten Morpho — `getMorphoPositions` returns one MorphoPosition per
      // address, each carrying multiple `marketPositions`. The vault is one
      // address, so we just collect every market the vault has any exposure
      // in (collateral or borrow).
      const morphoMarkets = morphoPositions
        .flatMap(p => p.marketPositions)
        .filter(m => m.collateral > 0 || m.borrowAssets > 0)
        .map(m => ({
          id: m.id,
          // Keep HF at full precision — it's the load-bearing number for the
          // agent's safety threshold (HF < 2.0 = no enter, HF < 1.3 =
          // deleverage). Rounding to 2 decimals would hide the difference
          // between e.g. 1.295 and 1.305 right at the deleverage boundary.
          healthFactor: Number.isFinite(m.healthFactor) ? m.healthFactor : null,
          collateralUsd: round2(m.collateralUsd),
          borrowUsd: round2(m.borrowAssetsUsd),
          supplyUsd: round2(m.supplyAssetsUsd),
          loanAsset: {
            address: m.market.loanAsset.address,
            symbol: m.market.loanAsset.symbol,
          },
          collateralAsset: {
            address: m.market.collateralAsset.address,
            symbol: m.market.collateralAsset.symbol,
          },
        }));

      // Cross-protocol totals are derived straight from `deposits` so we get
      // them for free even on protocols whose health endpoint failed.
      let totalSupplyUsd = 0;
      let totalDebtUsd = 0;
      for (const p of positions) {
        if (p.type === 'credit' || p.type === 'supply') totalSupplyUsd += p.valueUsd;
        else if (p.type === 'debt') totalDebtUsd += p.valueUsd;
      }

      const hasAnyLending = hasAavePosition || hasCompoundPosition || hasMorphoPosition;
      const lending = hasAnyLending
        ? {
            totals: {
              totalSupplyUsd: round2(totalSupplyUsd),
              totalDebtUsd: round2(totalDebtUsd),
            },
            aave: aaveHealth
              ? {
                  healthFactor: aaveHealth.healthFactor,
                  totalCollateralUsd: round2(aaveHealth.totalCollateralUsd),
                  totalDebtUsd: round2(aaveHealth.totalDebtUsd),
                  availableBorrowsUsd: round2(aaveHealth.availableBorrowsUsd),
                  liquidationThresholdPct: round2(aaveHealth.liquidationThresholdPct),
                  ltvPct: round2(aaveHealth.ltvPct),
                }
              : null,
            compound: compoundHealth.length
              ? compoundHealth.map(m => ({
                  marketAddress: m.marketAddress,
                  marketSymbol: m.marketSymbol,
                  // HF kept at full precision (see Morpho block above).
                  healthFactor: m.healthFactor,
                  isLiquidatable: m.isLiquidatable,
                  totalCollateralUsd: round2(m.totalCollateralUsd),
                  totalDebtUsd: round2(m.totalDebtUsd),
                  collateralBreakdown: m.collateralBreakdown.map(c => ({
                    symbol: c.symbol,
                    address: c.address,
                    balance: c.balance,
                    valueUsd: round2(c.valueUsd),
                    liquidationFactorPct: round2(c.liquidationFactorPct),
                  })),
                }))
              : null,
            morpho: morphoMarkets.length ? morphoMarkets : null,
          }
        : null;

      return {
        success: true,
        vaultAddress,
        chain,
        tvlUsd: round2(tvlUsd),
        positions,
        stats: {
          totalIdleUsd: round2(stats.total_idle_usd),
          totalCreditUsd: round2(stats.total_credit_usd),
          totalDebtUsd: round2(stats.total_debt_usd),
          weightedApyCredit: round2(stats.weighted_apy_credit),
          weightedApyDebt: round2(stats.weighted_apy_debt),
          netReturn: round2(stats.net_return),
          calculatedApy: round2(stats.calculated_apy),
        },
        // `lending` is omitted entirely when the vault has no lending exposure
        // so the response stays minimal for trader/idle vaults.
        ...(lending ? { lending } : {}),
        positionCount: positions.length,
      };
    } catch (error) {
      if (error instanceof VaultError) throw error;
      // MND-1036: unlike `throw new SdkError('safe text', error)` elsewhere
      // (where the FactorMcpError constructor sanitizes `error` as
      // `details`), this interpolates the raw error text directly into the
      // *message* itself — that bypasses the details-only sanitization, so
      // redact here explicitly.
      const details = redactSecrets(error instanceof Error ? error.message : String(error));
      throw new SdkError(`Failed to get vault analytics: ${details}`, error);
    }
  },
};
