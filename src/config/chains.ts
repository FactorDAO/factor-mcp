import { arbitrum, base, mainnet } from 'viem/chains';
import type { Chain } from 'viem';

export const SUPPORTED_CHAINS: Record<string, Chain> = {
  ARBITRUM_ONE: arbitrum,
  BASE: base,
  MAINNET: mainnet,
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

export function getAlchemyRpcUrl(chainName: SupportedChainName, apiKey: string): string {
  const alchemyNetworks: Record<string, string> = {
    ARBITRUM_ONE: 'arb-mainnet',
    BASE: 'base-mainnet',
    MAINNET: 'eth-mainnet',
  };

  const network = alchemyNetworks[chainName];
  if (!network) {
    // Return default RPC for chains without Alchemy support
    return SUPPORTED_CHAINS[chainName].rpcUrls.default.http[0];
  }

  return `https://${network}.g.alchemy.com/v2/${apiKey}`;
}
