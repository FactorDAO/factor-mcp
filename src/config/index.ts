import { SupportedChainName, getChain, getAlchemyRpcUrl, DEFAULT_CHAIN } from './chains.js';
import { loadEnvironment, EnvironmentConfig, updateJsonConfig, loadJsonConfig, getConfigPath } from './environment.js';
import type { Chain } from 'viem';

export interface ServerConfig {
  chain: SupportedChainName;
  rpcUrl: string;
  simulationMode: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  walletName: string | null;
}

class ConfigManager {
  private config: ServerConfig;
  private env: EnvironmentConfig;

  constructor() {
    this.env = loadEnvironment();
    this.config = {
      chain: this.env.defaultChain,
      rpcUrl: this.resolveRpcUrl(this.env.defaultChain),
      simulationMode: this.env.simulationMode,
      logLevel: this.env.logLevel,
      walletName: this.env.activeWallet || null,
    };
  }

  private resolveRpcUrl(chain: SupportedChainName): string {
    if (this.env.customRpcUrl) {
      return this.env.customRpcUrl;
    }

    if (this.env.alchemyApiKey) {
      return getAlchemyRpcUrl(chain, this.env.alchemyApiKey);
    }

    // Fallback to default public RPC
    return getChain(chain).rpcUrls.default.http[0];
  }

  getConfig(): Readonly<ServerConfig> {
    return { ...this.config };
  }

  getFullConfig(): { runtime: ServerConfig; file: ReturnType<typeof loadJsonConfig>; path: string } {
    return {
      runtime: this.getConfig(),
      file: loadJsonConfig(),
      path: getConfigPath(),
    };
  }

  getChain(): Chain {
    return getChain(this.config.chain);
  }

  getChainId(): number {
    return this.getChain().id;
  }

  getRpcUrl(): string {
    return this.config.rpcUrl;
  }

  isSimulationMode(): boolean {
    return this.config.simulationMode;
  }

  getWalletPassword(): string | undefined {
    return this.env.walletPassword;
  }

  setChain(chain: SupportedChainName, persist: boolean = true): void {
    this.config.chain = chain;
    // Update RPC URL unless custom URL is set
    if (!this.env.customRpcUrl) {
      this.config.rpcUrl = this.resolveRpcUrl(chain);
    }
    if (persist) {
      updateJsonConfig({ defaultChain: chain });
    }
  }

  setRpcUrl(url: string, persist: boolean = true): void {
    this.config.rpcUrl = url;
    if (persist) {
      updateJsonConfig({ customRpcUrl: url });
    }
  }

  setSimulationMode(enabled: boolean, persist: boolean = true): void {
    this.config.simulationMode = enabled;
    if (persist) {
      updateJsonConfig({ simulationMode: enabled });
    }
  }

  setWalletName(name: string | null, persist: boolean = true): void {
    this.config.walletName = name;
    if (persist) {
      updateJsonConfig({ activeWallet: name || undefined });
    }
  }

  getWalletName(): string | null {
    return this.config.walletName;
  }

  getEnvironment(): 'production' | 'staging' | 'testing' {
    return this.env.environment;
  }

  // EIP-7702 gas sponsorship
  getGasSponsorUrl(): string | undefined {
    return this.env.gasSponsorUrl;
  }

  getAgentToken(): string | undefined {
    return this.env.agentToken;
  }

  getErc7821DelegateAddress(): string | undefined {
    return this.env.erc7821DelegateAddress;
  }

  isGasSponsorshipEnabled(): boolean {
    return Boolean(this.env.gasSponsorUrl && this.env.erc7821DelegateAddress);
  }

  getModelName(): string {
    return loadJsonConfig().modelName || 'AI';
  }

  setModelName(name: string, persist: boolean = true): void {
    if (persist) {
      updateJsonConfig({ modelName: name });
    }
  }

  setAlchemyApiKey(apiKey: string): void {
    this.env.alchemyApiKey = apiKey;
    updateJsonConfig({ alchemyApiKey: apiKey });
    // Update RPC URL with new API key
    this.config.rpcUrl = this.resolveRpcUrl(this.config.chain);
  }
}

// Singleton instance
export const configManager = new ConfigManager();

export * from './chains.js';
export * from './environment.js';
