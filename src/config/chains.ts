import { arbitrum, base, mainnet } from 'viem/chains';
import { defineChain, type Chain } from 'viem';

// viem does not ship a HyperEVM definition yet, so we define it locally.
// Chain id 999 + the canonical Hyperliquid public RPC; Alchemy also
// hosts HL at `hyperliquid-mainnet.g.alchemy.com/v2/<KEY>`, used below.
const hyperEvm: Chain = defineChain({
  id: 999,
  name: 'HyperEVM',
  network: 'hyperevm',
  nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.hyperliquid.xyz/evm'] },
    public: { http: ['https://rpc.hyperliquid.xyz/evm'] },
  },
});

export const SUPPORTED_CHAINS: Record<string, Chain> = {
  ARBITRUM_ONE: arbitrum,
  BASE: base,
  MAINNET: mainnet,
  HYPEREVM: hyperEvm,
};

export type SupportedChainName = keyof typeof SUPPORTED_CHAINS;

export const DEFAULT_CHAIN: SupportedChainName = 'ARBITRUM_ONE';

export function getChain(chainName: SupportedChainName): Chain {
  return SUPPORTED_CHAINS[chainName];
}

export function getChainId(chainName: SupportedChainName): number {
  return SUPPORTED_CHAINS[chainName].id;
}

export function isValidChainName(name: string): name is SupportedChainName {
  return name in SUPPORTED_CHAINS;
}

const CHAIN_ID_MAP: Record<number, SupportedChainName> = {
  42161: 'ARBITRUM_ONE',
  8453: 'BASE',
  1: 'MAINNET',
  999: 'HYPEREVM',
};

export function getChainByChainId(chainId: number): Chain {
  const name = CHAIN_ID_MAP[chainId];
  if (!name) throw new Error(`Unsupported chainId: ${chainId}. Supported: ${Object.keys(CHAIN_ID_MAP).join(', ')}`);
  return SUPPORTED_CHAINS[name];
}

export function getChainNameByChainId(chainId: number): SupportedChainName {
  const name = CHAIN_ID_MAP[chainId];
  if (!name) throw new Error(`Unsupported chainId: ${chainId}`);
  return name;
}

export function getAlchemyRpcUrl(chainName: SupportedChainName, apiKey: string): string {
  const alchemyNetworks: Record<string, string> = {
    ARBITRUM_ONE: 'arb-mainnet',
    BASE: 'base-mainnet',
    MAINNET: 'eth-mainnet',
    HYPEREVM: 'hyperliquid-mainnet',
  };

  const network = alchemyNetworks[chainName];
  if (!network) {
    // Return default RPC for chains without Alchemy support
    return SUPPORTED_CHAINS[chainName].rpcUrls.default.http[0];
  }

  return `https://${network}.g.alchemy.com/v2/${apiKey}`;
}
