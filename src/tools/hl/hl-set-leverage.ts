import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { VaultError, SdkError } from '../../utils/errors.js';
import { HYPEREVM_CHAIN_ID, assertHyperEvmChain, type OffChainHlResult } from './common.js';
import { buildHlVault } from './hl-vault-factory.js';
import { configManager } from '../../config/index.js';

const modeEnum = z.enum(['cross', 'isolated']);

export const hlSetLeverageSchema = z.object({
  vault: z.string(),
  perp: z.string().min(1),
  leverage: z.number().int().min(1).max(50),
  // Default to `cross` margin so the LLM doesn't have to pass it. HL's
  // `updateLeverage` action takes a margin mode bit (`isCross`) on every
  // call; missing the field used to ZodError out the tool silently,
  // leaving the agent's leverage at the vault default (20×).
  mode: modeEnum.optional().default('cross'),
  password: z.string().optional(),
});

export type HlSetLeverageInput = z.infer<typeof hlSetLeverageSchema>;

export const hlSetLeverageTool = {
  name: 'factor_hl_set_leverage',
  description:
    'Set leverage and margin mode (cross/isolated) for a HL perp via an off-chain EIP-712 action signed by the vault agent. HyperEVM (chain 999) only. Returns submitted=true (no on-chain tx).',
  inputSchema: {
    type: 'object',
    properties: {
      vault: { type: 'string', description: 'Vault contract address.' },
      perp: { type: 'string', description: 'Perp symbol, e.g. "ETH".' },
      leverage: { type: 'number', description: 'Integer leverage in [1, 50].' },
      mode: {
        type: 'string',
        enum: ['cross', 'isolated'],
        description: 'Margin mode.',
      },
      password: { type: 'string', description: 'Wallet password if encrypted.' },
    },
    required: ['vault', 'perp', 'leverage', 'mode'],
  },
  handler: async (input: HlSetLeverageInput) => {
    const validated = hlSetLeverageSchema.parse(input);
    if (!isAddress(validated.vault)) throw new VaultError('Invalid vault address');
    assertHyperEvmChain();

    const stateless = configManager.isStateless();
    const isCross = validated.mode === 'cross';

    try {
      // Stateless mode: build the L1 action with NO signer, return the
      // unsigned envelope. agent-executor routes it via signing-service
      // `/sign-hl-exchange`, same as the open/close stateless paths.
      if (stateless) {
        const hlVault = buildHlVault(validated.vault as Address, {
          password: validated.password,
          requireSigner: false,
        });
        const built = await hlVault.buildSetLeverageOffChainAction({
          perp: validated.perp,
          leverage: validated.leverage,
          isCross,
        });
        return {
          success: true,
          simulationMode: false,
          action: 'hl_set_leverage',
          chainId: HYPEREVM_CHAIN_ID,
          vault: validated.vault,
          perp: validated.perp,
          leverage: validated.leverage,
          mode: validated.mode,
          l1Action: {
            requiresL1Signing: true,
            action: built.action,
            nonce: built.nonce,
            vaultAddress: built.vaultAddress,
            isTestnet: false,
            asset: built.asset,
          },
        };
      }

      const hlVault = buildHlVault(validated.vault as Address, {
        password: validated.password,
      });
      const exchangeResponse = await hlVault.setLeverage(
        validated.perp,
        validated.leverage,
        validated.mode,
      );

      const result: OffChainHlResult = {
        submitted: true,
        txHash: 'off-chain-hl-action',
        action: 'hl_set_leverage',
        chainId: HYPEREVM_CHAIN_ID,
        vault: validated.vault,
        details: {
          perp: validated.perp,
          leverage: validated.leverage,
          mode: validated.mode,
          exchangeResponse: exchangeResponse as unknown as Record<string, unknown>,
        },
      };
      return result;
    } catch (error) {
      if (error instanceof VaultError) throw error;
      throw new SdkError('Failed to submit HL setLeverage action', error);
    }
  },
};
