import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { SupportedChainName, isValidChainName, DEFAULT_CHAIN } from './chains.js';

const CONFIG_DIR = join(homedir(), '.factor-mcp');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

export type FactorEnvironment = 'production' | 'staging' | 'testing';

export interface JsonConfig {
  alchemyApiKey?: string;
  defaultChain: SupportedChainName;
  simulationMode: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  customRpcUrl?: string;
  activeWallet?: string;
  environment?: FactorEnvironment;
}

export interface EnvironmentConfig {
  alchemyApiKey: string | undefined;
  defaultChain: SupportedChainName;
  simulationMode: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  customRpcUrl: string | undefined;
  walletPassword: string | undefined;
  activeWallet: string | undefined;
  environment: FactorEnvironment;
}

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

function getDefaultConfig(): JsonConfig {
  return {
    defaultChain: DEFAULT_CHAIN,
    simulationMode: false,
    logLevel: 'info',
  };
}

export function loadJsonConfig(): JsonConfig {
  ensureConfigDir();

  if (!existsSync(CONFIG_FILE)) {
    const defaultConfig = getDefaultConfig();
    saveJsonConfig(defaultConfig);
    return defaultConfig;
  }

  try {
    const content = readFileSync(CONFIG_FILE, 'utf8');
    const config = JSON.parse(content) as Partial<JsonConfig>;

    // Merge with defaults
    return {
      ...getDefaultConfig(),
      ...config,
      // Validate chain
      defaultChain: config.defaultChain && isValidChainName(config.defaultChain)
        ? config.defaultChain
        : DEFAULT_CHAIN,
    };
  } catch {
    return getDefaultConfig();
  }
}

export function saveJsonConfig(config: JsonConfig): void {
  ensureConfigDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

export function updateJsonConfig(updates: Partial<JsonConfig>): JsonConfig {
  const current = loadJsonConfig();
  const updated = { ...current, ...updates };
  saveJsonConfig(updated);
  return updated;
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}

export function loadEnvironment(): EnvironmentConfig {
  const jsonConfig = loadJsonConfig();

  // Environment variables can override JSON config
  const alchemyApiKey = process.env.ALCHEMY_API_KEY || jsonConfig.alchemyApiKey;
  const customRpcUrl = process.env.RPC_URL || jsonConfig.customRpcUrl;
  const walletPassword = process.env.WALLET_PASSWORD;

  const defaultChainEnv = process.env.DEFAULT_CHAIN;
  let defaultChain = jsonConfig.defaultChain;
  if (defaultChainEnv && isValidChainName(defaultChainEnv)) {
    defaultChain = defaultChainEnv;
  }

  const logLevelEnv = process.env.LOG_LEVEL;
  const validLogLevels = ['debug', 'info', 'warn', 'error'] as const;
  const logLevel = validLogLevels.includes(logLevelEnv as any)
    ? (logLevelEnv as 'debug' | 'info' | 'warn' | 'error')
    : jsonConfig.logLevel;

  const simulationMode = process.env.SIMULATION_MODE !== undefined
    ? process.env.SIMULATION_MODE === 'true'
    : jsonConfig.simulationMode;

  const environmentEnv = process.env.FACTOR_ENVIRONMENT;
  const validEnvironments = ['production', 'staging', 'testing'] as const;
  const environment = validEnvironments.includes(environmentEnv as any)
    ? (environmentEnv as FactorEnvironment)
    : (jsonConfig.environment || 'testing');

  return {
    alchemyApiKey,
    defaultChain,
    simulationMode,
    logLevel,
    customRpcUrl,
    walletPassword,
    activeWallet: jsonConfig.activeWallet,
    environment,
  };
}
