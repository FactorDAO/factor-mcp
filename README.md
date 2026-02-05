# Factor MCP Server

An MCP (Model Context Protocol) server that enables AI tools to interact with Factor Protocol vaults on EVM chains.

## Features

- **18 MCP Tools** for complete vault management
- **Multi-chain Support**: Arbitrum One, Base, Ethereum Mainnet
- **Secure Wallet Management**: AES-256-GCM encryption
- **Simulation Mode**: Preview transactions before execution
- **Strategy Building**: Compose DeFi strategies using building blocks

## Quick Start

### Installation

```bash
# Clone and install
cd factor-mcp
npm install

# Build
npm run build
```

### Configuration

The server uses JSON configuration stored at `~/.factor-mcp/config.json`:

```json
{
  "alchemyApiKey": "your_api_key",
  "defaultChain": "ARBITRUM_ONE",
  "simulationMode": false,
  "logLevel": "info",
  "activeWallet": "default"
}
```

Environment variables can override JSON config:
- `ALCHEMY_API_KEY` - Alchemy API key for RPC access
- `DEFAULT_CHAIN` - Default chain (ARBITRUM_ONE, OPTIMISM, BASE, SONIC, MAINNET)
- `SIMULATION_MODE` - Set to "true" for dry-run mode
- `LOG_LEVEL` - Logging level (debug, info, warn, error)

### Running

```bash
# Direct execution
npm start

# Or with environment variables
ALCHEMY_API_KEY=xxx npm start
```

### Claude Code Integration

Add to your Claude Code config (`~/.config/claude-code/config.json` or MCP settings):

```json
{
  "mcpServers": {
    "factor": {
      "command": "node",
      "args": ["/path/to/factor-mcp/dist/index.js"],
      "env": {
        "ALCHEMY_API_KEY": "your_api_key"
      }
    }
  }
}
```

## Tools Reference

### Configuration (4 tools)

| Tool | Description |
|------|-------------|
| `factor_set_chain` | Set active chain (ARBITRUM_ONE, BASE, MAINNET) |
| `factor_set_rpc` | Configure custom RPC endpoint |
| `factor_get_config` | Get current configuration |
| `factor_wallet_setup` | Import/generate wallet with optional encryption |

### Vault Operations (7 tools)

| Tool | Description |
|------|-------------|
| `factor_list_positions` | List user's vault positions |
| `factor_get_vault_info` | Get detailed vault information |
| `factor_create_vault` | Deploy new Studio Pro vault |
| `factor_preview_deposit` | Preview deposit (read-only) |
| `factor_deposit` | Execute deposit |
| `factor_preview_withdraw` | Preview withdrawal (read-only) |
| `factor_withdraw` | Execute withdrawal |

### Strategy Building (5 tools)

| Tool | Description |
|------|-------------|
| `factor_list_adapters` | List protocol adapters (Aave, Morpho, etc.) |
| `factor_list_building_blocks` | List strategy blocks (LEND, BORROW, SWAP, etc.) |
| `factor_build_strategy` | Build multi-step strategy |
| `factor_simulate_strategy` | Simulate before execution |
| `factor_execute_strategy` | Execute built strategy |

### Transaction (2 tools)

| Tool | Description |
|------|-------------|
| `factor_preview_transaction` | Preview tx with gas estimate |
| `factor_get_transaction_status` | Check tx status by hash |

## Security

### Wallet Storage

Wallets are stored at `~/.factor-mcp/wallets/`:
- File permissions: 0o600 (owner read/write only)
- Optional AES-256-GCM encryption with password
- PBKDF2 key derivation (100,000 iterations)

### Best Practices

1. **Always use encryption for production wallets**
   ```
   factor_wallet_setup with password parameter
   ```

2. **Use simulation mode for testing**
   ```json
   { "simulationMode": true }
   ```

3. **Never commit wallet files or API keys**

## Docker Deployment

```bash
# Build image
docker build -t factor-mcp .

# Run with docker-compose
docker-compose up -d
```

## Development

```bash
# Install dependencies
npm install

# Type checking
npm run typecheck

# Build
npm run build

# Run in dev mode
npm run dev
```

## License

MIT
