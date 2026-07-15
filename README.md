# Factor MCP Server

An MCP (Model Context Protocol) server that enables AI tools to interact with Factor Protocol vaults on EVM chains.

## Features

- **68 MCP Tools** for complete vault management
- **Multi-chain Support**: Arbitrum One, Base, Ethereum Mainnet
- **Secure Wallet Management**: Foundry Keystore (Web3 V3) + AES-256-GCM encryption
- **Simulation Mode**: Preview transactions before execution
- **Strategy Building**: Compose DeFi strategies using building blocks
- **Foundry Integration**: Fork simulation, error decoding, forge scripts

## Operating Modes

### stdio (standard MCP)

The default mode. The server runs as a local process, communicates over stdin/stdout, and maintains global state (active chain, wallet, environment) across tool calls. Use `factor_set_chain` to switch chains and `factor_wallet_setup` to configure a wallet.

### Stateless (for MCP Gateway integration)

Designed for multi-tenant gateways where many users share one server process. No global state is mutated -- each tool call carries its own `chainId` and `environment` parameters.

Enable with the environment variable:

```bash
STATELESS_MODE=true node dist/index.js
```

Or set `STATELESS_MODE=true` in the process environment.

**Key differences in stateless mode:**

| Behavior | stdio mode | Stateless mode |
|----------|-----------|---------------|
| Chain selection | `factor_set_chain` mutates global state | `chainId` param on every tool call |
| Environment | Set once via config/env var | `environment` param on every tool call |
| Wallet | Required for write ops | Not needed -- `sendTransaction` returns unsigned calldata |
| Gas estimation | Runs against RPC | Skipped (returns zeroed estimate) |
| Allowance check | Checked before vault creation | Skipped (sponsorship handles approval) |
| Client caching | Singleton `PublicClient` per chain | Fresh client per request (concurrent safety) |
| Simulation mode | Configurable | Always true |

**How it works internally:**

- `ConfigManager` (in `src/config/index.ts`) uses Node.js `AsyncLocalStorage` to store per-request context (`chainId`, `environment`).
- In `server.ts`, each `CallToolRequest` extracts `chainId` and `environment` from tool arguments and wraps the handler in `configManager.runWithContext(ctx, execute)`.
- All config getters (`getChain()`, `getChainId()`, `getRpcUrl()`, `getEnvironment()`) read from `AsyncLocalStorage` first, falling back to global config only in stdio mode.
- State-mutating setters (`setChain()`, `setRpcUrl()`) throw in stateless mode to prevent global mutation.
- `sendTransaction()` in `src/wallet/signer.ts` returns a `calldata` object (`{ to, data, value, chainId }`) instead of signing and broadcasting.
- `factor_create_vault` accepts an `ownerAddress` parameter (required in stateless) to set the vault owner without needing a local wallet. Pass `feeReceiverAddress` when fee revenue must go to a different address.
- `getClient()` in `src/sdk/client.ts` creates a fresh `PublicClient` per call in stateless mode instead of using the global cache, ensuring concurrent requests with different chains do not collide.

## Quick Start

### One-Line Install

```bash
curl -sSL https://raw.githubusercontent.com/FactorDAO/factor-mcp/main/install.sh | bash
```

This will:
- Install Rust (if not present)
- Install Foundry (cast, anvil, forge)
- Clone and build Factor MCP
- Create `factor-mcp` command

### Manual Installation

```bash
git clone https://github.com/FactorDAO/factor-mcp.git
cd factor-mcp
npm install
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
- `DEFAULT_CHAIN` - Default chain (ARBITRUM_ONE, BASE, MAINNET)
- `STATELESS_MODE` - Set to `true` for stateless/gateway mode (per-request `chainId` and `environment`)
- `FACTOR_ENVIRONMENT` - `production`, `staging`, or `testing`
- `SIMULATION_MODE` - Set to `true` for dry-run mode
- `LOG_LEVEL` - Logging level (debug, info, warn, error)
- `FACTOR_ARTIFACTS_DIR` - Persist generated forge scripts to this directory (useful in Docker/ephemeral environments)

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

### Configuration (5 tools)

| Tool | Description |
|------|-------------|
| `factor_set_chain` | Set active chain (ARBITRUM_ONE, BASE, MAINNET) |
| `factor_set_rpc` | Configure custom RPC endpoint |
| `factor_get_config` | Get current configuration |
| `factor_wallet_setup` | Import/generate wallet with optional encryption |
| `factor_get_address_book` | Get SDK address book (Pro adapters) for current chain |

### Vault Operations (14 tools)

| Tool | Description |
|------|-------------|
| `factor_vault_templates` | Get ready-to-use vault params (call first when creating vaults) |
| `factor_create_vault` | Deploy new Studio Pro vault |
| `factor_get_owned_vaults` | List vaults owned by an address |
| `factor_get_vault_info` | Get detailed vault information |
| `factor_get_shares` | Get user's shares, total supply, price per share |
| `factor_get_executions` | Get vault execution history with decoded calls |
| `factor_preview_deposit` | Preview deposit (read-only) |
| `factor_deposit` | Execute deposit (auto-approves tokens) |
| `factor_preview_withdraw` | Preview withdrawal (read-only) |
| `factor_withdraw` | Execute withdrawal (redeem shares) |
| `factor_execute_manager` | Execute DeFi strategies as vault manager |
| `factor_get_factory_addresses` | Get whitelisted assets/adapters from factory |
| `factor_validate_vault_config` | Validate vault config before deployment |
| `factor_add_adapter` | Add a manager adapter to a vault |

### Vault Management (12 tools)

| Tool | Description |
|------|-------------|
| `factor_set_deposit_fee` | Set deposit fee (basis points) |
| `factor_set_withdraw_fee` | Set withdrawal fee (basis points) |
| `factor_set_performance_fee` | Set performance fee (basis points) |
| `factor_set_management_fee` | Set annual management fee (basis points) |
| `factor_charge_performance_fee` | Charge accrued performance fee |
| `factor_set_fee_receiver` | Set fee receiver address |
| `factor_set_max_cap` | Set maximum deposit cap |
| `factor_set_max_debt_ratio` | Set maximum debt ratio |
| `factor_set_price_deviation_allowance` | Set price deviation tolerance |
| `factor_add_vault_manager` | Add manager address |
| `factor_remove_vault_manager` | Remove manager address |
| `factor_set_risk_manager` | Set risk manager address |

### Lending Operations (4 tools)

| Tool | Description |
|------|-------------|
| `factor_lend_supply` | Supply assets to Aave, Compound V3, Morpho, Silo V2 |
| `factor_lend_withdraw` | Withdraw supplied assets |
| `factor_lend_borrow` | Borrow assets against collateral |
| `factor_lend_repay` | Repay borrowed assets |

### Swap Operations (4 tools)

| Tool | Description |
|------|-------------|
| `factor_swap` | Uniswap V3 exact input swaps (specify how much to spend) |
| `factor_swap_exact_output` | Uniswap V3 exact output swaps (specify how much to receive) |
| `factor_swap_openocean` | OpenOcean DEX aggregator swaps |
| `factor_swap_pendle` | Pendle PT/YT token swaps |

### LP Operations (4 tools)

| Tool | Description |
|------|-------------|
| `factor_lp_create_position` | Create concentrated liquidity position |
| `factor_lp_add_liquidity` | Add liquidity to existing position |
| `factor_lp_remove_liquidity` | Remove liquidity from position |
| `factor_lp_collect_fees` | Collect accumulated trading fees |

### Yield Operations (1 tool)

| Tool | Description |
|------|-------------|
| `factor_pendle_lp` | Pendle LP (add/remove liquidity, collect fees) |

### Flash Loan (1 tool)

| Tool | Description |
|------|-------------|
| `factor_flashloan` | Execute flash loan strategies (Aave, Morpho) |

### Token & Registry (3 tools)

| Tool | Description |
|------|-------------|
| `factor_give_approval` | Approve ERC20 token for spending |
| `factor_get_lending_tokens` | Look up lending tokens (aTokens, debt tokens) |
| `factor_add_vault_token` | Add asset/debt token to vault with accounting |

### Strategy Building (1 tool)

| Tool | Description |
|------|-------------|
| `factor_list_adapters` | List available protocol adapters (30+) |

### Transaction Tools (2 tools)

| Tool | Description |
|------|-------------|
| `factor_preview_transaction` | Preview tx with gas estimate |
| `factor_get_transaction_status` | Check tx status by hash |

### Profile & Strategy (6 tools)

| Tool | Description |
|------|-------------|
| `factor_save_profile` | Save a user profile (requires wallet signature) |
| `factor_get_profile` | Get a user profile by address (read-only) |
| `factor_save_strategy` | Save or update a vault strategy (requires wallet signature) |
| `factor_delete_strategy` | Delete a saved strategy (requires wallet signature) |
| `factor_get_strategy` | Get a strategy by hash (read-only) |
| `factor_get_strategies` | Get all strategies for an owner on a chain (read-only) |

### Foundry Tools (5 tools)

| Tool | Description |
|------|-------------|
| `factor_check_foundry` | Check Foundry installation |
| `factor_cast_call` | Execute read-only contract calls |
| `factor_simulate_transaction` | Simulate on forked network |
| `factor_decode_error` | Decode contract error data |
| `factor_run_forge_script` | Run Solidity forge scripts |

## Security

### Wallet Storage

Wallets support two backends:
- **Factor-MCP** (default): `~/.factor-mcp/wallets/` — AES-256-GCM encryption, PBKDF2 key derivation (100k iterations)
- **Foundry Keystore**: `~/.foundry/keystores/` — Web3 Secret Storage V3 format, compatible with cast/geth

### Best Practices

1. **Always use encryption for production wallets**
2. **Use simulation mode for testing** (`simulationMode: true`)
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

# Run tests
npm test
```

---

## SDK Coverage Roadmap

This roadmap tracks the MCP server's coverage of the `@factordao/sdk-studio` package. Items marked `[x]` are implemented in the MCP, items marked `[ ]` are SDK features not yet exposed.

---

### Configuration & Wallet

- [x] Set active chain (ARBITRUM_ONE, BASE, MAINNET)
- [x] Set custom RPC endpoint
- [x] Get current config (chain, RPC, wallet, simulation mode)
- [x] Wallet import from private key
- [x] Wallet generation (new random)
- [x] Foundry Keystore storage (Web3 V3 format)
- [x] Factor-MCP encrypted storage (AES-256-GCM)
- [x] Use existing Foundry keystore
- [x] Get SDK address book (Pro adapter addresses)

### Vault Creation & Templates

- [x] Deploy new Factor Pro vault (`factor_create_vault`)
- [x] Vault templates with ready-to-use params (`factor_vault_templates`)
- [x] Lending-ready vault templates (Aave preset)
- [x] Lending-ready vault templates (Compound V3 preset)
- [x] Lending-ready vault templates (Morpho preset)
- [x] Auto-detect accounting adapters from factory
- [x] Validate vault config before deployment (`factor_validate_vault_config`)
- [x] Get whitelisted factory addresses (`factor_get_factory_addresses`)
- [x] Immutable vault option
- [x] Configurable fees, caps, debt ratio, cooldown, upgradeability

### Vault Queries

- [x] Get owned vaults (`factor_get_owned_vaults`)
- [x] Get vault info — assets, fees, managers, adapters (`factor_get_vault_info`)
- [x] Get user shares, total supply, price per share (`factor_get_shares`)
- [x] Get execution history with decoded calls (`factor_get_executions`)
- [x] Preview deposit — expected shares (`factor_preview_deposit`)
- [x] Preview withdrawal — expected assets (`factor_preview_withdraw`)
- [ ] Check if asset is valid deposit asset (`isDepositAsset`)
- [ ] Check if asset is valid withdraw asset (`isWithdrawAsset`)
- [ ] Get asset accounting adapter (`getAssetAccounting`)
- [ ] Get debt accounting adapter (`getDebtAccounting`)
- [ ] Estimate raw withdraw expected amount (`estimateRawWithdrawExpectedAmount`)
- [ ] USD balance breakdown via Alchemy (`balanceUsd`)

### Vault Deposit & Withdrawal

- [x] Deposit ERC20 token (`factor_deposit`)
- [x] Withdraw / redeem shares (`factor_withdraw`)
- [ ] Deposit native token — ETH (`depositNative`)
- [ ] Deposit and execute strategy in one tx (`depositAssetAndExecute`)
- [ ] Raw withdraw with execution blocks (`rawWithdraw`)

### Vault Fee Management

- [x] Set deposit fee (`factor_set_deposit_fee`)
- [x] Set withdraw fee (`factor_set_withdraw_fee`)
- [x] Set performance fee (`factor_set_performance_fee`)
- [x] Set management fee (`factor_set_management_fee`)
- [x] Charge performance fee (`factor_charge_performance_fee`)
- [x] Set fee receiver (`factor_set_fee_receiver`)

### Vault Risk & Access Management

- [x] Set max deposit cap (`factor_set_max_cap`)
- [x] Set max debt ratio (`factor_set_max_debt_ratio`)
- [x] Set price deviation allowance (`factor_set_price_deviation_allowance`)
- [x] Add vault manager (`factor_add_vault_manager`)
- [x] Remove vault manager (`factor_remove_vault_manager`)
- [x] Set risk manager (`factor_set_risk_manager`)

### Vault Strategy Configuration

- [ ] Set public strategy (`setPublicStrategy`)
- [ ] Remove public strategy (`removePublicStrategy`)
- [ ] Execute public strategy (`executePublicStrategy`)
- [ ] Set deposit strategy (`setDepositStrategy`)
- [ ] Remove deposit strategy (`removeDepositStrategy`)

### Vault Simulation

- [ ] Simulate deposit (`simulateDeposit`)
- [ ] Simulate charge performance fee (`simulateChargePerformanceFee`)

### Token & Approval

- [x] ERC20 token approval (`factor_give_approval`)
- [x] Get lending tokens — aTokens, debt tokens, underlying (`factor_get_lending_tokens`)
- [x] Add asset/debt token to vault (`factor_add_vault_token`)
- [ ] ERC2612 permit / gasless approval (`permit` adapter)

### Lending — Aave V3

- [x] Supply / supply all / supply by percentage
- [x] Withdraw / withdraw all
- [x] Borrow
- [x] Repay / repay all

### Lending — Compound V3

- [x] Supply / supply all
- [x] Withdraw / withdraw all
- [x] Borrow
- [x] Repay / repay all
- [ ] Claim rewards (`claimRewards`)

### Lending — Morpho

- [x] Supply (lending)
- [x] Supply as collateral
- [x] Withdraw (lending + collateral)
- [x] Borrow
- [x] Repay / repay all

### Lending — Silo V2

- [x] Supply
- [x] Withdraw
- [x] Borrow
- [x] Repay

### DEX — Uniswap V3

- [x] Exact input single swap (`factor_swap`)
- [x] Swap all balance
- [x] Swap by percentage
- [x] Configurable fee tiers (100, 500, 3000, 10000)
- [x] Configurable slippage
- [x] Exact output single swap (`factor_swap_exact_output`)
- [x] Exact output single with full balance (`factor_swap_exact_output` with amountInMax "all")

### DEX — OpenOcean

- [x] Aggregated swap (`factor_swap_openocean`)

### DEX — Pendle PT/YT

- [x] Token to PT swap
- [x] Token to YT swap
- [x] PT to token swap
- [x] YT to token swap

### DEX — Aqua

- [ ] Aqua DEX swap (Base)

### LP — Uniswap V3

- [x] Create concentrated liquidity position
- [x] Add liquidity to existing position
- [x] Remove liquidity (amount or "all")
- [x] Collect accumulated fees
- [ ] Remove liquidity by percentage (`removeByPercentage`)

### LP — Camelot V3

- [x] Create concentrated liquidity position
- [x] Add liquidity
- [x] Remove liquidity
- [x] Collect fees
- [ ] Remove liquidity by percentage (`removeByPercentage`)

### LP — Aerodrome

- [x] Create concentrated liquidity position
- [x] Add liquidity
- [x] Remove liquidity
- [x] Collect fees

### Yield — Pendle LP

- [x] Add liquidity to Pendle market
- [x] Remove liquidity
- [x] Collect fees/rewards

### Flash Loans

- [x] Aave flash loan with inner strategy steps
- [x] Morpho flash loan with inner strategy steps
- [ ] Balancer flash loan (`balancerFL`)

### Strategy Builder

- [x] Execute strategy via `executeByManager`
- [x] List available adapters (`factor_list_adapters`)
- [x] Save strategy to Stats API (`factor_save_strategy`)
- [x] Delete strategy from Stats API (`factor_delete_strategy`)
- [x] Get strategy by hash (`factor_get_strategy`)
- [x] Get strategies by owner (`factor_get_strategies`)
- [x] Save profile to Stats API (`factor_save_profile`)
- [x] Get profile from Stats API (`factor_get_profile`)
- [ ] Export strategy as calldata (`export`)
- [ ] Export strategy as JSON (`exportToJson`)
- [ ] Clone strategy (`clone`)
- [ ] Debug strategy step-by-step (`debugFromBlocks`)
- [ ] Estimate user impact (`estimate` / `estimateFromBlocks`)
- [ ] Strategy summary (`summary`)
- [ ] Guess token state changes (`guessTokenState`)

### Utility Adapters

- [ ] Transfer tokens between addresses (`transfer` adapter)
- [ ] Refund dust amounts (`refund` adapter)
- [ ] Native token wrap/unwrap (`native` adapter)
- [ ] ERC721 / NFT operations (`erc721` adapter)
- [ ] Leverage vault operations (`leverageVault` adapter)
- [ ] Leverage strategy building (`leverageStrategy` adapter)
- [ ] Deposit policy management (`depositPolicy` adapter)
- [ ] Gelato automation setup (`gelato` adapter)
- [ ] Chainlink direct price feed queries (`chainlink` adapter)

### Adapter Discovery & Metadata

- [x] List adapters by chain (`factor_list_adapters`)
- [ ] Get user portfolio info across adapters (`getUserInfo`)
- [ ] Get markets for building block / protocol (`getMarkets`)
- [ ] Get markets by input token (`getMarketByInToken`)
- [ ] Get protocols by input token (`getProtocolsByInToken`)
- [ ] Get supported input tokens (`getInTokens`)
- [ ] Get adapter metadata (`getMetadata` / `getMetadataByBuildingBlock`)
- [ ] Get all building block types (`getBuildingBlocks`)

### Boost System

- [ ] Add tokens to boost whitelist (`addBoostTokenWhitelist`)
- [ ] Remove tokens from boost whitelist (`removeBoostTokenWhitelist`)
- [ ] Deposit vault reward (`depositRewardForVaultBN`)
- [ ] Redeem boost rewards (`redeemBoostRewards`)
- [ ] Redeem all boost rewards (`redeemBoostRewardAll`)
- [ ] Get boost reward tokens (`getBoostRewardTokens`)
- [ ] Get earned boost tokens by user (`boostEarnedTokensByUser`)
- [ ] Get reward data (`rewardData`)
- [ ] Get reward for duration (`getRewardForDuration`)

### Scale System

- [ ] Get Scale vaults (`getVaults`)
- [ ] Get Scale vault details (`getVaultDetail`)
- [ ] Get user Scale positions (`getUserVaults`)
- [ ] Get user active balance (`activeBalance`)
- [ ] Get total active supply (`totalActiveSupply`)
- [ ] Get Scale reward tokens (`getScaleRewardTokens`)
- [ ] Redeem Scale rewards (`redeemScaleRewards`)
- [ ] Redeem boost + Scale rewards combined (`redeemBoostAndScaleRewards`)
- [ ] Vote on gauge (`vote`)
- [ ] Remove vote (`unvote`)
- [ ] Get user / vault votes
- [ ] Claim Scale rewards (`claimRewards`)
- [ ] Get Scale market data (`getMarketData`)
- [ ] Get historical data (`getHistoricalData`)

### Bribe System

- [ ] Create bribe (`addBribe`)
- [ ] Claim bribe (`claimBribe`)
- [ ] Get bribe info (`getBribe`)
- [ ] Get all bribes (`getAllBribes`)

### Transaction & Debugging

- [x] Preview transaction with gas estimate (`factor_preview_transaction`)
- [x] Check transaction status (`factor_get_transaction_status`)
- [x] Check Foundry installation (`factor_check_foundry`)
- [x] Read-only contract calls via `cast` (`factor_cast_call`)
- [x] Simulate on forked network via `anvil` (`factor_simulate_transaction`)
- [x] Decode contract errors (`factor_decode_error`)
- [x] Run Solidity forge scripts (`factor_run_forge_script`)
- [x] Balance overrides for simulation
- [x] Simulation hints with auto-generated Forge scripts

---

### Pro Adapter Availability

Only `_pro` adapters are used by the MCP server. Adapters without any deployment are excluded from the roadmap.

#### Lending

| Adapter | Arb Prod | Arb Test | Base Prod | Base Test |
|---------|:--------:|:--------:|:---------:|:---------:|
| Aave | ✅ | ✅ | ✅ | ✅ |
| Compound V3 | ✅ | ✅ | ✅ | ✅ |
| Compound V3 Market | ✅ | ✅ | ✅ | ✅ |
| Morpho | - | - | ✅ | ✅ |
| Morpho Market | - | - | ✅ | ✅ |
| Silo V1 | ✅ | ✅ | - | ✅ |
| Silo V2 | - | ✅ | - | - |
| Silo V2 Market | - | ✅ | - | - |

#### DEX

| Adapter | Arb Prod | Arb Test | Base Prod | Base Test |
|---------|:--------:|:--------:|:---------:|:---------:|
| Uniswap | ✅ | ✅ | ✅ | ✅ |
| OpenOcean | ✅ | ✅ | ✅ | ✅ |
| Pendle PY (PT/YT swaps) | ✅ | ✅ | ✅ | ✅ |
| Pendle PY Market | ✅ | ✅ | ✅ | ✅ |
| Aqua | - | - | - | ✅ |

#### LP

| Adapter | Arb Prod | Arb Test | Base Prod | Base Test |
|---------|:--------:|:--------:|:---------:|:---------:|
| Uniswap V3 LP | - | ✅ | - | ✅ |
| Camelot V3 LP | - | ✅ | - | - |
| Aerodrome LP | - | - | - | ✅ |

#### Yield

| Adapter | Arb Prod | Arb Test | Base Prod | Base Test |
|---------|:--------:|:--------:|:---------:|:---------:|
| Pendle | ✅ | ✅ | - | ✅ |

#### Flash Loans

| Adapter | Arb Prod | Arb Test | Base Prod | Base Test |
|---------|:--------:|:--------:|:---------:|:---------:|
| Balancer FL | ✅ | ✅ | ✅ | ✅ |
| Morpho FL | - | - | - | ✅ |

#### Accounting

| Adapter | Arb Prod | Arb Test | Base Prod | Base Test |
|---------|:--------:|:--------:|:---------:|:---------:|
| Chainlink Accounting | ✅ | ✅ | ✅ | ✅ |
| Chainlink Pegged Accounting | ✅ | ✅ | ✅ | ✅ |
| Aave Accounting | ✅ | ✅ | ✅ | ✅ |
| Pendle Accounting | - | ✅ | - | ✅ |
| Pendle PY Accounting | ✅ | - | ✅ | - |
| Compound V3 Collateral Accounting | ✅ | ✅ | - | ✅ |
| Compound V3 Debt Accounting | ✅ | ✅ | - | ✅ |
| Silo V2 Collateral Accounting | - | ✅ | - | - |
| Silo V2 Debt Accounting | - | ✅ | - | - |

#### Infrastructure

| Adapter | Arb Prod | Arb Test | Base Prod | Base Test |
|---------|:--------:|:--------:|:---------:|:---------:|
| Adapter Management | ✅ | ✅ | ✅ | ✅ |
| Asset/Debt | ✅ | ✅ | ✅ | ✅ |
| Deposit Policy | ✅ | - | - | ✅ |
| Gelato | ✅ | ✅ | ✅ | ✅ |
| Boost | ✅ | ✅ | ✅ | ✅ |

> **Note**: Ethereum Mainnet has no pro adapters deployed (only factory + Chainlink accounting in testing).

### Coverage Summary

| Category | Implemented | Total | Coverage |
|----------|------------|-------|----------|
| Configuration & Wallet | 9 | 9 | 100% |
| Vault Creation & Templates | 10 | 10 | 100% |
| Vault Queries | 6 | 12 | 50% |
| Vault Deposit & Withdrawal | 2 | 5 | 40% |
| Vault Fee Management | 6 | 6 | 100% |
| Vault Risk & Access | 6 | 6 | 100% |
| Vault Strategy Config | 0 | 5 | 0% |
| Vault Simulation | 0 | 2 | 0% |
| Token & Approval | 3 | 4 | 75% |
| Lending (Aave, Compound, Morpho, Silo) | 16 | 17 | 94% |
| DEX Swaps | 12 | 13 | 92% |
| LP Operations | 12 | 14 | 86% |
| Yield (Pendle) | 3 | 3 | 100% |
| Flash Loans | 2 | 3 | 67% |
| Strategy Builder | 8 | 14 | 57% |
| Utility Adapters | 0 | 9 | 0% |
| Adapter Discovery | 1 | 8 | 13% |
| Boost System | 0 | 9 | 0% |
| Scale System | 0 | 14 | 0% |
| Bribe System | 0 | 4 | 0% |
| Transaction & Debugging | 9 | 9 | 100% |
| **TOTAL** | **~99** | **~176** | **~56%** |

## License

MIT
