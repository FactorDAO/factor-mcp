# Factor MCP Server - Claude Code Skills

This is an MCP server for managing Factor Protocol DeFi vaults using the `@factordao/sdk-studio`.

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

## Available Tools (27 total)

### Configuration (4 tools)
- `factor_get_config` - View current configuration (chain, RPC, wallet, simulation mode, environment)
- `factor_set_chain` - Switch chain (ARBITRUM_ONE, BASE, MAINNET)
- `factor_set_rpc` - Set custom RPC endpoint
- `factor_wallet_setup` - Import or generate a wallet

### Vault Operations (12 tools)
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

### Strategy Building (5 tools)
- `factor_list_adapters` - List available protocol adapters
- `factor_list_building_blocks` - List strategy building blocks
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

## Common Workflows

### Setup Wallet
```
1. factor_wallet_setup with privateKey and optional password
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

Wallet files: `~/.factor-mcp/wallets/{name}.json`

## Security Notes

- Wallet private keys are stored at `~/.factor-mcp/wallets/`
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
