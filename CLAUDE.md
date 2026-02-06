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

## Available Tools (34 total)

### Configuration (5 tools)
- `factor_get_config` - View current configuration (chain, RPC, wallet, simulation mode, environment)
- `factor_set_chain` - Switch chain (ARBITRUM_ONE, BASE, MAINNET)
- `factor_set_rpc` - Set custom RPC endpoint
- `factor_wallet_setup` - Import or generate a wallet
- `factor_get_address_book` - Get SDK address book (Pro adapters only) for the current chain and environment

### Tokenlist (2 tools)
- `factor_get_lending_tokens` - Look up lending token info (aTokens, debt tokens, underlying assets) for Aave, Compound V3, or Morpho from the tokenlist
- `factor_add_vault_token` - Add an asset or debt token to a vault with the correct accounting adapter (uses AssetDebtAdapter via executeByManager)

### Vault Operations (13 tools)
- `factor_get_owned_vaults` - List vaults owned by an address
- `factor_get_vault_info` - Get detailed vault information (assets, fees, managers, adapters)
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

### Lending Operations (4 tools)
- `factor_lend_supply` - Supply/deposit assets to a lending protocol (Aave, Compound V3, Morpho)
- `factor_lend_withdraw` - Withdraw supplied assets from a lending protocol
- `factor_lend_borrow` - Borrow assets from a lending protocol
- `factor_lend_repay` - Repay borrowed assets to a lending protocol

### Strategy Building (4 tools)
- `factor_list_adapters` - List available protocol adapters
- `factor_build_strategy` - Build a multi-step strategy
- `factor_simulate_strategy` - Simulate a strategy
- `factor_execute_strategy` - Execute a strategy

### Transactions (2 tools)
- `factor_preview_transaction` - Preview with gas estimate
- `factor_get_transaction_status` - Check transaction status

### Foundry Tools (4 tools) - *Requires Foundry*
- `factor_check_foundry` - Check if Foundry suite (cast, anvil, forge) and Rust are installed
- `factor_cast_call` - Execute read-only contract calls using `cast`
- `factor_simulate_transaction` - Simulate transactions on forked network using `anvil`
- `factor_decode_error` - Decode contract errors and revert reasons

## Architecture Rules

- **All vault interactions go through `executeByManager`**: Every on-chain operation on a vault (lending, swapping, adding adapters, etc.) is executed via the `proVault.executeByManager([blocks])` pattern. The SDK's `StrategyBuilder` generates the encoded blocks, and `StudioProVault.executeByManager()` wraps them in a manager call.
- **Adding adapters uses `AdapterManagementAdapter`**: To add a new protocol adapter to a vault, call `strategyBuilder.adapter.adapterManagement.addAdapter(adapterAddress)` and execute it via `proVault.executeByManager([block])`. The adapter must be whitelisted in the factory.

## Common Workflows

### Setup Wallet (Foundry Keystore - Default)
```
1. factor_wallet_setup with privateKey and password (stores in ~/.foundry/keystores/)
2. factor_get_config to verify wallet is active
```

### Use Existing Foundry Keystore
```
1. factor_wallet_setup with name and useExistingFoundryKeystore: true
2. Password will be required for all write operations (deposit, withdraw, etc.)
```

### Setup Wallet (Legacy Factor-MCP)
```
1. factor_wallet_setup with privateKey, password, and storageType: "factor-mcp"
2. factor_get_config to verify wallet is active
```

### Deposit to Vault
```
1. factor_get_vault_info to check vault details and valid deposit assets
2. factor_preview_deposit to see expected shares
3. factor_deposit to execute (needs password if encrypted)
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
Morpho requires a market registration step before supply.
```
1. factor_get_lending_tokens with protocol: "morpho"
   → Returns marketId, loanToken, collateralToken for each market
2. factor_get_address_book
   → Find factor_morpho_adapter_pro (and market adapter if applicable)
3. factor_add_adapter for the Morpho adapter (if missing)
4. factor_execute_manager to register the market:
   → steps: [{ protocol: "morpho", action: "addMarketToAssetAndDebt", params: { marketId: "<MARKET_ID>" }}]
   → This registers both asset and debt for the Morpho market in one call
5. factor_lend_supply with protocol: "morpho", marketId: "<MARKET_ID>", amount (or "all")
```

### Lending Quick Reference
Once the vault is set up (adapter + tokens + market registered), use these tools directly:
```
Supply to Aave:     factor_lend_supply with protocol: "aave", assetAddress, amount (or "all")
Supply to Compound: factor_lend_supply with protocol: "compoundV3", marketAddress, assetAddress, amount (or "all")
Supply to Morpho:   factor_lend_supply with protocol: "morpho", marketId, amount (or "all")

Withdraw, borrow, and repay follow the same pattern with factor_lend_withdraw, factor_lend_borrow, factor_lend_repay.
```

### Lending Workflow Example (Aave Leverage)
```
1. (Setup: ensure vault has Aave adapter + aToken asset + debtToken debt - see "Prepare Vault for Aave Lending")
2. factor_lend_supply - Supply USDC as collateral to Aave
3. factor_lend_borrow - Borrow WETH against the collateral
4. (swap WETH -> USDC via factor_execute_manager if desired)
5. factor_lend_repay - Repay the WETH debt (use amount "all" to repay fully)
6. factor_lend_withdraw - Withdraw the USDC collateral (use amount "all" to withdraw fully)
```

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

### Create a New Vault
```
1. factor_get_factory_addresses to see available assets and adapters
2. factor_create_vault with name, symbol, assetDenominatorAddress
   - Accounting adapters are auto-detected from factory
   - Validation runs before deployment to catch issues
3. Use factor_get_transaction_status to check the result
```

### Debug a Failed Transaction (Requires Foundry)
```
1. factor_check_foundry to verify Foundry is installed
2. factor_simulate_transaction to test on forked network
3. factor_decode_error to understand revert reasons
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
- `"foundry-keystore"` (default) - Requires password, stores in Foundry-compatible V3 keystore
- `"factor-mcp"` - Legacy storage, supports optional password encryption

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
