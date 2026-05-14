/**
 * HLVault factory — builds a `HLVault` instance from the factor-mcp
 * config/wallet layer. Used by every HL tool to bridge between the
 * local SDK adapter (`src/sdk/hl/`) and the MCP server's stateful
 * config/key-manager.
 *
 * Why local: `@factordao/sdk-studio` on npm (v2.1.20) does NOT yet export
 * the HL module. The local source lives at `src/sdk/hl/` as a temporary
 * adapter; once the SDK is republished this whole module can be replaced
 * with `import { hl } from '@factordao/sdk-studio'`.
 */
import {
  createPublicClient,
  defineChain,
  http,
  type Address,
  type Chain,
  type LocalAccount,
  type PublicClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { configManager } from '../../config/index.js';
import { getPrivateKey } from '../../wallet/key-manager.js';
import { WalletError, VaultError } from '../../utils/errors.js';
import { HLVault, HLVaultMetrics } from '../../sdk/hl/index.js';

/**
 * HyperEVM mainnet (chain 999). Defined locally because the shared
 * `chains.ts` module is intentionally limited to {Arbitrum, Base,
 * Mainnet} — adding HYPEREVM there would force a `SupportedChainName`
 * widening that ripples through every non-HL tool. Keeping the chain
 * definition local to the HL factory keeps the surface area minimal.
 */
const HYPEREVM_CHAIN: Chain = defineChain({
  id: 999,
  name: 'HyperEVM',
  network: 'hyperevm',
  nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.hyperliquid.xyz/evm'] },
    public: { http: ['https://rpc.hyperliquid.xyz/evm'] },
  },
});

/** Build a publicClient targeting HyperEVM (chain 999). */
function buildHlPublicClient(): PublicClient {
  // The shared chains module doesn't know about HYPEREVM, so we fall
  // back to the canonical Hyperliquid RPC when `getRpcUrl()` would return
  // a non-HyperEVM URL. If a custom RPC has been set and clearly targets
  // HyperEVM (port 999 etc.), we let it through.
  let rpcUrl: string;
  try {
    rpcUrl = configManager.getRpcUrl();
  } catch {
    rpcUrl = HYPEREVM_CHAIN.rpcUrls.default.http[0];
  }
  // If the configured URL clearly isn't for HyperEVM, override with the
  // chain's canonical mainnet endpoint to avoid silent cross-chain calls.
  if (!rpcUrl || /alchemy\.com|arbitrum|base-mainnet|eth-mainnet/i.test(rpcUrl)) {
    rpcUrl = HYPEREVM_CHAIN.rpcUrls.default.http[0];
  }
  return createPublicClient({
    chain: HYPEREVM_CHAIN,
    transport: http(rpcUrl),
  });
}

/**
 * Build an `HLVault` instance bound to the requested vault address,
 * using the configured wallet as the `managerSigner` (and reused as the
 * `agentSigner` by default — same trust subset as the SDK's design).
 *
 * Read-only tools should pass `requireSigner = false` to avoid forcing
 * a wallet (and decryption) just to read NAV / positions.
 */
export function buildHlVault(
  vaultAddress: Address,
  opts: { password?: string; requireSigner?: boolean } = {},
): HLVault {
  const { password, requireSigner = true } = opts;
  const client = buildHlPublicClient();

  let managerSigner: LocalAccount;
  if (requireSigner) {
    const walletName = configManager.getWalletName();
    if (!walletName) {
      throw new WalletError('No wallet configured. Use factor_wallet_setup first.');
    }
    const pk = getPrivateKey(walletName, password) as `0x${string}`;
    // `privateKeyToAccount` returns `PrivateKeyAccount` (source: 'privateKey').
    // The SDK declares `LocalAccount` (source: 'custom') because some viem
    // versions narrowed the type. Cast — runtime methods (signMessage /
    // signTypedData) are identical across both shapes.
    managerSigner = privateKeyToAccount(pk) as unknown as LocalAccount;
  } else {
    // Read-only path — the SDK requires *a* LocalAccount for typing, but
    // never invokes it for read methods. Pick a deterministic zero key
    // so we don't surface a useless wallet error on `getNav`/`getPositions`.
    managerSigner = privateKeyToAccount(
      '0x0000000000000000000000000000000000000000000000000000000000000001',
    ) as unknown as LocalAccount;
  }

  if (!vaultAddress || !vaultAddress.startsWith('0x')) {
    throw new VaultError(`Invalid vault address: ${vaultAddress}`);
  }

  return HLVault.create(vaultAddress, {
    client,
    managerSigner,
  });
}

/**
 * Build a read-only `HLVaultMetrics` instance bound to the requested
 * vault. Always uses `requireSigner: false` — the metrics surface is
 * pure-read and we don't want analytics tools to force a wallet prompt.
 *
 * Returns both the metrics class and the shared `publicClient` so callers
 * can reuse it for additional on-chain reads (avoids a second HTTP
 * connection per request).
 */
export function buildHlVaultMetrics(vaultAddress: Address): {
  metrics: HLVaultMetrics;
  vault: HLVault;
  client: PublicClient;
} {
  const client = buildHlPublicClient();
  const vault = buildHlVault(vaultAddress, { requireSigner: false });
  const metrics = HLVaultMetrics.create(vault, { client });
  return { metrics, vault, client };
}
