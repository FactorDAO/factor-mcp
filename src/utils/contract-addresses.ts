/**
 * Wrapper around @factordao/sdk-studio getContractAddressesForChainOrThrow.
 *
 * FAC-3806: published `@factordao/sdk-studio@pro-beta` (2.1.24) does not yet
 * ship the Robinhood (4663) address book. Until an npm publish lands, fall
 * back to the production RHC map from factor-studio-core main so mcp-gateway
 * / factor-mcp can deploy Morpho Blue + OpenOcean vaults on chain 4663.
 */
import { getContractAddressesForChainOrThrow as sdkGetAddresses } from '@factordao/sdk-studio';

/** Minimal ContractAddresses subset used by factor-mcp Pro tools on RHC. */
const ROBINHOOD_PRODUCTION_ADDRESSES: Record<string, string | Record<string, never>> = {
  factor_studio_pro_factory: '0x57715f094BcAd1B55dCD7C413eEB2a76e19F7Fc4',
  factor_adapter_management_adapter_pro: '0x5850dd894ab98FbD37cFaA2E6fe614BC0f1528c9',
  factor_asset_debt_adapter_pro: '0xc9b92A9229540916c08E8308157222Cbb115254b',
  factor_openocean_adapter_pro: '0x09EA3113f1e895f1B84ee1f1bA35C8A1E5Ee1059',
  factor_transfer_adapter_pro: '0x8c149b2160cf87aD0915b79a8B4C4dc730d8BF55',
  factor_refund_adapter_pro: '0xd605A2a56BeD6DB7591d4a4fbACA3DC4d0d1F584',
  factor_boost_adapter_pro: '0x70AdBE53C6965829a535D59a2e554CC0596EeBD5',
  factor_chainlink_adapter_pro: '0xEec09a46F3182c245D2e7B42a3069D033E1895AC',
  factor_chainlink_accounting_adapter_pro: '0x77A2CfdCcF96091403C4898fdeDE41CfE98E0dc8',
  factor_morpho_adapter_pro: '0x0D065C80DCD17ca8770509a6d68746E779fe8f56',
  factor_morpho_market_adapter_pro: '0xE89Affb55cB5455bc0be80f00e31941E91C0fE61',
  factor_morpho_accounting_collateral_adapter_pro: '0xF6e419fe89e826c9dA38F0D5620874DD04B807fF',
  factor_morpho_accounting_debt_adapter_pro: '0xF7Dd8fBE347a29157a885ff441710a58DB1b39bF',
  factor_morpho_vault_adapter_pro: '0xc0ee146618Ac87A4Cc37E5368e0e22Ec139b4696',
  factor_morpho_vault_whitelist_adapter_pro: '0x2e704c7d37b1A82090887Ff4e58bA7472374730D',
  factor_scale: '0x800ca8E95f150071678BA2B3F1a2BE5A0f4D9C1F',
  factor_leverage_adapter: {},
  factor_lpvault_adapter: {},
  factor_yield_vaults: {},
};

export function getContractAddressesForChainOrThrow(
  chainId: number,
  environment: string,
): Record<string, unknown> {
  try {
    return sdkGetAddresses(chainId, environment as never) as Record<string, unknown>;
  } catch (err) {
    if (chainId === 4663 && (environment === 'production' || environment === 'latest')) {
      return { ...ROBINHOOD_PRODUCTION_ADDRESSES };
    }
    throw err;
  }
}
