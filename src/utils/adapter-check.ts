import { type Address } from 'viem';
import { getPublicClient } from '../wallet/signer.js';

const IS_MANAGER_ADAPTER_ABI = [
  {
    name: 'isManagerAdapter',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'adapter', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

export async function checkAdapterRegistered(
  vaultAddress: Address,
  adapterAddress: Address,
  adapterName: string,
): Promise<void> {
  const publicClient = getPublicClient();
  const isRegistered = await publicClient.readContract({
    address: vaultAddress,
    abi: IS_MANAGER_ADAPTER_ABI,
    functionName: 'isManagerAdapter',
    args: [adapterAddress],
  });

  if (!isRegistered) {
    throw new AdapterNotRegisteredError(adapterAddress, adapterName, vaultAddress);
  }
}

export class AdapterNotRegisteredError extends Error {
  constructor(
    public adapterAddress: string,
    public adapterName: string,
    public vaultAddress: string,
  ) {
    super(
      `${adapterName} adapter (${adapterAddress}) is NOT registered in vault ${vaultAddress}. ` +
      `Call factor_add_adapter with vaultAddress and adapterAddress "${adapterAddress}" first, then sign_and_send to execute.`,
    );
    this.name = 'AdapterNotRegisteredError';
  }
}
