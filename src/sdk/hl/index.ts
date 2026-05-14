// SPDX-FileCopyrightText: 2026 FACTOR
// SPDX-License-Identifier: MIT
//
// Public surface of the HyperLiquid SDK module. Wire this into the
// top-level package as `export * as hl from './hl.js';` to keep the
// namespace tidy (does not pollute the flat root export).

// ---------------------------------------------------------------------------
// Primary class + factory
// ---------------------------------------------------------------------------

export {
  HLVault,
  HL_ADDRESSES_999,
  type HLChainAddresses,
  type HLVaultOptions,
  type OpenPositionParams,
  type ClosePositionParams,
  type PlaceOrderParams,
} from './HLVault.js';

/// @notice Factory matching the design-doc shape: `factor.hl.vault(addr, opts)`.
import { HLVault as _HLVault, type HLVaultOptions as _Opts } from './HLVault.js';
import type { Address } from 'viem';
export const vault = (
  vaultAddress: Address,
  opts: _Opts,
): _HLVault => _HLVault.create(vaultAddress, opts);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export {
  PERP_INDEX,
  ORDER_TIF,
  HLPreflightError,
  HL_MIN_NOTIONAL_USD,
  HL_MAX_SLIPPAGE_BPS,
  HL_IOC_MIN_BAND_BPS,
  HL_MIN_SETTLE_DELAY_BLOCKS,
  HL_MAX_PENDING_CLOIDS,
  HL_MAX_ACTIVE_PERPS,
  HL_USDC_SPOT_TOKEN_ID,
  type AccountMarginSummary,
  type HLPosition,
  type HLPreflightErrorDetails,
  type HLPreflightErrorKind,
  type HLSpotBalance,
  type HLVaultNav,
  type HlExchangeResponse,
  type MarginMode,
  type OrderTif,
  type PerpAssetInfo,
  type PerpSymbol,
  type Side,
  type SignedHlAction,
  type UnsignedTx,
} from './types.js';

// ---------------------------------------------------------------------------
// Math + utils (handy for callers who want to preview sizes/limits)
// ---------------------------------------------------------------------------

export {
  tickRound,
  validateTick,
  alignIocLimit,
  sizeUsdToWire,
} from './tickMath.js';

export {
  usdcEvm,
  usdcPerp,
  usdcSpotWei,
  spotWeiToEvm,
  evmToSpotWei,
  toWire1e8,
  wire1e8ToReal,
  markToWire1e8,
  markPxToReal,
  sizeWireToReal,
  notional1e8,
} from './decimals.js';

// ---------------------------------------------------------------------------
// Preflight (composable validators)
// ---------------------------------------------------------------------------

export {
  checkMinNotional,
  checkTick,
  checkIocBand,
  checkSlippage,
  checkAgentFresh,
  checkBridgeToken,
  checkPendingCap,
  checkActiveCap,
  checkSufficientBalance,
  preflightOpenPosition,
  preflightPlaceOrder,
} from './preflight.js';

// ---------------------------------------------------------------------------
// Low-level building blocks (exported for advanced callers / tests)
// ---------------------------------------------------------------------------

export {
  hyperLiquidPerpAdapterAbi,
  encodeOpenPosition,
  encodeClosePosition,
  encodePlaceOrder,
  encodeCancelOrder,
  encodeSyncPosition,
  encodeSettlePending,
  encodeForceForgetCloid,
  encodeDepositToPerp,
  encodeWithdrawFromPerp,
  encodeSpotSend,
  encodeBridgeSpotToEvm,
  encodeAddApiWallet,
} from './coreWriter.js';

export {
  PRECOMPILE,
  readPosition,
  readSpotBalance,
  readWithdrawable,
  readAccountMarginSummary,
  readCoreUserExists,
  readMarkPx,
  readPerpAssetInfo,
} from './precompiles.js';

export { getNav } from './nav.js';

export {
  HLExchangeClient,
  makeExchange,
  HL_EXCHANGE_URL_MAINNET,
  HL_EXCHANGE_URL_TESTNET,
  type HLExchangeClientOptions,
  type HlExchangeAction,
  type UpdateLeverageAction,
  type UpdateIsolatedMarginAction,
} from './exchange.js';

// ---------------------------------------------------------------------------
// Instrument catalog + search + batch compiler
// ---------------------------------------------------------------------------

export {
  buildInstrumentCatalog,
  categorize,
  displayNameFor,
  DEFAULT_MAX_KNOWN_BUILDER_DEX,
  SPOT_DEX_SENTINEL,
  type Instrument,
  type InstrumentCategory,
  type InstrumentType,
  type BuildInstrumentCatalogOptions,
} from './catalog.js';

export {
  searchInstruments,
  resolveInstrument,
  type SearchHit,
  type SearchOptions,
} from './search.js';

export {
  compileOpenPosition,
  compileClosePosition,
  executeBatchPlan,
  type BatchPlan,
  type BatchPlanParams,
  type BatchPlanEstimates,
  type BatchExecutor,
  type CompileOpenArgs,
  type CompileCloseArgs,
  type ExecuteBatchPlanOptions,
  type ExecuteBatchPlanResult,
  type Operation,
} from './batch.js';
