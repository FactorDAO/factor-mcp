import { AsyncLocalStorage } from 'node:async_hooks';
import { SupportedChainName, getChain, getAlchemyRpcUrl, getChainByChainId, DEFAULT_CHAIN } from './chains.js';
import { loadEnvironment, EnvironmentConfig, updateJsonConfig, loadJsonConfig, getConfigPath } from './environment.js';
import type { Chain } from 'viem';

export interface ServerConfig {
  chain: SupportedChainName;
  rpcUrl: string;
  simulationMode: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  walletName: string | null;
}

/** Per-request context for stateless mode. */
export interface RequestContext {
  chainId?: number;
  environment?: 'production' | 'staging' | 'testing';
}

const requestContext = new AsyncLocalStorage<RequestContext>();

class ConfigManager {
  private config: ServerConfig;
  private env: EnvironmentConfig;
  private _stateless: boolean = false;

  constructor() {
    this.env = loadEnvironment();
    this.config = {
      chain: this.env.defaultChain,
      rpcUrl: this.resolveRpcUrl(this.env.defaultChain),
      simulationMode: this.env.simulationMode,
      logLevel: this.env.logLevel,
      walletName: this.env.activeWallet || null,
    };
    // Auto-enable stateless mode from env var
    if (process.env.STATELESS_MODE === 'true') {
      this._stateless = true;
    }
  }

  /** Enable stateless mode. All getters require per-request context (chainId, environment). */
  enableStatelessMode(): void {
    this._stateless = true;
  }

  isStateless(): boolean {
    return this._stateless;
  }

  /**
   * Run a function with per-request context.
   * In stateless mode, getChainId() and getEnvironment() read from this context.
   */
  runWithContext<T>(ctx: RequestContext, fn: () => T | Promise<T>): T | Promise<T> {
    return requestContext.run(ctx, fn);
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
    const ctx = requestContext.getStore();
    if (ctx?.chainId) {
      const chain = getChainByChainId(ctx.chainId);
      const chainName = (chain.id === 42161 ? 'ARBITRUM_ONE' : chain.id === 8453 ? 'BASE' : 'MAINNET') as SupportedChainName;
      return {
        ...this.config,
        chain: chainName,
        rpcUrl: this.resolveRpcUrl(chainName),
      };
    }
    return { ...this.config };
  }

  getFullConfig(): { runtime: ServerConfig; file: ReturnType<typeof loadJsonConfig>; path: string; stateless: boolean } {
    return {
      runtime: this.getConfig(),
      file: loadJsonConfig(),
      path: getConfigPath(),
      stateless: this._stateless,
    };
  }

  getChain(): Chain {
    // In stateless mode, read from request context
    const ctx = requestContext.getStore();
    if (ctx?.chainId) {
      return getChainByChainId(ctx.chainId);
    }
    if (this._stateless) {
      throw new Error('Stateless mode: chainId is required in every tool call. Pass chainId as a parameter.');
    }
    return getChain(this.config.chain);
  }

  getChainId(): number {
    const ctx = requestContext.getStore();
    if (ctx?.chainId) return ctx.chainId;
    if (this._stateless) {
      throw new Error('Stateless mode: chainId is required in every tool call. Pass chainId as a parameter.');
    }
    return getChain(this.config.chain).id;
  }

  getRpcUrl(): string {
    // In stateless mode, resolve RPC from request context chain
    const ctx = requestContext.getStore();
    if (ctx?.chainId) {
      const chain = getChainByChainId(ctx.chainId);
      const chainName = chain.name === 'Arbitrum One' ? 'ARBITRUM_ONE' : chain.name === 'Base' ? 'BASE' : 'MAINNET';
      return this.resolveRpcUrl(chainName as SupportedChainName);
    }
    if (this._stateless) {
      throw new Error('Stateless mode: chainId is required to resolve RPC URL.');
    }
    return this.config.rpcUrl;
  }

  isSimulationMode(): boolean {
    // In stateless mode, always return true (calldata only, no signing)
    if (this._stateless) return true;
    return this.config.simulationMode;
  }

  getWalletPassword(): string | undefined {
    return this.env.walletPassword;
  }

  setChain(chain: SupportedChainName, persist: boolean = true): void {
    if (this._stateless) {
      throw new Error('Stateless mode: cannot mutate global chain. Pass chainId per-request.');
    }
    this.config.chain = chain;
    if (!this.env.customRpcUrl) {
      this.config.rpcUrl = this.resolveRpcUrl(chain);
    }
    if (persist) {
      updateJsonConfig({ defaultChain: chain });
    }
  }

  setRpcUrl(url: string, persist: boolean = true): void {
    if (this._stateless) {
      throw new Error('Stateless mode: cannot mutate global RPC URL.');
    }
    this.config.rpcUrl = url;
    if (persist) {
      updateJsonConfig({ customRpcUrl: url });
    }
  }

  setSimulationMode(enabled: boolean, persist: boolean = true): void {
    if (this._stateless) return; // no-op in stateless
    this.config.simulationMode = enabled;
    if (persist) {
      updateJsonConfig({ simulationMode: enabled });
    }
  }

  setWalletName(name: string | null, persist: boolean = true): void {
    if (this._stateless) return; // no wallet in stateless
    this.config.walletName = name;
    if (persist) {
      updateJsonConfig({ activeWallet: name || undefined });
    }
  }

  getWalletName(): string | null {
    if (this._stateless) return '__stateless__';
    return this.config.walletName;
  }

  getEnvironment(): 'production' | 'staging' | 'testing' {
    const ctx = requestContext.getStore();
    if (ctx?.environment) return ctx.environment;
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
    this.config.rpcUrl = this.resolveRpcUrl(this.config.chain);
  }
}

// Singleton instance
export const configManager = new ConfigManager();

export * from './chains.js';
export * from './environment.js';
