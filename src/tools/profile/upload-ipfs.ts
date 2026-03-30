import { z } from 'zod';
import { readFileSync } from 'fs';
import { basename } from 'path';
import { configManager } from '../../config/index.js';
import { getWalletAddress } from '../../wallet/key-manager.js';
import { signMessage } from '../../wallet/signer.js';
import { WalletError, SdkError } from '../../utils/errors.js';
import { getStatsApiBaseUrl } from '../../utils/stats-api.js';

export const uploadIpfsSchema = z.object({
  filePath: z.string().optional(),
  base64: z.string().optional(),
  fileName: z.string().optional(),
  mimeType: z.string().optional(),
  password: z.string().optional(),
});

export type UploadIpfsInput = z.infer<typeof uploadIpfsSchema>;

export const uploadIpfsTool = {
  name: 'factor_upload_ipfs',
  description: 'Upload a file to IPFS via the Factor Stats API. Use this to upload profile images and vault logos. Provide either a filePath (local file) or base64-encoded content. Returns an IPFS hash that can be used in factor_save_profile (image field) or factor_save_vault_metadata (logoCID field).',
  inputSchema: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: 'Path to the local file to upload (e.g., "/path/to/image.png")',
      },
      base64: {
        type: 'string',
        description: 'Base64-encoded file content. Use this when you have the file content directly instead of a file path.',
      },
      fileName: {
        type: 'string',
        description: 'File name (required when using base64, optional for filePath — defaults to the file basename)',
      },
      mimeType: {
        type: 'string',
        description: 'MIME type of the file (e.g., "image/png", "image/jpeg"). Auto-detected from extension if not provided.',
      },
      password: {
        type: 'string',
        description: 'Wallet password if the wallet is encrypted',
      },
    },
  },
  handler: async (input: UploadIpfsInput) => {
    const validated = uploadIpfsSchema.parse(input);

    if (!validated.filePath && !validated.base64) {
      throw new SdkError('Either filePath or base64 must be provided');
    }

    const walletName = configManager.getWalletName();
    if (!walletName) {
      throw new WalletError('No wallet configured. Use factor_wallet_setup first.');
    }

    const address = getWalletAddress(walletName);

    let fileBuffer: Buffer;
    let fileName: string;

    if (validated.filePath) {
      try {
        fileBuffer = readFileSync(validated.filePath);
      } catch (err) {
        throw new SdkError(`Failed to read file: ${validated.filePath}`, err);
      }
      fileName = validated.fileName || basename(validated.filePath);
    } else {
      fileBuffer = Buffer.from(validated.base64!, 'base64');
      fileName = validated.fileName || 'upload';
    }

    // Detect MIME type from extension
    const ext = fileName.split('.').pop()?.toLowerCase();
    const mimeMap: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      svg: 'image/svg+xml',
      webp: 'image/webp',
    };
    const mimeType = validated.mimeType || mimeMap[ext || ''] || 'application/octet-stream';

    // Sign the upload message (same format as the UI)
    const message = `Upload \`${fileName}\` on IPFS for ${address.toLowerCase()}`;
    const signature = await signMessage(message, validated.password);

    try {
      const baseUrl = getStatsApiBaseUrl();
      const blob = new Blob([fileBuffer], { type: mimeType });

      const formData = new FormData();
      formData.append('file', blob, fileName);
      formData.append('name', fileName);
      formData.append('signature', signature);
      formData.append('address', address.toLowerCase());

      const response = await fetch(`${baseUrl}/ipfs/upload`, {
        method: 'POST',
        headers: {
          'Origin': 'http://localhost:3000',
        },
        body: formData,
      });

      const data: any = await response.json();

      if (!response.ok || data.error) {
        throw new SdkError(data.message || `IPFS upload error: ${response.status}`, data);
      }

      return {
        success: true,
        ipfsHash: data.ipfs_hash,
        fileName,
        address,
        note: `File uploaded to IPFS. Use the ipfs_hash "${data.ipfs_hash}" as the image field in factor_save_profile or logoCID in factor_save_vault_metadata.`,
      };
    } catch (error) {
      if (error instanceof WalletError || error instanceof SdkError) {
        throw error;
      }
      throw new SdkError('Failed to upload file to IPFS', error);
    }
  },
};
