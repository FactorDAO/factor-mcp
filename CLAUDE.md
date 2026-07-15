# Factor MCP Server - Claude Code Skills

This is an MCP server for managing Factor Protocol DeFi vaults using the `@factordao/sdk-studio`.

## Quick Install

```bash
curl -sSL https://raw.githubusercontent.com/FactorDAO/factor-mcp/main/install.sh | bash
```

## Requirements

### Required
- **Node.js** >= 18.0.0
- **npm** or **yarn**

### Optional (for advanced features)
- **Rust** - Required for Foundry installation
  ```bash
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  ```
- **Foundry** - Enables transaction simulation, error decoding, and forked network testing
  ```bash
  curl -L https://foundry.paradigm.xyz | bash && foundryup
  ```

> **Note**: If Foundry is not installed, the MCP server will still work but some advanced debugging and simulation features will not be available. The server will gracefully handle missing Foundry and inform you when features are unavailable.

## Supported Chains
- **ARBITRUM_ONE** (default) - Arbitrum One
- **BASE** - Base
- **MAINNET** - Ethereum Mainnet

## Environments
- **production** - Production contracts
- **testing** - Testing/staging contracts (default for development)

## Available Tools (66 total)

### Configuration (5 tools)
- `factor_get_config` - View current configuration (chain, RPC, wallet, simulation mode, environment)
- `factor_set_chain` - Switch chain (ARBITRUM_ONE, BASE, MAINNET)
- `factor_set_rpc` - Set custom RPC endpoint
- `factor_wallet_setup` - Import or generate a wallet (requires `model_name` — the LLM must self-identify its model name)
- `factor_get_address_book` - Get SDK address book (Pro adapters only) for the current chain and environment

### Tokenlist (2 tools)
- `factor_get_lending_tokens` - Look up lending token info (aTokens, debt tokens, underlying assets) for Aave, Compound V3, or Morpho from the tokenlist
- `factor_add_vault_token` - Add an asset or debt token to a vault with the correct accounting adapter (uses AssetDebtAdapter via executeByManager)

### Token (1 tool)
- `factor_give_approval` - Approve an ERC20 token for spending by a spender (vault, factory). Must be called before deposits or vault creation if allowance is insufficient. Supports "max" for unlimited approval.

### Vault Operations (15 tools)
- `factor_get_owned_vaults` - List vaults owned by an address
- `factor_get_vault_info` - Get detailed vault information (assets, fees, managers, adapters)
- `factor_vault_analytics` - Get detailed on-chain vault position breakdown via `@factordao/vault-analytics` (≥1.0.34): per-token balances, USD values, APY/APR by protocol (Aave, Compound, Morpho, Pendle, idle), aggregate stats (weighted APY, TVL, net return), and — when the vault has lending exposure — a `lending` block with **per-protocol health factors**. Aave V3: account-level `healthFactor` (null when no debt) + `totalCollateralUsd / totalDebtUsd / availableBorrowsUsd / liquidationThresholdPct / ltvPct`. Compound V3 (Comet): per-market `healthFactor` (computed from `Σ(collateral × price × liquidationFactor) / borrow`) + `isLiquidatable` (authoritative on-chain bool) + `collateralBreakdown[]`. Morpho Blue: per-market `healthFactor` + `collateralUsd / borrowUsd / supplyUsd` + loan/collateral asset metadata. The `lending` block is omitted entirely for vaults without lending exposure. Health-factor numbers are kept at full float precision (no rounding) because the agent's safety thresholds (HF<2.0 = no enter, HF<1.3 = deleverage) live right at boundaries where 2-decimal rounding would hide the difference. Always up to date — reads directly from chain.
- `factor_get_shares` - Get user's shares, total supply, and price per share
- `factor_get_executions` - Get vault execution history with decoded adapter calls
- `factor_preview_deposit` - Preview a deposit (read-only)
- `factor_deposit` - Execute a deposit (auto-approves tokens)
- `factor_preview_withdraw` - Preview a withdrawal (read-only)
- `factor_withdraw` - Execute a withdrawal (redeem shares)
- `factor_create_vault` - Deploy a new Factor Pro vault (auto-detects accounting adapters)
- `factor_execute_manager` - Execute DeFi strategies (swap, lend, borrow) as vault manager
- `factor_get_factory_addresses` - Get whitelisted assets, adapters, and accounting addresses from factory
- `factor_validate_vault_config` - Validate vault configuration before deployment
- `factor_add_adapter` - Add a manager adapter to a vault
- `factor_vault_templates` - **ALWAYS call this first when creating a vault.** Supports two modes: (1) **Guided mode** — call with NO params to get a questionnaire with dynamically fetched token options; present questions to user, then call again with `vaultType`, `strategyTokens`, `depositWithdrawTokens`. (2) **Direct mode** — call with `denominator` and optionally `lendingProtocol` for pre-configured templates. For lending, set `lendingProtocol`: `"aave"`, `"compoundV3"`, or `"morpho"`. The vault deploys lending-ready in one transaction.

### Vault Management (12 tools)
- `factor_set_withdraw_fee` - Set withdraw fee in basis points (0-10000)
- `factor_set_deposit_fee` - Set deposit fee in basis points (0-10000)
- `factor_set_performance_fee` - Set performance fee in basis points (0-10000)
- `factor_set_management_fee` - Set annual management fee in basis points (0-10000)
- `factor_charge_performance_fee` - Charge accrued performance fee (mints fee shares to receiver)
- `factor_set_fee_receiver` - Set the address that receives vault fees
- `factor_set_max_cap` - Set maximum deposit cap in base units (0 = no cap)
- `factor_set_max_debt_ratio` - Set maximum debt ratio in basis points (0-10000)
- `factor_set_price_deviation_allowance` - Set cumulative price deviation allowance in basis points
- `factor_add_vault_manager` - Add a manager address to the vault
- `factor_remove_vault_manager` - Remove a manager address from the vault
- `factor_set_risk_manager` - Set the risk manager address

### Lending Operations (4 tools)
- `factor_lend_supply` - Supply/deposit assets to a lending protocol (Aave, Compound V3, Morpho). Morpho on Base/Ethereum only. Supports Morpho collateral operations.
- `factor_lend_withdraw` - Withdraw supplied assets from a lending protocol (Aave, Compound V3, Morpho). Supports Morpho collateral withdrawal.
- `factor_lend_borrow` - Borrow assets from a lending protocol (Aave, Compound V3, Morpho)
- `factor_lend_repay` - Repay borrowed assets to a lending protocol (Aave, Compound V3, Morpho)

### Swap Operations (4 tools)
- `factor_swap_uniswap` - Execute Uniswap V3 exact input swaps via the Uniswap adapter. Supports "all", percentages, and fee tiers (100/500/3000/10000). NOT available on Base (Uniswap adapter incompatible with SwapRouter02).
- `factor_swap_uniswap_exact_output` - Execute Uniswap V3 exact output swaps via the Uniswap adapter. NOT available on Base.
- `factor_swap_openocean` - Execute swaps via OpenOcean DEX aggregator adapter. Automatically fetches the best route — no need to provide swap data manually. Supports "all", percentages, and exact amounts. Works on all chains including Base. **Preferred for all swaps.**
- `factor_swap_pendle` - Execute Pendle PT/YT swaps via the Pendle adapter.

### LP Operations (4 tools)
- `factor_lp_create_position` - Create concentrated liquidity position (Uniswap V3, Ethereum only)
- `factor_lp_add_liquidity` - Add liquidity to an existing LP position
- `factor_lp_remove_liquidity` - Remove liquidity from an LP position
- `factor_lp_collect_fees` - Collect accumulated trading fees from an LP position

### Yield Operations (1 tool)
- `factor_pendle_lp` - Pendle LP operations (Arbitrum, Ethereum): add/remove liquidity, collect fees

### Flash Loan (1 tool)
- `factor_flashloan` - Execute flash loan strategies (Balancer provider, all chains). Borrows, executes inner strategy steps, and repays in a single transaction.

### Strategy Building (4 tools)
- `factor_list_adapters` - List available protocol adapters (chain-aware, 30+ adapters)
- `factor_build_strategy` - Build a multi-step strategy using real SDK encoding
- `factor_simulate_strategy` - Simulate a strategy with real gas estimation via eth_call
- `factor_execute_strategy` - Execute a strategy on-chain

### Profile & Strategy (6 tools)
- `factor_save_profile` - Save a user profile with wallet signature. Signs: `"Save profile for: " + address.toLowerCase()`. POSTs to `/profiles`.
- `factor_get_profile` - Get a user profile by address (read-only, no wallet needed).
- `factor_save_strategy` - Save or update a vault strategy with wallet signature. Signs: `"Save strategy: " + name`. POSTs to `/strategies/save` with chain (numeric chainId), strategy steps, vault_address, etc. Include `hash` to update an existing strategy.
- `factor_delete_strategy` - Delete a saved strategy with wallet signature. Signs: `"Delete strategy: " + hash`. POSTs to `/strategies/delete`.
- `factor_get_strategy` - Get a strategy by hash (read-only, no wallet needed). GET `/strategies/:hash`.
- `factor_get_strategies` - Get all strategies for an owner on a chain (read-only). GET `/strategies/:chainId/:owner`.

### Transactions (2 tools)
- `factor_preview_transaction` - Preview with gas estimate
- `factor_get_transaction_status` - Check transaction status

### Foundry Tools (5 tools) - *Requires Foundry*
- `factor_check_foundry` - Check if Foundry suite (cast, anvil, forge) and Rust are installed
- `factor_cast_call` - Execute read-only contract calls using `cast`
- `factor_simulate_transaction` - Simulate transactions on forked network using `anvil`. Supports `balanceOverrides` to set ETH balances before execution.
- `factor_decode_error` - Decode contract errors and revert reasons
- `factor_run_forge_script` - Run a Solidity forge script on a forked network. Write a script using forge-std cheatcodes (`vm.deal()` for ETH, `deal(token,to,amount)` for ERC20, `vm.startBroadcast()`, `console.log`) and pass it as `scriptContent`. Handles project setup, compilation, and execution automatically.

## SDK Adapter IDs (for factor_execute_manager and factor_build_strategy)

These are the SDK property names used as `protocol`/`adapter` parameter values:

### Lending
- `aave` - Aave V3 (Arb/Base/Mainnet)
- `compoundV3` - Compound V3 (Arb/Base/Mainnet)
- `compoundV3Market` - Compound V3 market management
- `morpho` - Morpho (Base/Mainnet) - includes collateral ops. NOT deployed on Arbitrum.

### DEX
- `uniswap` - Uniswap V3 swaps (Arb/Base/Mainnet)
- `openOcean` - OpenOcean aggregator (Arb/Base/Mainnet)
- `pendlePy` - Pendle PT/YT swaps (Arb/Base/Mainnet)

### LP
- `uniswapV3Lp` - Uniswap V3 concentrated liquidity (Mainnet only)

### Yield
- `pendle` - Pendle LP (Arb/Mainnet)

### Flash Loans
- `balancerFL` - Balancer flash loans (Arb/Base/Mainnet)

### Policy/Management
- `adapterManagement` - Add/remove adapters
- `assetDebt` - Add/remove assets and debts
- `depositPolicy` - Deposit policy management

### Automation
- `gelato` - Gelato automation (Arb/Base/Mainnet)

## Architecture Rules

- **All vault interactions go through `executeByManager`**: Every on-chain operation on a vault (lending, swapping, adding adapters, etc.) is executed via the `proVault.executeByManager([blocks])` pattern. The SDK's `StrategyBuilder` generates the encoded blocks, and `StudioProVault.executeByManager()` wraps them in a manager call.
- **Adding adapters uses `AdapterManagementAdapter`**: To add a new protocol adapter to a vault, call `strategyBuilder.adapter.adapterManagement.addAdapter(adapterAddress)` and execute it via `proVault.executeByManager([block])`. The adapter must be whitelisted in the factory.
- **`factor_create_vault` auto-mirrors deposit/withdraw assets and force-includes the denominator (added 1.7.6)**: a prod audit found 9 vaults shipped with empty `withdrawAssets`, making them un-redeemable because Smart Withdraw reverts on any `withdrawAsset(asset)` call when the asset isn't on the on-chain whitelist. The fix lives in `src/tools/vault/create-vault.ts::resolveVaultAssetLists` (exported, pure, unit-tested in `tests/create-vault.test.ts`): when `initialWithdrawAssetAddresses` is omitted or `[]`, it mirrors `initialDepositAssetAddresses`; the `assetDenominatorAddress` is force-prepended to BOTH lists if missing; the resolved withdraw list is rejected with `VaultError` if it ends up empty after resolution. The matching `factor_validate_vault_config` tool surfaces a soft `warnings[]` entry when callers pass `depositAssetAddresses` without `withdrawAssetAddresses`. Callers who intentionally want a deposit-only vault must pass an explicit non-empty `initialWithdrawAssetAddresses` (the helper preserves explicit values verbatim — only the denominator is force-prepended). Mirrored at the `mcp-gateway` layer (`src/providers/factor.py`) as belt-and-suspenders so older factor-mcp builds connected through the gateway are also protected.

## Common Workflows

### Setup Wallet (Foundry Keystore)
```
1. factor_wallet_setup with privateKey, password, model_name, and storageType: "foundry-keystore" (stores in ~/.foundry/keystores/)
2. factor_get_config to verify wallet is active
```

### Use Existing Foundry Keystore
```
1. factor_wallet_setup with name and useExistingFoundryKeystore: true
2. Password will be required for all write operations (deposit, withdraw, etc.)
```

### Setup Wallet (Factor-MCP - Default)
```
1. factor_wallet_setup with privateKey, model_name, and optionally password or skipPasswordProtection: true
2. factor_get_config to verify wallet is active
```

### Deposit to Vault
```
1. factor_get_vault_info to check vault details and valid deposit assets
2. factor_preview_deposit to see expected shares
3. factor_give_approval to approve the token for the vault (if allowance is insufficient)
4. factor_deposit to execute (needs password if encrypted)
```

### Withdraw from Vault
```
1. factor_get_shares to check your balance
2. factor_preview_withdraw to see expected assets
3. factor_withdraw to execute (needs password if encrypted)
```

### Prepare Vault for Aave Lending (Full Setup)
Before supplying to Aave, the vault must have: (1) the Aave adapter, (2) the aToken registered as an asset, and optionally (3) the debt token registered as a debt for borrowing.
```
1. factor_get_lending_tokens with protocol: "aave", underlyingAsset: "<USDC_ADDRESS>"
   → Returns aToken address, variableDebtToken address, underlying info
2. factor_get_address_book
   → Find factor_aave_adapter_pro (adapter address) and factor_aave_accounting_adapter_pro (accounting)
3. factor_get_vault_info to check current vault state
   → See if the Aave adapter is already added and if aToken/debtToken are in assets/debts
4. factor_add_adapter (if Aave adapter missing)
   → Add factor_aave_adapter_pro to the vault
5. factor_get_factory_addresses
   → Find the correct accounting address for the aToken (look in the assets list for the aToken address)
6. factor_add_vault_token with type: "asset", tokenAddress: <aToken>, accountingAddress: <from factory>
   → Register the aToken so the vault can track its balance
7. (If borrowing) factor_add_vault_token with type: "debt", tokenAddress: <variableDebtToken>, accountingAddress: <from factory debts>
   → Register the debt token for borrowing
8. factor_lend_supply with protocol: "aave", assetAddress: <underlying>, amount (or "all")
   → Supply the underlying asset to Aave through the vault
```

### Prepare Vault for Compound V3 Lending (Full Setup)
Compound V3 requires TWO adapters and a market registration step before supply.
```
1. factor_get_lending_tokens with protocol: "compoundV3", underlyingAsset: "<USDC_ADDRESS>"
   → Returns baseAssetAddress (cToken/market address), underlying info
2. factor_get_address_book
   → Find factor_compound_v3_adapter_pro AND factor_compound_v3_market_adapter_pro
3. factor_get_vault_info to check current vault state
4. factor_add_adapter for factor_compound_v3_adapter_pro (if missing)
5. factor_add_adapter for factor_compound_v3_market_adapter_pro (if missing)
   → BOTH adapters are required: the main adapter for supply/withdraw, the market adapter for market registration
6. factor_get_factory_addresses
   → Find the correct accounting for the cToken (e.g., cUSDCv3) in assets[]
7. factor_add_vault_token with type: "asset", tokenAddress: <cToken>, accountingAddress: <from factory>
8. factor_execute_manager to register the market:
   → steps: [{ protocol: "compoundV3", action: "addMarketToAsset", params: { marketAddress: "<cToken>", assetAddress: "<underlying>" }}]
   → This goes through the market adapter and is REQUIRED before any supply/withdraw
9. factor_lend_supply with protocol: "compoundV3", marketAddress: <cToken>, assetAddress: <underlying>, amount (or "all")
```

### Prepare Vault for Morpho Lending (Full Setup)
Morpho requires: (1) Morpho adapter + market adapter, (2) BOTH collateral AND loan tokens registered as vault assets with **Chainlink accounting**, (3) market registered via `addMarketToAssetAndDebt`. All of this MUST be done BEFORE any supply/withdraw/borrow/repay.

**IMPORTANT - Market Selection**: NEVER pick a Morpho market automatically. Always:
1. Present available markets to the user (from `factor_get_lending_tokens`)
2. Provide the Morpho interface link for the relevant chain so the user can review:
   - Base: https://app.morpho.org/?network=base
   - Ethereum: https://app.morpho.org/?network=mainnet
   - Arbitrum: https://app.morpho.org/?network=arbitrum
3. Wait for the user to confirm which market they want before proceeding
4. Run ALL pre-flight checks (step 5 below) before any on-chain action

```
1. factor_get_lending_tokens with protocol: "morpho", underlyingAsset: "<TOKEN_ADDRESS>"
   → Returns marketId, loanToken, collateralToken for each market
   → Present the list to the user with market details and link to Morpho interface
   → WAIT for user to choose a market before continuing

2. factor_get_address_book
   → Find factor_morpho_adapter_pro, factor_morpho_market_adapter_pro, factor_chainlink_accounting_adapter_pro

3. Pre-flight checks - verify ALL tokens are supported BEFORE any on-chain action:
   a. Chainlink price feed check: for EACH token (collateral + loan), call:
      factor_cast_call with to: <chainlink_accounting_adapter>, signature: "getPriceDetails(address)((uint256,uint8,uint8))", args: ["<token_address>"]
      → If it returns price data, the token has a Chainlink feed
      → If it reverts with ACC_CHAINLINK__OracleNotFound(), there is NO feed - STOP and inform the user
   b. Factory whitelist check:
      factor_get_factory_addresses → verify each token + chainlink accounting pair exists in the assets list
      → If a token is NOT in the factory whitelist - STOP and inform the user
   c. Only proceed if ALL tokens pass both checks

4. factor_add_adapter for factor_morpho_adapter_pro (if missing)
5. factor_add_adapter for factor_morpho_market_adapter_pro (if missing)
   → BOTH adapters are required

6. Register BOTH collateral and loan tokens as vault assets (if not already):
   factor_add_vault_token with type: "asset", tokenAddress: <collateralToken>, accountingAddress: <chainlink_accounting>
   factor_add_vault_token with type: "asset", tokenAddress: <loanToken>, accountingAddress: <chainlink_accounting>
   → Both tokens MUST be vault assets before addMarketToAssetAndDebt will work
   → Always verify tx success with factor_get_transaction_status

7. Register the market (REQUIRED before any supply/withdraw/borrow/repay):
   factor_execute_manager with steps: [{ protocol: "morpho", action: "addMarketToAssetAndDebt", params: { marketId: "<MARKET_ID>" }}]
   → This registers the Morpho market in the vault
   → Verify tx success - if it reverts with INVALID_ASSET, a token from step 6 is missing

8. factor_lend_supply with protocol: "morpho", marketId: "<MARKET_ID>", amount (or "all")
```
**IMPORTANT**:
- `addMarketToAssetAndDebt` validates that BOTH the collateral token AND the loan token are already registered as vault assets. If either is missing, the call will revert with `INVALID_ASSET`.
- NEVER supply to a Morpho market without completing step 7 (`addMarketToAssetAndDebt`) first. Without market registration, supply may partially work but withdraw will be impossible, locking funds.
- Always verify every transaction succeeded before proceeding to the next step.

### Lending Quick Reference
Once the vault is set up (adapter + tokens + market registered), use these tools directly:
```
Supply to Aave:       factor_lend_supply with protocol: "aave", assetAddress, amount
Supply to Compound:   factor_lend_supply with protocol: "compoundV3", marketAddress, assetAddress, amount
Supply to Morpho:     factor_lend_supply with protocol: "morpho", marketId, amount (Base/Ethereum only)
Supply to Morpho (collateral): factor_lend_supply with protocol: "morpho", marketId, amount, collateral: true

Withdraw, borrow, and repay follow the same pattern with factor_lend_withdraw, factor_lend_borrow, factor_lend_repay.
```

### Swap Quick Reference
```
OpenOcean (preferred):     factor_swap_openocean with tokenIn, tokenOut, amount ("all", "50%", or wei). Auto-fetches best route.
Uniswap V3 exact input:   factor_swap_uniswap with tokenIn, tokenOut, amount, fee (default 3000). Not on Base.
Uniswap V3 exact output:  factor_swap_uniswap_exact_output with tokenIn, tokenOut, amountOut, amountInMax, fee. Not on Base.
Pendle PT/YT swap:         factor_swap_pendle with marketAddress, direction, tokenAddress, amount, approxParams
```

### LP Quick Reference
```
Create position:    factor_lp_create_position with protocol (uniswapV3), token0, token1, amounts, tickLower, tickUpper (Ethereum only)
Add liquidity:      factor_lp_add_liquidity with protocol, tokenId, amount0, amount1
Remove liquidity:   factor_lp_remove_liquidity with protocol, tokenId, liquidity ("all" or amount)
Collect fees:       factor_lp_collect_fees with protocol, tokenId
```

**Amount format** (for supply, withdraw, and repay):
- Specific amount in base units (wei): `"1000000"` (1 USDC)
- Entire balance: `"all"`
- Percentage of balance: `"50%"`, `"25.5%"`, etc. (0-100%)

### Lending Workflow Example (Aave Leverage)
```
1. (Setup: ensure vault has Aave adapter + aToken asset + debtToken debt - see "Prepare Vault for Aave Lending")
2. factor_lend_supply - Supply USDC as collateral to Aave
3. factor_lend_borrow - Borrow WETH against the collateral
4. (swap WETH -> USDC via factor_execute_manager if desired)
5. factor_lend_repay - Repay the WETH debt (use amount "all" to repay fully)
6. factor_lend_withdraw - Withdraw the USDC collateral (use amount "all" to withdraw fully)
```

### Manage Vault Configuration
```
Fee management (owner only):
  factor_set_deposit_fee with vaultAddress, feeBps (0-10000)
  factor_set_withdraw_fee with vaultAddress, feeBps (0-10000)
  factor_set_performance_fee with vaultAddress, feeBps (0-10000)
  factor_set_management_fee with vaultAddress, feeBps (0-10000)
  factor_charge_performance_fee with vaultAddress (callable by anyone)
  factor_set_fee_receiver with vaultAddress, receiverAddress

Risk management (owner only):
  factor_set_max_cap with vaultAddress, maxCap (base units, 0 = no cap)
  factor_set_max_debt_ratio with vaultAddress, maxDebtRatioBps (0-10000)
  factor_set_price_deviation_allowance with vaultAddress, allowanceBps (0-10000)

Manager management (owner only):
  factor_add_vault_manager with vaultAddress, managerAddress
  factor_remove_vault_manager with vaultAddress, managerAddress
  factor_set_risk_manager with vaultAddress, managerAddress
```
**Note**: These are direct vault calls (NOT wrapped in executeByManager). All fee/risk/manager params use basis points where 10000 = 100%.

### Add an Adapter to a Vault
```
1. factor_get_factory_addresses to find whitelisted adapter addresses
2. factor_add_adapter with vaultAddress and adapterAddress
   - This calls AdapterManagementAdapter.addAdapter() via executeByManager
   - The adapter must be whitelisted in the factory
3. factor_get_vault_info to verify the adapter was added
```

### Execute Manager Strategy
```
1. factor_list_adapters to see available protocols
2. Build steps with protocol, action, and params
3. factor_execute_manager with vault address and steps array
```

### Create a New Vault (Guided Flow — Recommended)
`factor_vault_templates` supports a guided mode that walks the user through vault creation with dynamically fetched token options.
```
1. factor_vault_templates with NO params
   → Returns a questionnaire with 3 questions:
     a. "What kind of vault?" → index_fund, lending, or general
     b. "Which tokens for your strategy?" → list of all whitelisted tokens on the chain (fetched live)
     c. "What tokens can users deposit/withdraw?" → subset of strategy tokens
   → Present these to the user and collect answers

2. factor_vault_templates with vaultType, strategyTokens, depositWithdrawTokens
   → Returns a ready-to-use template with createVaultParams tailored to the answers
   → For lending vaults, auto-detects the best lending protocol

3. factor_give_approval with the approvalStep params
4. factor_create_vault with the createVaultParams
5. Use factor_get_transaction_status to check the result
6. Follow any postDeploySteps (e.g., market registration for Compound/Morpho)
```

### Create a New Vault (Direct Flow)
```
1. factor_vault_templates with denominator (e.g., "USDC") and optionally lendingProtocol
   - Returns ready-to-use createVaultParams and approvalStep for each denominator (USDC, USDT, WETH)
2. factor_give_approval with the approvalStep params to approve the denominator token for the factory
3. factor_create_vault with the createVaultParams (customize name/symbol as needed)
   - Accounting adapters are auto-detected from factory
   - Validation runs before deployment to catch issues
   - If allowance is insufficient, returns an INSUFFICIENT_ALLOWANCE error with approvalHint
4. Use factor_get_transaction_status to check the result
```

### Create a Vault with Lending (Aave — Single Transaction)
Use `factor_vault_templates` with `lendingProtocol: "aave"` to get a template with the Aave adapter, aToken, and debt token pre-configured. The vault deploys fully ready for lending — no separate adapter/token registration needed.
```
1. factor_vault_templates with lendingProtocol: "aave", denominator: "USDC"
   → Returns createVaultParams with initialManagerAdapters (Aave adapter),
     initialAssetAddresses (USDC + aToken), initialDebtAddresses (variableDebtToken),
     and postDeploySteps with exact tool calls
2. factor_give_approval with the approvalStep params
3. factor_create_vault with the createVaultParams
   → Vault deploys with Aave adapter + aToken + debtToken already configured
4. factor_deposit to add funds to the vault
5. factor_lend_supply with protocol: "aave" to supply to Aave
```

### Create a Vault with Lending (Compound V3 — Single Transaction + Market Registration)
Use `factor_vault_templates` with `lendingProtocol: "compoundV3"`. The vault deploys with both Compound V3 adapters and cToken pre-configured. One post-deploy step (market registration) is still required before supply.
```
1. factor_vault_templates with lendingProtocol: "compoundV3", denominator: "USDC"
   → Returns createVaultParams with initialManagerAdapters (Compound V3 adapter + market adapter),
     initialAssetAddresses (USDC + cToken), and postDeploySteps
2. factor_give_approval with the approvalStep params
3. factor_create_vault with the createVaultParams
4. factor_execute_manager with the registerMarket step from postDeploySteps (REQUIRED before supply)
5. factor_deposit to add funds to the vault
6. factor_lend_supply with protocol: "compoundV3" to supply
```

### Create a Vault with Lending (Morpho — Single Transaction + Market Selection)
Use `factor_vault_templates` with `lendingProtocol: "morpho"`. The vault deploys with both Morpho adapters and all relevant tokens pre-registered with Chainlink accounting. The user must choose a market before supply.
```
1. factor_vault_templates with lendingProtocol: "morpho", denominator: "USDC"
   → Returns createVaultParams with initialManagerAdapters (Morpho adapter + market adapter),
     initialAssetAddresses (all related tokens with Chainlink accounting),
     lending.availableMarkets (list of markets to choose from), and postDeploySteps
2. Present lending.availableMarkets to the user — NEVER auto-select a Morpho market
3. factor_give_approval with the approvalStep params
4. factor_create_vault with the createVaultParams
5. factor_execute_manager with addMarketToAssetAndDebt for the user's chosen marketId (REQUIRED)
6. factor_deposit to add funds to the vault
7. factor_lend_supply with protocol: "morpho", marketId: "<chosen>" to supply
```

### Save a Strategy
```
1. factor_wallet_setup with model_name (LLM self-identifies its model name)
2. factor_save_strategy with name, description, strategy (steps array or canvas object), vault_address, chain (auto from config)
   → Returns strategy hash for future reference
3. factor_get_strategy with hash to verify it was saved
```

### Get Strategies for an Address
```
1. factor_get_strategies with chainId and owner address
   → Returns all strategies owned by that address on that chain
```

### Debug a Failed Transaction (Requires Foundry)
```
1. factor_check_foundry to verify Foundry is installed
2. factor_simulate_transaction to test on forked network
3. factor_decode_error to understand revert reasons
```

### Fork Simulation with Forge Scripts
When a write operation fails with `INSUFFICIENT_BALANCE` or `INSUFFICIENT_ALLOWANCE`, the error includes a `simulationHint` pointing to `factor_run_forge_script` with a ready-to-use Solidity script. The script uses forge-std cheatcodes to set both ETH and ERC20 balances, then executes the full flow on a forked network.
```
1. Call any write tool (factor_create_vault, factor_deposit, etc.)
   → If wallet has insufficient balance/allowance, error returns simulationHint with scriptContent
2. factor_run_forge_script with the provided scriptContent
   → Forks the network, sets balances via deal(), executes all transactions
3. Review simulation result (success/revert, gas used, traces)
```

### Fork Simulation with Balance Overrides (Simple)
For simpler cases, `factor_simulate_transaction` can fork the network and override ETH balances before executing raw calldata.
```
1. factor_simulate_transaction with balanceOverrides and steps
2. Review simulation result
```

## Configuration

Config file: `~/.factor-mcp/config.json`

```json
{
  "alchemyApiKey": "your-api-key",
  "defaultChain": "ARBITRUM_ONE",
  "simulationMode": false,
  "logLevel": "info",
  "activeWallet": "default",
  "environment": "testing"
}
```

### Wallet Storage

Wallets can be stored in two locations:

- **Foundry keystore** (default): `~/.foundry/keystores/{name}` - Web3 Secret Storage V3 format, compatible with `cast`, `geth`, and other Ethereum tools
- **Factor-MCP** (legacy): `~/.factor-mcp/wallets/{name}.json` - Custom encryption format

The `factor_wallet_setup` tool accepts a `storageType` parameter:
- `"factor-mcp"` (default) - Supports optional password encryption (AES-256-GCM)
- `"foundry-keystore"` - Requires password, stores in Foundry-compatible V3 keystore

To use an existing Foundry keystore (e.g. created with `cast wallet import`), set `useExistingFoundryKeystore: true`.

Wallet lookup checks both locations automatically (factor-mcp first, then Foundry).

## Security Notes

- Foundry keystore wallets use Web3 Secret Storage V3 (scrypt + AES-128-CTR)
- Legacy factor-mcp wallets are stored at `~/.factor-mcp/wallets/`
- All keystore files have 0600 permissions (owner read/write only)
- Passwords are never passed as CLI arguments
- MAC verification is performed before decryption
- Use password encryption for production wallets
- Simulation mode (default: true) prevents accidental transactions
- Set `simulationMode: false` to execute real transactions

## Environment Variables

- `ALCHEMY_API_KEY` - Alchemy API key for RPC access
- `RPC_URL` - Custom RPC URL (overrides Alchemy)
- `WALLET_PASSWORD` - Wallet password (not recommended for production)
- `FACTOR_ENVIRONMENT` - Set to `production`, `staging`, or `testing`
- `SIMULATION_MODE` - Set to `true` or `false`
- `LOG_LEVEL` - Set to `debug`, `info`, `warn`, or `error`
- `FACTOR_ARTIFACTS_DIR` - Directory to persist forge scripts generated by simulation hints (e.g. `/bowie/artifacts` in Docker). When set, scripts saved via `scriptRef` are also copied to `<FACTOR_ARTIFACTS_DIR>/forge-scripts/`. Useful for inspecting generated Solidity after the MCP process ends.

## SDK Integration

This MCP server wraps the `@factordao/sdk-studio` package:
- `StudioProVault` - Vault operations (deposit, withdraw, execute)
- `StudioProVaultStats` - Vault statistics, subgraph queries, and factory address lookups
- `StudioProFactory` - Vault deployment and configuration validation
- `StrategyBuilder` - Strategy composition with adapters

## Troubleshooting

### "Foundry not installed" errors
Some advanced features require Foundry. Install it with:
```bash
curl -L https://foundry.paradigm.xyz | bash && foundryup
```

### "Asset not whitelisted" errors
Use `factor_get_factory_addresses` to see which assets and accounting adapters are valid for the current environment.

### Transaction simulation failures
Use `factor_simulate_transaction` (requires Foundry) to test transactions on a forked network before sending real transactions.

### Decoding error data
Use `factor_decode_error` with the error data from a failed transaction to understand the revert reason.

## Stateless Mode

Stateless mode (`STATELESS_MODE=true`) is designed for multi-tenant MCP Gateway deployments where a single server process handles requests from many users concurrently. It eliminates all global state mutation.

### How it works

- **AsyncLocalStorage pattern**: `ConfigManager` in `src/config/index.ts` uses Node.js `AsyncLocalStorage<RequestContext>` to store per-request context. The `RequestContext` type carries `chainId` (number) and `environment` (production/staging/testing).
- **Per-request wrapping**: In `src/server.ts`, the `CallToolRequest` handler extracts `chainId` and `environment` from tool arguments, then wraps the tool handler in `configManager.runWithContext(ctx, execute)`. All downstream config reads resolve from this context.
- **Config getters read context first**: `getChain()`, `getChainId()`, `getRpcUrl()`, `getEnvironment()` all check `AsyncLocalStorage` before falling back to global config. If stateless mode is enabled and no context is found, they throw with a clear error.
- **Setters throw**: `setChain()`, `setRpcUrl()` throw in stateless mode to prevent accidental global state mutation from concurrent requests.

### What changes in stateless mode

- **No wallet needed**: `sendTransaction()` in `src/wallet/signer.ts` returns unsigned calldata (`{ to, data, value, chainId }`) instead of signing. The gateway or frontend handles signing externally.
- **Gas estimation skipped**: `estimateGas()` returns zeroed values in stateless mode since the server does not have access to the signer's balance.
- **Allowance check skipped in `factor_create_vault`**: The initial deposit allowance check is bypassed (`!configManager.isStateless()` guard in `src/tools/vault/create-vault.ts`) because sponsorship or external approval handles this.
- **`ownerAddress` / `feeReceiverAddress` parameters**: `factor_create_vault` requires `ownerAddress` in stateless mode -- this is the wallet address that will own the vault. `feeReceiverAddress` is optional and defaults to `ownerAddress`/the local wallet, but callers can pass it when fee revenue must go elsewhere. Without a local wallet, the tool cannot derive the owner address automatically. **`getWalletAddress('__stateless__')` throws** instead of returning a placeholder. Previously it returned `0x0000000000000000000000000000000000000001`, which would silently leak into vault `feeReceiver` and `owner` fields whenever a caller forgot to pass `ownerAddress`. The hard failure forces explicit ownership at the call site. **Order matters in the handler**: `create-vault.ts` checks `configManager.isStateless()` BEFORE `getWalletName()` and BEFORE `getWalletAddress()`. A previous version checked `walletName` first, but `getWalletName()` returns the truthy placeholder string `'__stateless__'` in stateless mode, which made the wallet branch fire and immediately throw from `getWalletAddress` -- the stateless `ownerAddress` branch was unreachable. Same trap could exist in any other write tool that resolves user identity the same way.
- **Per-request client creation**: `getClient()` in `src/sdk/client.ts` creates a fresh `PublicClient` on every call in stateless mode instead of using the global singleton cache. This prevents concurrent requests with different `chainId` values from seeing stale chain/RPC configurations.
- **Simulation mode always true**: `isSimulationMode()` always returns `true` in stateless mode since the server cannot broadcast transactions.
- **`chainId` resolution via `getChainByChainId()`**: `src/config/chains.ts` exports `getChainByChainId(chainId)` which maps numeric chain IDs (42161, 8453, 1) to viem `Chain` objects. This is used throughout stateless mode to resolve chain config from the per-request `chainId`.
