import {
  createWalletClient,
  createPublicClient,
  http,
  type WalletClient,
  type PublicClient,
  type Account,
  type Chain,
  type Hash,
  type TransactionRequest,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getPrivateKey, getWalletAddress } from './key-manager.js';
import { configManager } from '../config/index.js';
import { TransactionError, WalletError, InsufficientBalanceError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { buildAgentAuthorization } from './eip7702.js';

export interface TransactionParams {
  to: `0x${string}`;
  data?: `0x${string}`;
  value?: bigint;
  gas?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
}

export interface TransactionResult {
  hash: Hash;
  from: string;
  to: string;
  value: string;
  simulationMode: boolean;
}

export interface GasEstimate {
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  totalCostWei: bigint;
  totalCostEth: string;
}

let cachedWalletClient: WalletClient | null = null;
let cachedPublicClient: PublicClient | null = null;
let cachedChainId: number | null = null;
let cachedWalletName: string | null = null;

export function getPublicClient(): PublicClient {
  const currentChainId = configManager.getChainId();

  if (cachedPublicClient && cachedChainId === currentChainId) {
    return cachedPublicClient;
  }

  cachedPublicClient = createPublicClient({
    chain: configManager.getChain(),
    transport: http(configManager.getRpcUrl()),
  });
  cachedChainId = currentChainId;

  return cachedPublicClient;
}

export function getWalletClient(walletName: string, password?: string): WalletClient {
  const currentChainId = configManager.getChainId();

  // Return cached client if same wallet and chain
  if (
    cachedWalletClient &&
    cachedChainId === currentChainId &&
    cachedWalletName === walletName
  ) {
    return cachedWalletClient;
  }

  const privateKey = getPrivateKey(walletName, password);
  const account = privateKeyToAccount(privateKey as `0x${string}`);

  cachedWalletClient = createWalletClient({
    account,
    chain: configManager.getChain(),
    transport: http(configManager.getRpcUrl()),
  });
  cachedChainId = currentChainId;
  cachedWalletName = walletName;

  return cachedWalletClient;
}

export function clearCachedClients(): void {
  cachedWalletClient = null;
  cachedPublicClient = null;
  cachedChainId = null;
  cachedWalletName = null;
}

export async function estimateGas(params: TransactionParams): Promise<GasEstimate> {
  const publicClient = getPublicClient();
  const walletName = configManager.getWalletName();

  if (!walletName) {
    throw new WalletError('No wallet configured - use factor_wallet_setup first');
  }

  const from = getWalletAddress(walletName) as `0x${string}`;

  try {
    const [gasLimit, feeData] = await Promise.all([
      publicClient.estimateGas({
        account: from,
        to: params.to,
        data: params.data,
        value: params.value,
      }),
      publicClient.estimateFeesPerGas(),
    ]);

    const maxFeePerGas = feeData.maxFeePerGas ?? 0n;
    const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? 0n;
    const totalCostWei = gasLimit * maxFeePerGas;
    const totalCostEth = (Number(totalCostWei) / 1e18).toFixed(8);

    return {
      gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas,
      totalCostWei,
      totalCostEth,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isInsufficientBalance =
      errorMessage.includes('insufficient funds for gas') ||
      errorMessage.includes('insufficient balance') ||
      errorMessage.includes('exceeds the balance') ||
      errorMessage.includes('sender doesn\'t have enough funds');

    if (isInsufficientBalance) {
      throw new InsufficientBalanceError(
        `Insufficient balance to estimate gas. Use factor_run_forge_script to simulate this operation on a forked network — write a Solidity script that uses vm.deal() for ETH and deal(token,to,amount) for ERC20 balances. Or use factor_simulate_transaction with balanceOverrides for simpler ETH-only overrides.`,
        {
          tool: 'factor_simulate_transaction',
          params: {
            to: params.to,
            data: params.data,
            value: params.value?.toString(),
            balanceOverrides: [
              {
                address: from,
                ethBalance: '10000000000000000000',
              },
            ],
          },
          forgeScriptAlternative: 'For operations that need ERC20 token balances, use factor_run_forge_script instead. Write a Solidity script that extends Test from "forge-std/Test.sol" and use deal(tokenAddress, msg.sender, amount) for ERC20 balances and vm.deal(msg.sender, 10 ether) for ETH.',
        },
        error
      );
    }

    throw new TransactionError('Failed to estimate gas', error);
  }
}

export async function sendTransaction(
  params: TransactionParams,
  password?: string
): Promise<TransactionResult> {
  const walletName = configManager.getWalletName();

  if (!walletName) {
    throw new WalletError('No wallet configured - use factor_wallet_setup first');
  }

  // EIP-7702 gas sponsorship: relay through the Kairos BE treasury
  if (configManager.isGasSponsorshipEnabled()) {
    return sendSponsoredTransaction(params, walletName, password);
  }

  const walletClient = getWalletClient(walletName, password);
  const account = walletClient.account;

  if (!account) {
    throw new WalletError('Wallet client has no account');
  }

  // Check simulation mode
  if (configManager.isSimulationMode()) {
    logger.info('Simulation mode - transaction not broadcast');
    return {
      hash: '0x0000000000000000000000000000000000000000000000000000000000000000' as Hash,
      from: account.address,
      to: params.to,
      value: (params.value ?? 0n).toString(),
      simulationMode: true,
    };
  }

  try {
    // Estimate gas if not provided
    let gasParams = {};
    if (!params.gas || !params.maxFeePerGas) {
      const estimate = await estimateGas(params);
      gasParams = {
        gas: params.gas ?? estimate.gasLimit,
        maxFeePerGas: params.maxFeePerGas ?? estimate.maxFeePerGas,
        maxPriorityFeePerGas: params.maxPriorityFeePerGas ?? estimate.maxPriorityFeePerGas,
      };
    }

    const hash = await walletClient.sendTransaction({
      account,
      to: params.to,
      data: params.data,
      value: params.value,
      chain: configManager.getChain(),
      ...gasParams,
    });

    logger.info(`Transaction sent: ${hash}`);

    return {
      hash,
      from: account.address,
      to: params.to,
      value: (params.value ?? 0n).toString(),
      simulationMode: false,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isInsufficientBalance =
      errorMessage.includes('insufficient funds for gas') ||
      errorMessage.includes('insufficient balance') ||
      errorMessage.includes('exceeds the balance') ||
      errorMessage.includes('sender doesn\'t have enough funds');

    if (isInsufficientBalance) {
      throw new InsufficientBalanceError(
        `Insufficient balance to send transaction. Use factor_run_forge_script to simulate this operation on a forked network — write a Solidity script that uses vm.deal() for ETH and deal(token,to,amount) for ERC20 balances. Or use factor_simulate_transaction with balanceOverrides for simpler ETH-only overrides.`,
        {
          tool: 'factor_simulate_transaction',
          params: {
            to: params.to,
            data: params.data,
            value: params.value?.toString(),
            balanceOverrides: [
              {
                address: account.address,
                ethBalance: '10000000000000000000',
              },
            ],
          },
          forgeScriptAlternative: 'For operations that need ERC20 token balances, use factor_run_forge_script instead. Write a Solidity script that extends Test from "forge-std/Test.sol" and use deal(tokenAddress, msg.sender, amount) for ERC20 balances and vm.deal(msg.sender, 10 ether) for ETH.',
        },
        error
      );
    }

    throw new TransactionError('Failed to send transaction', error);
  }
}

/**
 * EIP-7702 sponsored transaction: sign an authorization delegating the agent
 * EOA to the ERC-7821 contract, then POST to the Kairos BE relay endpoint.
 * The treasury wallet submits the Type 4 tx and pays gas.
 */
async function sendSponsoredTransaction(
  params: TransactionParams,
  walletName: string,
  password?: string,
): Promise<TransactionResult> {
  const sponsorUrl = configManager.getGasSponsorUrl()!;
  const agentToken = configManager.getAgentToken();
  const delegateAddress = configManager.getErc7821DelegateAddress()!;
  const chainId = configManager.getChainId();
  const from = getWalletAddress(walletName) as `0x${string}`;

  // Simulation mode check
  if (configManager.isSimulationMode()) {
    logger.info('Simulation mode (sponsored) - transaction not relayed');
    return {
      hash: '0x0000000000000000000000000000000000000000000000000000000000000000' as Hash,
      from,
      to: params.to,
      value: (params.value ?? 0n).toString(),
      simulationMode: true,
    };
  }

  // Get agent private key and sign EIP-7702 authorization
  const privateKey = getPrivateKey(walletName, password) as `0x${string}`;
  const authorization = await buildAgentAuthorization(privateKey, chainId, delegateAddress);

  logger.info(`Relaying sponsored tx to ${params.to} via ${sponsorUrl}`);

  const body = {
    to: params.to,
    data: params.data || '0x',
    value: (params.value ?? 0n).toString(),
    authorization: {
      chainId: authorization.chainId,
      contractAddress: authorization.contractAddress,
      nonce: authorization.nonce,
      r: authorization.r,
      s: authorization.s,
      v: authorization.v,
    },
    chain: configManager.getConfig().chain,
  };

  const res = await fetch(sponsorUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(agentToken ? { Authorization: `Bearer ${agentToken}` } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    let errorMsg = text;
    try {
      const json = JSON.parse(text) as { error?: string };
      if (json.error) errorMsg = json.error;
    } catch { /* keep raw text */ }
    throw new TransactionError(`Relay failed (${res.status}): ${errorMsg}`);
  }

  const { hash } = (await res.json()) as { hash: string };
  logger.info(`Sponsored transaction relayed: ${hash}`);

  return {
    hash: hash as Hash,
    from,
    to: params.to,
    value: (params.value ?? 0n).toString(),
    simulationMode: false,
  };
}

export async function signMessage(message: string, password?: string): Promise<string> {
  const walletName = configManager.getWalletName();

  if (!walletName) {
    throw new WalletError('No wallet configured - use factor_wallet_setup first');
  }

  const walletClient = getWalletClient(walletName, password);
  const account = walletClient.account;

  if (!account) {
    throw new WalletError('Wallet client has no account');
  }

  const signature = await walletClient.signMessage({
    account,
    message,
  });

  return signature;
}

export async function getTransactionStatus(hash: Hash): Promise<{
  status: 'pending' | 'success' | 'failed';
  blockNumber?: bigint;
  gasUsed?: bigint;
  effectiveGasPrice?: bigint;
}> {
  const publicClient = getPublicClient();

  try {
    const receipt = await publicClient.getTransactionReceipt({ hash });

    return {
      status: receipt.status === 'success' ? 'success' : 'failed',
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
      effectiveGasPrice: receipt.effectiveGasPrice,
    };
  } catch (error) {
    // Transaction not mined yet
    const tx = await publicClient.getTransaction({ hash }).catch(() => null);

    if (tx) {
      return { status: 'pending' };
    }

    throw new TransactionError('Transaction not found', { hash });
  }
}
