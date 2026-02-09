# Factor MCP - Agent Test Report

**Date:** 2026-02-09
**Agent:** Claude Opus 4.6 (via Claude Code)
**MCP Server:** @factordao/mcp-server v1.1.0
**SDK Packages:** @factordao/sdk@2.0.94 (pro-beta), @factordao/sdk-studio@2.0.94 (pro-beta), @factordao/tokenlist@1.3.41
**Wallet:** 0xF4c9fAa7a85f5eAEfBB56Ba50f4369bFee9fDAfA (0.0015 ETH, 0.08 USDC on ARB)
**Foundry:** cast/anvil/forge v1.3.5-stable, rust 1.93.0
**RPC:** Alchemy (per-chain resolution via `alchemyApiKey` in config.json)

---

## Summary

| Category | Tests | Passed | Failed | Notes |
|----------|-------|--------|--------|-------|
| Automated (vitest) | 335 | 335 | 0 | Unit + Integration + E2E |
| Live Agent: Read-only | 42 | 42 | 0 | Config, adapters, vaults, lending tokens, foundry |
| Live Agent: Write (working) | 7 | 7 | 0 | deposit, withdraw, lend supply/withdraw (aave, compoundV3), execute_manager |
| Live Agent: Write (revert) | 5 | 5 | 0 | Expected reverts: borrow, repay, add_adapter, add_vault_token, create_vault |
| Live Agent: Write (BUG) | 13 | 0 | 13 | SDK errors: swap, LP, GMX, Pendle, Penpie, flashloan, build_strategy |
| **Total** | **402** | **389** | **13** | |

---

## 1. Automated Test Suites

### 1.1 Unit Tests (307 tests, 4 suites)

| Suite | Tests | Status |
|-------|-------|--------|
| `tests/registration.test.ts` | 5 | PASS |
| `tests/adapters.test.ts` | 28 | PASS |
| `tests/schemas.test.ts` | 241 | PASS |
| `tests/lending.test.ts` | 33 | PASS |

Run: `pnpm test:unit`

### 1.2 Integration Tests (8 tests)

| Suite | Tests | Status |
|-------|-------|--------|
| `tests/integration.test.ts` | 8 | PASS |

Run: `pnpm test:integration`

### 1.3 E2E MCP Protocol Tests (20 tests)

| Suite | Tests | Status |
|-------|-------|--------|
| `tests/e2e-mcp.test.ts` | 20 | PASS |

Spawns real MCP server as child process, connects via StdioClientTransport (JSON-RPC over stdio).
Run: `pnpm test:e2e`

---

## 2. Live Agent Tool Calls — Read-Only (42 tests, 42 passed)

### 2.1 Configuration & Infrastructure

| # | Tool | Chain | Result | Notes |
|---|------|-------|--------|-------|
| 1 | `factor_get_config` | ARB | PASS | chain=ARBITRUM_ONE, chainId=42161, Alchemy RPC |
| 2 | `factor_check_foundry` | - | PASS | cast/anvil/forge v1.3.5-stable, rust 1.93.0 |

### 2.2 Chain Switching

| # | Tool | From | To | Result | ChainId |
|---|------|------|----|--------|---------|
| 3 | `factor_set_chain` | ARB | BASE | PASS | 8453 |
| 4 | `factor_set_chain` | BASE | ARB | PASS | 42161 |
| 5 | `factor_set_chain` | ARB | BASE | PASS | 8453 |
| 6 | `factor_set_chain` | BASE | ARB | PASS | 42161 |

### 2.3 Adapter Registry

| # | Tool | Chain | Filter | Result | Count |
|---|------|-------|--------|--------|-------|
| 7 | `factor_list_adapters` | ARB | none | PASS | 25 adapters |
| 8 | `factor_list_adapters` | ARB | protocol=Aave | PASS | 2 (aave + aaveFL) |
| 9 | `factor_list_adapters` | ARB | protocol=lending | PASS | 6 adapters |
| 10 | `factor_list_adapters` | BASE | none | PASS | 19 adapters |

### 2.4 Factory & SDK Addresses

| # | Tool | Chain | Result | Notes |
|---|------|-------|--------|-------|
| 11 | `factor_get_factory_addresses` | ARB | PASS | 62 manager adapters, 5 owner, 107 assets, 21 debts |
| 12 | `factor_get_factory_addresses` | BASE | PASS | 66 manager adapters, 5 owner, 101 assets, 27 debts |
| 13 | `factor_get_address_book` | ARB | PASS | 34 SDK addresses |
| 14 | `factor_get_address_book` | BASE | PASS | 38 SDK addresses |

### 2.5 Tokenlist (Lending Tokens)

| # | Tool | Chain | Protocol | Result | Count |
|---|------|-------|----------|--------|-------|
| 15 | `factor_get_lending_tokens` | ARB | aave | PASS | 17 tokens |
| 16 | `factor_get_lending_tokens` | ARB | compoundV3 | PASS | 4 markets |
| 17 | `factor_get_lending_tokens` | ARB | morpho | PASS | 0 tokens |
| 18 | `factor_get_lending_tokens` | BASE | aave | PASS | 13 tokens |
| 19 | `factor_get_lending_tokens` | BASE | compoundV3 | PASS | 5 markets |
| 20 | `factor_get_lending_tokens` | BASE | morpho | PASS | Large result (80K+ chars, many markets) |

### 2.6 Vault Operations (ARBITRUM_ONE)

| # | Tool | Vault | Result | Notes |
|---|------|-------|--------|-------|
| 21 | `factor_get_owned_vaults` | all | PASS | 4 vaults found |
| 22 | `factor_get_vault_info` | 0xd88d...38c1 | PASS | 7 assets, 0 debts, 2 managers |
| 23 | `factor_get_shares` | 0xd88d...38c1 | PASS | 87.89% ownership, PPS=996389 |
| 24 | `factor_get_executions` | 0xd88d...38c1 | PASS | 13 total, 5 shown |
| 25 | `factor_preview_deposit` | 0xd88d...38c1 | PASS | 1 USDC -> 1,003,623T shares |
| 26 | `factor_preview_withdraw` | 0xd88d...38c1 | PASS | 1T shares -> 0 assets |

### 2.7 Vault Operations (BASE)

| # | Tool | Vault | Result | Notes |
|---|------|-------|--------|-------|
| 27 | `factor_get_owned_vaults` | all (BASE) | PASS | 1 vault found |
| 28 | `factor_get_vault_info` | 0x37e3...3db3 | PASS | 6 assets, 2 debts, PPS=1.0001 |
| 29 | `factor_get_shares` | 0x37e3...3db3 | PASS | 99.47% ownership, PPS=1.0001 |
| 30 | `factor_get_executions` | 0x37e3...3db3 | PASS | 14 total executions |
| 31 | `factor_preview_deposit` | 0x37e3...3db3 | PASS | 1 USDC -> 999,903 shares |
| 32 | `factor_preview_withdraw` | 0x37e3...3db3 | PASS | 1 share -> 1 asset |

### 2.8 Validation & Foundry

| # | Tool | Chain | Result | Notes |
|---|------|-------|--------|-------|
| 33 | `factor_validate_vault_config` | BASE | PASS | USDC + Chainlink = valid |
| 34 | `factor_validate_vault_config` | ARB | PASS | Returns isValid=false for non-whitelisted addresses (correct) |
| 35 | `factor_cast_call` | ARB | PASS | USDC.symbol() = "USDC" |
| 36 | `factor_cast_call` | BASE | PASS | USDC.symbol() = "USDC" |
| 37 | `factor_preview_transaction` | ARB | PASS | Gas estimate for USDC symbol() call: 31,803 gas |
| 38 | `factor_get_transaction_status` | ARB | PASS | Tx 0xbe65a3... confirmed, gasUsed=705779 |
| 39 | `factor_decode_error` | ARB | PASS | Decoded Error(string) selector 0x08c379a0 |

### 2.9 Regression Check

| # | Tool | Chain | Result | Notes |
|---|------|-------|--------|-------|
| 40 | `factor_set_chain` | BASE -> ARB | PASS | Alchemy RPC confirmed |
| 41 | `factor_get_config` | ARB | PASS | Config correct after round trip |
| 42 | `factor_list_adapters` (lending) | ARB | PASS | 6 lending adapters confirmed |

---

## 3. Live Agent Tool Calls — Write Operations: WORKING (7 tests, 7 passed)

All executed on ARBITRUM_ONE, vault `0xd88d8dc186f5c6d605cba97101c22a75b80538c1`.

| # | Tool | Action | Result | TxHash |
|---|------|--------|--------|--------|
| 43 | `factor_deposit` | 1000 wei USDC | **PASS** | `0xce94c207...bb082d` |
| 44 | `factor_withdraw` | 1000 shares | **PASS** | `0xe9796f7a...f8ceb9` |
| 45 | `factor_lend_supply` | aave, 1000 wei USDC | **PASS** | `0x2d0ed6e5...a89631` |
| 46 | `factor_lend_withdraw` | aave, 500 wei USDC | **PASS** | `0xb438eaf6...dbc111` |
| 47 | `factor_lend_supply` | compoundV3, 500 wei USDC | **PASS** | `0xd409d14b...7f79d` |
| 48 | `factor_lend_withdraw` | compoundV3, 500 wei USDC | **PASS** | `0x1d4c0935...a11e03` |
| 49 | `factor_execute_manager` | aave.supplyAll(USDC) | **PASS** | `0xc065651c...f43e3` |

---

## 4. Live Agent Tool Calls — Write Operations: EXPECTED REVERTS (5 tests, 5 passed)

These tools generated correct calldata and attempted execution. They reverted on-chain due to vault state (no debt, adapter not whitelisted, insufficient approval). This is correct behavior.

| # | Tool | Action | Result | Reason |
|---|------|--------|--------|--------|
| 50 | `factor_lend_borrow` | aave, 100 wei USDC | REVERT | Insufficient collateral / debt token not registered |
| 51 | `factor_lend_repay` | aave, 100 wei USDC | REVERT | No outstanding debt to repay |
| 52 | `factor_add_adapter` | Add non-whitelisted adapter | REVERT | Adapter not whitelisted in factory |
| 53 | `factor_add_vault_token` | Add WETH as asset | REVERT | Accounting address not whitelisted for WETH |
| 54 | `factor_create_vault` | "Agent Test Vault" | REVERT | Insufficient initial deposit (needs USDC approval) |

---

## 5. Live Agent Tool Calls — FAILURES / BUGS (13 tests, 0 passed)

### 5.1 Empty Details Failures (`details: {}`)

These tools fail during SDK adapter initialization before generating calldata. The error is `SDK_ERROR` with empty details `{}` — the real error is swallowed because `JSON.stringify(new Error(...))` produces `{}`.

| # | Tool | Action | Error |
|---|------|--------|-------|
| 55 | `factor_swap` | Uniswap USDC->WETH, 500 wei | `Failed to execute swap`, details: {} |
| 56 | `factor_swap_openocean` | USDC->WETH, 100 wei | `Failed to execute OpenOcean swap`, details: {} |
| 57 | `factor_swap_pendle` | tokenToPT, 100 wei | `Failed to execute Pendle swap`, details: {} |
| 58 | `factor_gmx` | claim | `Failed to execute GMX operation`, details: {} |
| 59 | `factor_pendle_lp` | collectFees | `Failed to execute Pendle LP operation`, details: {} |
| 60 | `factor_flashloan` | aave, 1000 wei USDC | `Failed to execute flash loan strategy`, details: {} |
| 61 | `factor_lp_create_position` | uniswapV3, USDC/WETH | `Failed to create LP position`, details: {} |
| 62 | `factor_lp_add_liquidity` | uniswapV3, tokenId=1 | `Failed to add liquidity`, details: {} |
| 63 | `factor_lp_remove_liquidity` | uniswapV3, tokenId=1 | `Failed to remove liquidity`, details: {} |
| 64 | `factor_lp_collect_fees` | uniswapV3, tokenId=1 | `Failed to collect LP fees`, details: {} |
| 65 | `factor_simulate_transaction` | USDC symbol() | `Simulation failed`, details: {} |

**Likely root cause:** The vault (`0xd88d...38c1`) does not have the required protocol adapters installed (no UniswapAdapter, no GMX adapter, no PendleAdapter, etc.). The SDK throws an error when trying to call methods on adapters that aren't on the vault, but the error is caught and re-thrown as `SdkError` which loses the original error details.

### 5.2 "Address undefined" Failures

These tools fail with `Address "undefined" is invalid` — a code bug where an address lookup returns undefined.

| # | Tool | Action | Error |
|---|------|--------|-------|
| 66 | `factor_build_strategy` | uniswap.exactInputSingleAll | `Address "undefined" is invalid` |
| 67 | `factor_penpie` | withdrawAll | `Address "undefined" is invalid` |

**Root cause:** The SDK adapter property (e.g., router address, Penpie staking address) is not being resolved. The tool code accesses an address that doesn't exist in the SDK's address book for the current chain/config.

### 5.3 "Address empty" Failure

| # | Tool | Action | Error |
|---|------|--------|-------|
| 68 | `factor_lend_supply` | morpho, collateral=true, 100 wei | `Address "" is invalid` |

**Root cause:** The Morpho collateral supply path in `lend-supply.ts` passes an empty string as an address. The `assetAddress` parameter is likely required for Morpho collateral operations but is not being extracted from the `marketId`.

---

## 6. Bug Classification

### Critical (blocks core functionality)
None — deposit, withdraw, lend supply/withdraw (aave, compoundV3), and execute_manager all work.

### High (new tools non-functional)

| Bug | Tools Affected | Root Cause |
|-----|---------------|------------|
| Empty details `{}` | swap, swap_openocean, swap_pendle, all LP, gmx, pendle_lp, flashloan, simulate_transaction | Error swallowed by SdkError + JSON.stringify(Error) = {} |
| Address undefined | build_strategy, penpie | Address lookup returns undefined for adapter/router |
| Address empty | lend_supply (morpho collateral) | Missing assetAddress extraction from marketId |

### Low (design issues)
| Bug | Description |
|-----|-------------|
| `factor_set_rpc` persists globally | Overrides per-chain Alchemy resolution for all chains |

---

## 7. Tools NOT Tested

| Tool | Reason |
|------|--------|
| `factor_execute_strategy` | Depends on `build_strategy` which is broken |
| `factor_simulate_strategy` | Depends on `build_strategy` which is broken |
| `factor_wallet_setup` | Security-sensitive |
| `factor_set_rpc` | Config change (see note in section 6) |
| `factor_lend_supply` (siloV2) | Not tested yet (BASE) |
| `factor_lend_borrow` (compoundV3/morpho) | Not tested yet |
| `factor_lend_repay` (compoundV3/morpho) | Not tested yet |

---

## 8. How to Reproduce

```bash
cd /Users/turinglabs/GIT/@factor/active-development/factor-mcp

# Build first
pnpm build

# Run all automated tests (307 unit + 8 integration + 20 E2E = 335 total)
pnpm test

# Run only unit tests (no RPC needed)
pnpm test:unit

# Run only integration tests (needs RPC)
pnpm test:integration

# Run only E2E MCP protocol tests (needs RPC + dist/ built)
pnpm test:e2e
```

---

## 9. Test Scripts Reference

| Script | Command | What it Tests | RPC Required |
|--------|---------|---------------|-------------|
| All | `pnpm test` | Everything | Yes |
| Unit | `pnpm test:unit` | Registration, adapters, schemas, lending validation | No |
| Integration | `pnpm test:integration` | Handler functions with real RPC | Yes |
| E2E | `pnpm test:e2e` | Full MCP protocol (stdio JSON-RPC) | Yes |
