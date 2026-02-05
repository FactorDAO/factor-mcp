# Factor Protocol MCP Server

An MCP (Model Context Protocol) server that enables AI tools to interact with Factor Protocol DeFi vaults on EVM chains.

## Features

- **28 MCP Tools** for complete vault management
- **Multi-chain Support**: Arbitrum One, Base, Ethereum Mainnet
- **Secure Wallet Management**: AES-256-GCM encryption
- **Simulation Mode**: Preview transactions before execution
- **Strategy Building**: Compose DeFi strategies using building blocks

## Quick Start

### 1. Get an Alchemy API Key

Sign up at [alchemy.com](https://www.alchemy.com/) to get a free API key.

### 2. Configure in Docker Desktop

Add Factor MCP from the Docker MCP catalog and configure your Alchemy API key.

### 3. Start Using

Once configured, you can:
- Create and manage DeFi vaults
- Deposit and withdraw assets
- Execute trading strategies (swaps, lending, borrowing)
- Monitor vault performance

## Tools Overview

### Configuration (4 tools)
- `factor_get_config` - View current configuration
- `factor_set_chain` - Switch chains (Arbitrum, Base, Ethereum)
- `factor_set_rpc` - Set custom RPC endpoint
- `factor_wallet_setup` - Import or generate wallet

### Vault Operations (13 tools)
- `factor_get_owned_vaults` - List your vaults
- `factor_get_vault_info` - Get vault details
- `factor_create_vault` - Deploy new vault
- `factor_deposit` / `factor_withdraw` - Manage positions
- `factor_execute_manager` - Execute DeFi strategies
- And more...

### Strategy Building (5 tools)
- `factor_list_adapters` - Available DeFi protocols
- `factor_build_strategy` - Compose strategies
- `factor_simulate_strategy` - Test before execution
- `factor_execute_strategy` - Execute on-chain

### Foundry Tools (4 tools)
- `factor_cast_call` - Read contract state
- `factor_simulate_transaction` - Test on forked network
- `factor_decode_error` - Debug reverts

## Security

- Wallet private keys are encrypted with AES-256-GCM
- PBKDF2 key derivation (100,000 iterations)
- Simulation mode for safe testing

## Documentation

Full documentation: [github.com/FactorDAO/factor-mcp](https://github.com/FactorDAO/factor-mcp)

## License

MIT
