/**
 * Chain config tests — Robinhood Chain (4663)
 *
 * Run: pnpm vitest tests/chains.test.ts
 */
import { describe, it, expect } from 'vitest';
import {
  SUPPORTED_CHAINS,
  getChain,
  getChainByChainId,
  getChainId,
  getChainNameByChainId,
  getAlchemyRpcUrl,
  isValidChainName,
} from '../src/config/chains.js';
import { configManager } from '../src/config/index.js';

describe('Robinhood Chain (4663) config', () => {
  it('registers ROBINHOOD in supported chains', () => {
    expect(isValidChainName('ROBINHOOD')).toBe(true);
    expect(getChainId('ROBINHOOD')).toBe(4663);
    expect(getChain('ROBINHOOD').id).toBe(4663);
    expect(SUPPORTED_CHAINS.ROBINHOOD.rpcUrls.default.http[0]).toBe(
      'https://rpc.mainnet.chain.robinhood.com',
    );
  });

  it('resolves chain id/name round-trip', () => {
    expect(getChainNameByChainId(4663)).toBe('ROBINHOOD');
    expect(getChainByChainId(4663).id).toBe(4663);
  });

  it('builds Alchemy RPC URL for ROBINHOOD', () => {
    expect(getAlchemyRpcUrl('ROBINHOOD', 'test-key')).toBe(
      'https://robinhood-mainnet.g.alchemy.com/v2/test-key',
    );
  });

  it('stateless mode resolves chain context for chainId 4663', async () => {
    await configManager.runWithContext({ chainId: 4663, environment: 'production' }, () => {
      expect(configManager.getChainId()).toBe(4663);
      expect(configManager.getConfig().chain).toBe('ROBINHOOD');
      expect(configManager.getRpcUrl()).toBe(configManager.getConfig().rpcUrl);
    });
  });

  it('vault analytics accepts ROBINHOOD chain context', async () => {
    const { vaultAnalyticsTool } = await import('../src/tools/vault/vault-analytics.js');
    expect(vaultAnalyticsTool.name).toBe('factor_vault_analytics');
    await expect(
      configManager.runWithContext({ chainId: 4663, environment: 'production' }, async () => {
        await vaultAnalyticsTool.handler({ vaultAddress: 'not-an-address' });
      }),
    ).rejects.toThrow(/Invalid vault address/);
  });
});
