import { formatUnits, type Address } from 'viem';

/**
 * Format a raw wei/base-unit value to a human-readable string.
 * Returns undefined if the input is invalid or missing.
 */
export function formatWei(value: string | bigint | undefined | null, decimals: number = 18): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  try {
    const bn = typeof value === 'bigint' ? value : BigInt(value);
    return formatUnits(bn, decimals);
  } catch {
    return undefined;
  }
}

/**
 * Format basis points to a human-readable percentage string.
 * e.g. "100" → "1.00%", "10000" → "100.00%", "50" → "0.50%"
 */
export function formatBps(bps: string | bigint | undefined | null): string | undefined {
  if (bps === undefined || bps === null || bps === '') return undefined;
  try {
    const num = Number(bps);
    if (isNaN(num)) return undefined;
    return `${(num / 100).toFixed(2)}%`;
  } catch {
    return undefined;
  }
}

/**
 * Read the decimals of an ERC20 token. Defaults to 18 on failure.
 */
export async function getTokenDecimals(publicClient: any, tokenAddress: Address): Promise<number> {
  try {
    const decimals = await publicClient.readContract({
      address: tokenAddress,
      abi: [{ name: 'decimals', type: 'function', inputs: [], outputs: [{ name: '', type: 'uint8' }], stateMutability: 'view' }],
      functionName: 'decimals',
    });
    return Number(decimals);
  } catch {
    return 18;
  }
}

/**
 * Read the symbol of an ERC20 token. Returns 'UNKNOWN' on failure.
 */
export async function getTokenSymbol(publicClient: any, tokenAddress: Address): Promise<string> {
  try {
    return await publicClient.readContract({
      address: tokenAddress,
      abi: [{ name: 'symbol', type: 'function', inputs: [], outputs: [{ name: '', type: 'string' }], stateMutability: 'view' }],
      functionName: 'symbol',
    });
  } catch {
    return 'UNKNOWN';
  }
}
