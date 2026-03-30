/**
 * EIP-7702 authorization signing for gas sponsorship.
 * Works with viem v1 — hand-rolls the authorization hash + signature
 * since `signAuthorization` is only available in viem v2.
 *
 * EIP-7702 allows an EOA to delegate its code to a contract (e.g. ERC-7821
 * BatchCallDelegation). A sponsor (treasury) then submits a Type 4 tx
 * with the authorization, paying gas on behalf of the EOA.
 */
import { keccak256, toHex, concatHex, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getPublicClient } from './signer.js';

/** Signed EIP-7702 authorization object (matches viem v2 AuthorizationList format). */
export interface SignedAuthorization {
  chainId: number;
  contractAddress: string;
  nonce: number;
  r: Hex;
  s: Hex;
  v: number;
  /** The EOA that signed this authorization. */
  address: string;
}

/** RLP-encode a list of items (simplified — only handles bytes and small ints). */
function rlpEncode(items: Hex[]): Hex {
  const encoded: Hex[] = [];

  for (const item of items) {
    const bytes = hexToBytes(item);
    if (bytes.length === 1 && bytes[0] < 0x80) {
      // Single byte, no length prefix
      encoded.push(item);
    } else if (bytes.length <= 55) {
      // Short string: 0x80 + length prefix
      encoded.push(concatHex([toHex(0x80 + bytes.length, { size: 1 }), item]));
    } else {
      // Long string
      const lenBytes = toMinimalHex(bytes.length);
      const lenLen = hexToBytes(lenBytes).length;
      encoded.push(concatHex([toHex(0xb7 + lenLen, { size: 1 }), lenBytes, item]));
    }
  }

  const payload = concatHex(encoded);
  const payloadBytes = hexToBytes(payload);

  if (payloadBytes.length <= 55) {
    return concatHex([toHex(0xc0 + payloadBytes.length, { size: 1 }), payload]);
  }

  const lenBytes = toMinimalHex(payloadBytes.length);
  const lenLen = hexToBytes(lenBytes).length;
  return concatHex([toHex(0xf7 + lenLen, { size: 1 }), lenBytes, payload]);
}

function hexToBytes(hex: Hex): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length === 0) return new Uint8Array(0);
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return bytes;
}

function toMinimalHex(n: number): Hex {
  if (n === 0) return '0x00' as Hex;
  let hex = n.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  return `0x${hex}` as Hex;
}

/**
 * Compute the EIP-7702 authorization hash:
 *   keccak256(0x05 || rlp([chain_id, address, nonce]))
 */
export function hashAuthorization(params: {
  chainId: number;
  contractAddress: string;
  nonce: number;
}): Hex {
  const chainIdHex = params.chainId === 0 ? '0x' as Hex : toMinimalHex(params.chainId);
  const addressHex = params.contractAddress.toLowerCase() as Hex;
  const nonceHex = params.nonce === 0 ? '0x' as Hex : toMinimalHex(params.nonce);

  const rlpEncoded = rlpEncode([chainIdHex, addressHex, nonceHex]);
  return keccak256(concatHex(['0x05', rlpEncoded]));
}

/**
 * Sign an EIP-7702 authorization.
 * The agent's private key signs the authorization to delegate to `contractAddress`.
 */
export async function signAuthorization(params: {
  chainId: number;
  contractAddress: string;
  nonce: number;
  privateKey: Hex;
}): Promise<SignedAuthorization> {
  const hash = hashAuthorization({
    chainId: params.chainId,
    contractAddress: params.contractAddress,
    nonce: params.nonce,
  });

  const account = privateKeyToAccount(params.privateKey);
  // Use viem's account.signMessage with raw hash
  const signature = await account.signMessage({ message: { raw: hexToBytes(hash) } });

  // Parse r, s, v from the 65-byte signature
  const r = `0x${signature.slice(2, 66)}` as Hex;
  const s = `0x${signature.slice(66, 130)}` as Hex;
  const v = parseInt(signature.slice(130, 132), 16);

  return {
    chainId: params.chainId,
    contractAddress: params.contractAddress,
    nonce: params.nonce,
    r,
    s,
    v,
    address: account.address,
  };
}

/**
 * Build a signed EIP-7702 authorization for the current agent wallet.
 * Fetches the agent EOA's current nonce from the chain.
 */
export async function buildAgentAuthorization(
  privateKey: Hex,
  chainId: number,
  delegateAddress: string,
): Promise<SignedAuthorization> {
  const account = privateKeyToAccount(privateKey);
  const publicClient = getPublicClient();

  const nonce = await publicClient.getTransactionCount({
    address: account.address,
  });

  return signAuthorization({
    chainId,
    contractAddress: delegateAddress,
    nonce,
    privateKey,
  });
}
