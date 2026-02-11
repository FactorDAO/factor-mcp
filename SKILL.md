# Factor MCP Server - Agent Skill Guide

This guide explains how to use the Factor MCP Server tools to manage DeFi vaults on the Factor Protocol.

## Quick Install

```bash
curl -sSL https://raw.githubusercontent.com/FactorDAO/factor-mcp/main/install.sh | bash
```

## OpenClaw Integration

OpenClaw supports Factor MCP through direct stdio execution. To integrate:

### 1. Install Factor MCP

```bash
curl -sSL https://raw.githubusercontent.com/FactorDAO/factor-mcp/main/install.sh | bash
```

### 2. Create the OpenClaw Skill

```bash
mkdir -p ~/.openclaw/workspace/skills/factor

cat > ~/.openclaw/workspace/skills/factor/SKILL.md << 'EOF'
---
name: factor
description: Manage DeFi vaults on Factor Protocol. Use when creating vaults, depositing/withdrawing assets, lending, borrowing, swapping, or executing strategies on Factor Pro Vaults across Arbitrum, Base, and Ethereum mainnet.
---

# Factor Protocol Skill

Tools for interacting with Factor Protocol vaults.

## Key Tools

| Tool | Purpose |
|------|---------|
| `factor_get_config` | Check current configuration |
| `factor_wallet_setup` | Import or generate wallet |
| `factor_create_vault` | Deploy a new Pro Vault |
| `factor_deposit` | Deposit assets into a vault |
| `factor_withdraw` | Withdraw assets from a vault |
| `factor_lend_supply` | Supply to lending protocols (Aave, Compound, Morpho) |
| `factor_lend_borrow` | Borrow from lending protocols |
| `factor_execute_manager` | Execute strategy steps (swaps, etc.) |

## Usage

Factor tools are called via JSON-RPC over stdio:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"factor_get_config","arguments":{}}}' | factor-mcp
```

See full documentation at `~/.factor-mcp/SKILL.md`.
EOF
```

### 3. Add Skills Directory to OpenClaw Config

Edit `~/.openclaw/openclaw.json` and add the `load` section under `skills`:

```json
{
  "skills": {
    "install": {
      "nodeManager": "npm"
    },
    "load": {
      "extraDirs": ["/home/parallels/.openclaw/workspace/skills"],
      "watch": true
    }
  }
}
```

### 4. Restart OpenClaw Gateway

```bash
openclaw gateway restart
```

Or if restart is disabled in your config, stop and start manually:
```bash
openclaw gateway stop
openclaw gateway start
```

### 5. Verify Installation

```bash
openclaw skills list | grep factor
```

You should see: `📦 factor` with status `✓ ready`

## Overview

Factor Protocol is a DeFi infrastructure that allows users to create and manage "Pro Vaults" - smart contract vaults that can hold multiple assets and execute complex DeFi strategies (swapping, lending, borrowing, liquidity provision, etc.).

**Key Concepts:**
- **Vault**: A smart contract that holds assets and can execute strategies
- **Shares**: When you deposit into a vault, you receive shares representing your ownership
- **Denominator Asset**: The primary accounting token for a vault (e.g., USDC)
- **Adapters**: Protocol integrations (Uniswap, Aave, Morpho, etc.) that enable DeFi operations
- **Manager**: An address authorized to execute strategies on a vault

---

## IMPORTANT: How to Create a Vault

**ALWAYS start with `factor_vault_templates`.** Never call `factor_create_vault` directly without first getting a template.

**If the task involves lending/supplying, set `lendingProtocol`:**
```
factor_vault_templates { denominator: "USDC", lendingProtocol: "aave" }
```
This returns `createVaultParams` with the protocol's adapters and tokens already included. The vault deploys **fully ready for lending in a single transaction** — no need for separate `factor_add_adapter`, `factor_get_lending_tokens`, `factor_add_vault_token` calls.

Each protocol has its own token design (read from the tokenlist):
- **`"aave"`** → aToken (interest-bearing receipt, e.g. aArbUSDCn) + variableDebtToken for borrowing
- **`"compoundV3"`** → cToken (the market contract, e.g. cUSDCv3) + requires `addMarketToAsset` post-deploy before supply
- **`"morpho"`** → collateralToken + loanToken per market, registered with Chainlink accounting + requires user to choose a market, then `addMarketToAssetAndDebt` post-deploy

**If the task is a basic vault (no lending):**
```
factor_vault_templates { denominator: "USDC" }
```

The template response includes:
- `createVaultParams` — pass directly to `factor_create_vault`
- `approvalStep` — call `factor_give_approval` with these params first
- `postDeploySteps` — exact tool calls for deposit + supply (and market registration for Compound/Morpho)
- `lending` — protocol-specific metadata (adapter addresses, token addresses, available markets)

---

## Architecture Rules

- **All vault interactions go through `executeByManager`**: Every on-chain operation on a vault (lending, swapping, adding adapters, etc.) is executed via the `proVault.executeByManager([blocks])` pattern. The SDK's `StrategyBuilder` generates the encoded blocks, and `StudioProVault.executeByManager()` wraps them in a manager call.
- **Adding adapters uses `AdapterManagementAdapter`**: To add a new protocol adapter to a vault, the `factor_add_adapter` tool calls `strategyBuilder.adapter.adapterManagement.addAdapter(adapterAddress)` and executes it via `proVault.executeByManager([block])`. The adapter must be whitelisted in the factory (`factor_get_factory_addresses`).

---

## Quick Start

### 1. Check Configuration
```
Tool: factor_get_config
Purpose: See current chain, wallet, and simulation mode
```

### 2. Setup Wallet (if needed)
```
Tool: factor_wallet_setup
Params: { privateKey: "0x...", password: "optional" }
```

### 3. Explore a Vault
```
Tool: factor_get_vault_info
Params: { vaultAddress: "0x..." }
```

---

## Tool Reference

### Configuration Tools

#### `factor_get_config`
Returns current configuration. Use this first to understand the environment.

**Response includes:**
- `chain`: Current chain (ARBITRUM_ONE, BASE, MAINNET)
- `chainId`: Numeric chain ID
- `rpcUrl`: Active RPC endpoint
- `simulationMode`: If true, transactions are simulated but not broadcast
- `wallet`: Active wallet name and address (if configured)

---

#### `factor_set_chain`
Switch between supported chains.

**Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| chain | string | Yes | One of: ARBITRUM_ONE, BASE, MAINNET |

**Example:**
```json
{ "chain": "ARBITRUM_ONE" }
```

---

#### `factor_set_rpc`
Set a custom RPC endpoint (overrides default Alchemy RPC).

**Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| url | string | Yes | Full RPC URL |

**Example:**
```json
{ "url": "https://arb1.arbitrum.io/rpc" }
```

---

#### `factor_wallet_setup`
Import or generate a wallet for signing transactions.

**Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| privateKey | string | No* | 64 hex chars (with or without 0x) |
| name | string | No | Wallet name (default: "default") |
| password | string | No | Encrypts the private key |
| generateNew | boolean | No | Generate random wallet if true |
| setActive | boolean | No | Make this the active wallet (default: true) |

*Required unless `generateNew: true`

**Examples:**
```json
// Import existing key
{ "privateKey": "0xabc123...", "password": "mypassword" }

// Generate new wallet
{ "generateNew": true, "name": "trading-wallet" }
```

**Security Notes:**
- Always use a password for production wallets
- Wallets are stored at `~/.factor-mcp/wallets/`
- Never share private keys or wallet files

---

#### `factor_get_address_book`
Get the SDK address book (Pro adapters only) for the current chain and environment. Returns all known Pro contract addresses including adapters, accounting adapters, factory, and protocol addresses.

**Parameters:** None

**Response includes:**
- `chain`: Current chain
- `environment`: Current environment (production/testing)
- `addresses`: Map of address name to address value (only Pro addresses)
- `total`: Number of addresses returned

**Use this to:**
- Find the correct adapter address before adding it to a vault
- Look up accounting adapter addresses
- Find factory and protocol addresses

---

### Tokenlist Tools

#### `factor_get_lending_tokens`
Look up lending token information from the tokenlist for a specific protocol. Returns aTokens, debt tokens, and underlying asset info. **Use this BEFORE supplying to a lending protocol** to know which tokens the vault needs.

**Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| protocol | string | Yes | `"aave"`, `"compoundV3"`, or `"morpho"` |
| underlyingAsset | string | No | Underlying token address (e.g., USDC). If omitted, returns all tokens for the protocol. |

**Response includes (Aave example):**
- `aToken`: Interest-bearing token address (register as vault asset)
- `variableDebtToken`: Debt token address (register as vault debt if borrowing)
- `underlyingAddress`: The underlying asset address
- `underlyingSymbol`: Symbol (e.g., "USDC")
- `buildingBlocks`: Supported operations (LEND, BORROW, REPAY, WITHDRAW, FLASHLOAN)
- `vaultSetupNotes`: Step-by-step guidance for vault configuration

---

#### `factor_add_vault_token`
Add an asset or debt token to a vault using the AssetDebtAdapter via executeByManager. **Use this to register aTokens, debt tokens, or any other token the vault needs to track.**

**Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| vaultAddress | string | Yes | The vault contract address |
| tokenAddress | string | Yes | Token to add (e.g., aToken for assets, variableDebtToken for debts) |
| accountingAddress | string | Yes | Accounting adapter address (must be whitelisted in factory) |
| type | string | Yes | `"asset"` or `"debt"` |
| password | string | No | Wallet password if encrypted |

**How to find the correct accounting address:**
1. Call `factor_get_factory_addresses`
2. Look in the `assets` array for the token address to find its accounting pair
3. For debts, look in the `debts` array

---

### Token Tools

#### `factor_give_approval`
Approve an ERC20 token for spending by a spender address (e.g., a vault or factory). **This must be called before depositing tokens into a vault** if the vault does not have sufficient allowance.

**Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| tokenAddress | string | Yes | The ERC20 token address to approve |
| spenderAddress | string | Yes | The address to approve spending for (e.g., vault address, factory address) |
| amount | string | No | Amount in base units, or "max" for unlimited (default: "max") |
| password | string | No | Wallet password if encrypted |

**Example:**
```json
{
  "tokenAddress": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  "spenderAddress": "0xVAULT_ADDRESS",
  "amount": "max"
}
```

**Notes:**
- If the spender already has sufficient allowance, returns immediately without a transaction
- Both `factor_deposit` and `factor_create_vault` will return an `INSUFFICIENT_ALLOWANCE` error with an `approvalHint` if you need to call this first
- Use "max" for unlimited approval to avoid repeated approvals

---

### Vault Query Tools

#### `factor_get_owned_vaults`
List all vaults owned by an address.

**Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| ownerAddress | string | No | Address to check (uses active wallet if omitted) |

**Response includes:**
- Array of vault objects with address, name, symbol
- Total vault count

---

#### `factor_get_vault_info`
Get comprehensive vault details. **Use this before any vault interaction.**

**Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| vaultAddress | string | Yes | The vault contract address |

**Response includes:**
- `vault`: name, symbol, owner
- `financial`: totalSupply, pricePerShare, netVaultValue, underlyingAssets
- `fees`: deposit, withdraw, management, performance (in basis points)
- `access`: managers, riskManager, depositorWhitelist
- `adapters`: manager, owner, withdraw adapters
- `assets`: supported deposit/withdraw assets
- `depositSettings`: minimum, netValueLimit

**Important:** Check `assets.supported` to know which tokens can be deposited.

---

#### `factor_get_shares`
Get a user's share balance in a vault.

**Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| vaultAddress | string | Yes | The vault contract address |
| userAddress | string | No | Address to check (uses active wallet if omitted) |

**Response includes:**
- `userShares`: User's share balance (raw)
- `totalSupply`: Total vault shares
- `pricePerShare`: Current price per share
- `estimatedValue`: User's position value in denominator asset

---

#### `factor_get_executions`
Get vault execution history (manager transactions).

**Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| vaultAddress | string | Yes | The vault contract address |
| limit | number | No | Max results (default: 20) |

**Response includes array of executions:**
- `transactionHash`: Transaction hash
- `blockNumber`, `timestamp`: When it occurred
- `status`: "success" or "reverted"
- `adapters`: Decoded adapter calls with protocol, buildingBlock, functionName, args

---

### Deposit/Withdraw Tools

#### `factor_preview_deposit`
Preview a deposit to see expected shares. **Always preview before depositing.**

**Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| vaultAddress | string | Yes | The vault contract address |
| assetAddress | string | Yes | Token to deposit |
| amount | string | Yes | Amount in base units (wei) |
| userAddress | string | No | Address to check balance |

**Response includes:**
- `deposit.sharesReceived`: Expected shares to receive
- `userBalance`: User's token balance
- `hasEnoughBalance`: Boolean check

**Example:**
```json
{
  "vaultAddress": "0x1234...",
  "assetAddress": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",  // USDC on Arbitrum
  "amount": "1000000"  // 1 USDC (6 decimals)
}
```

---

#### `factor_deposit`
Execute a deposit. Automatically approves tokens if needed.

**Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| vaultAddress | string | Yes | The vault contract address |
| assetAddress | string | Yes | Token to deposit |
| amount | string | Yes | Amount in base units (wei) |
| password | string | No | Wallet password (if encrypted) |

**Response includes:**
- `transactions`: Array of tx hashes (approve + deposit)
- `simulationMode`: Whether this was a simulation
- `gasEstimate`: If simulation mode

**Important:**
- First run `factor_preview_deposit` to verify
- Check `simulationMode` in config - set to false for real transactions
- The tool handles token approval automatically

---

#### `factor_preview_withdraw`
Preview a withdrawal to see expected assets.

**Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| vaultAddress | string | Yes | The vault contract address |
| shares | string | Yes | Shares to redeem (in base units) |
| userAddress | string | No | Address to check share balance |

**Response includes:**
- `withdrawal.assetsReceived`: Expected assets to receive
- `userShares`: User's current share balance
- `hasEnoughShares`: Boolean check

---

#### `factor_withdraw`
Execute a withdrawal (redeem shares for assets).

**Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| vaultAddress | string | Yes | The vault contract address |
| shares | string | Yes | Shares to redeem (in base units) |
| password | string | No | Wallet password (if encrypted) |

**Response includes:**
- `withdrawal.transactionHash`: Transaction hash
- `withdrawal.shares`: Shares redeemed
- `simulationMode`: Whether this was a simulation

---

### Vault Creation

#### `factor_create_vault`
Deploy a new Factor Pro vault.

**Parameters:**
| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| name | string | Yes | - | Vault name (max 50 chars) |
| symbol | string | Yes | - | Token symbol (max 10 chars) |
| assetDenominatorAddress | string | Yes | - | Main accounting token |
| initialDepositAmount | string | No | "0" | Initial deposit in wei |
| upgradeable | boolean | No | false | Can vault be upgraded |
| upgradeTimelockSeconds | number | No | 86400 | Upgrade delay (1 day) |
| cooldownTimeSeconds | number | No | 0 | Withdrawal cooldown |
| maxCap | string | No | "0" | Max vault size (0 = no cap) |
| initialAssetAddresses | string[] | No | [denominator] | Allowed assets |
| initialDepositAssetAddresses | string[] | No | [denominator] | Deposit assets |
| initialWithdrawAssetAddresses | string[] | No | [denominator] | Withdraw assets |
| initialManagerAdapters | string[] | No | [] | Manager adapter addresses |
| depositFee | number | No | 0 | Deposit fee (0-100%) |
| withdrawFee | number | No | 0 | Withdraw fee (0-100%) |
| managementFee | number | No | 0 | Annual management fee |
| performanceFee | number | No | 0 | Performance fee |
| password | string | No | - | Wallet password |

**Example - Simple Vault:**
```json
{
  "name": "My USDC Vault",
  "symbol": "mvUSDC",
  "assetDenominatorAddress": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  "managementFee": 2,
  "performanceFee": 20
}
```

---

### Strategy Execution

#### `factor_execute_manager`
Execute DeFi strategies on a vault as a manager.

**Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| vaultAddress | string | Yes | The vault contract address |
| steps | array | Yes | Array of strategy steps |
| password | string | No | Wallet password |

**Step structure:**
```json
{
  "protocol": "uniswap",
  "action": "exactInputSingleAll",
  "params": {
    "tokenIn": "0x...",
    "tokenOut": "0x...",
    "fee": 3000
  }
}
```

**Common protocols and actions:**
| Protocol | Actions |
|----------|---------|
| uniswap | exactInputSingle, exactInputSingleAll |
| aave | deposit, withdraw, borrow, repay |
| morpho | deposit, withdraw, borrow, repay |
| gmx | createDeposit, createWithdrawal |

**Example - Swap all USDC to WETH:**
```json
{
  "vaultAddress": "0x1234...",
  "steps": [{
    "protocol": "uniswap",
    "action": "exactInputSingleAll",
    "params": {
      "tokenIn": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      "tokenOut": "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
      "fee": 500
    }
  }]
}
```

---

### Transaction Tools

#### `factor_preview_transaction`
Preview any transaction with gas estimates.

**Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| to | string | Yes | Target contract address |
| data | string | Yes | Encoded calldata (0x...) |
| value | string | No | ETH value to send |

---

#### `factor_get_transaction_status`
Check if a transaction has been mined and its status.

**Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| txHash | string | Yes | Transaction hash |

**Response includes:**
- `status`: "pending", "success", or "failed"
- `blockNumber`: Block where mined
- `gasUsed`: Actual gas used

---

### Lending Tools

#### `factor_lend_supply`
Supply/deposit assets to a lending protocol through a Factor vault.

**Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| vaultAddress | string | Yes | The vault contract address |
| protocol | string | Yes | "aave", "compoundV3", or "morpho" |
| assetAddress | string | Conditional | Token to supply (required for aave, compoundV3) |
| marketAddress | string | Conditional | Compound V3 market address (required for compoundV3) |
| marketId | string | Conditional | Morpho market ID (required for morpho) |
| amount | string | Yes | Amount in wei, "all" for entire balance, or percentage like "50%" |
| password | string | No | Wallet password |

**Examples:**
```json
// Aave: supply USDC
{
  "vaultAddress": "0xVAULT",
  "protocol": "aave",
  "assetAddress": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  "amount": "1000000"
}

// Compound V3: supply all USDC
{
  "vaultAddress": "0xVAULT",
  "protocol": "compoundV3",
  "marketAddress": "0xMARKET",
  "assetAddress": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  "amount": "all"
}

// Morpho: supply to a market
{
  "vaultAddress": "0xVAULT",
  "protocol": "morpho",
  "marketId": "0xMARKETID...",
  "amount": "1000000"
}

// Any protocol: supply 50% of balance
{
  "vaultAddress": "0xVAULT",
  "protocol": "aave",
  "assetAddress": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  "amount": "50%"
}
```

---

#### `factor_lend_withdraw`
Withdraw supplied assets from a lending protocol through a Factor vault.

**Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| vaultAddress | string | Yes | The vault contract address |
| protocol | string | Yes | "aave", "compoundV3", or "morpho" |
| assetAddress | string | Conditional | Token to withdraw (required for aave, compoundV3) |
| marketAddress | string | Conditional | Compound V3 market address (required for compoundV3) |
| marketId | string | Conditional | Morpho market ID (required for morpho) |
| amount | string | Yes | Amount in wei, "all" for entire supplied balance, or percentage like "50%" |
| password | string | No | Wallet password |

---

#### `factor_lend_borrow`
Borrow assets from a lending protocol through a Factor vault. Requires collateral to be supplied first.

**Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| vaultAddress | string | Yes | The vault contract address |
| protocol | string | Yes | "aave", "compoundV3", or "morpho" |
| debtAddress | string | Conditional | Token to borrow (required for aave, compoundV3) |
| marketAddress | string | Conditional | Compound V3 market address (required for compoundV3) |
| marketId | string | Conditional | Morpho market ID (required for morpho) |
| amount | string | Yes | Amount to borrow in wei |
| password | string | No | Wallet password |

---

#### `factor_lend_repay`
Repay borrowed assets to a lending protocol through a Factor vault.

**Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| vaultAddress | string | Yes | The vault contract address |
| protocol | string | Yes | "aave", "compoundV3", or "morpho" |
| debtAddress | string | Conditional | Token of the debt to repay (required for aave, compoundV3) |
| marketAddress | string | Conditional | Compound V3 market address (required for compoundV3) |
| marketId | string | Conditional | Morpho market ID (required for morpho) |
| amount | string | Yes | Amount in wei, "all" for entire debt, or percentage like "50%" |
| password | string | No | Wallet password |

---

### Strategy Building Tools

#### `factor_list_adapters`
List available protocol adapters for the current chain.

#### `factor_build_strategy`
Build a multi-step strategy from building blocks.

#### `factor_simulate_strategy`
Simulate a strategy execution without broadcasting.

#### `factor_execute_strategy`
Execute a built strategy on-chain.

---

## Common Workflows

### Workflow 1: Deposit USDC to a Vault

```
1. factor_get_config
   → Check chain is ARBITRUM_ONE and wallet is configured

2. factor_get_vault_info { vaultAddress: "0xVAULT" }
   → Note the supported deposit assets
   → Confirm USDC (0xaf88d065e77c8cC2239327C5EDb3A432268e5831) is supported

3. factor_preview_deposit {
     vaultAddress: "0xVAULT",
     assetAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
     amount: "1000000000"  // 1000 USDC
   }
   → Check hasEnoughBalance is true
   → Note expected sharesReceived

4. factor_give_approval {
     tokenAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
     spenderAddress: "0xVAULT",
     amount: "max"
   }
   → Approves USDC for the vault (skips if already approved)

5. factor_deposit {
     vaultAddress: "0xVAULT",
     assetAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
     amount: "1000000000",
     password: "wallet-password"
   }
   → Get transaction hash
```

### Workflow 2: Check and Withdraw Position

```
1. factor_get_shares { vaultAddress: "0xVAULT" }
   → Note userShares and estimatedValue

2. factor_preview_withdraw {
     vaultAddress: "0xVAULT",
     shares: "500000000000000000000"  // Example: 500 shares
   }
   → Check assetsReceived amount

3. factor_withdraw {
     vaultAddress: "0xVAULT",
     shares: "500000000000000000000",
     password: "wallet-password"
   }
```

### Workflow 3: Execute a Swap Strategy (as Manager)

```
1. factor_get_vault_info { vaultAddress: "0xVAULT" }
   → Verify you are in the managers list
   → Check available adapters include uniswap

2. factor_execute_manager {
     vaultAddress: "0xVAULT",
     steps: [{
       protocol: "uniswap",
       action: "exactInputSingleAll",
       params: {
         tokenIn: "0xUSDC...",
         tokenOut: "0xWETH...",
         fee: 500
       }
     }],
     password: "wallet-password"
   }
```

### Workflow 4: Prepare Vault + Supply to Aave (Complete Flow)

Before lending, the vault must have the Aave adapter, the aToken registered as an asset, and optionally the debt token for borrowing.

```
Step 1: Look up Aave token info for USDC
   factor_get_lending_tokens {
     protocol: "aave",
     underlyingAsset: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"  // USDC
   }
   → Returns: aToken, variableDebtToken, underlyingSymbol, buildingBlocks

Step 2: Get the Aave adapter and accounting addresses
   factor_get_address_book
   → Find: factor_aave_adapter_pro, factor_aave_accounting_adapter_pro

Step 3: Check current vault state
   factor_get_vault_info { vaultAddress: "0xVAULT" }
   → Check: Is Aave adapter in adapters.manager? Is aToken in assets?

Step 4: Add Aave adapter (if not already present)
   factor_add_adapter {
     vaultAddress: "0xVAULT",
     adapterAddress: "<factor_aave_adapter_pro from step 2>"
   }

Step 5: Find accounting for the aToken
   factor_get_factory_addresses
   → Look in assets[] for the aToken address from step 1 → get its accounting address

Step 6: Register the aToken as a vault asset
   factor_add_vault_token {
     vaultAddress: "0xVAULT",
     tokenAddress: "<aToken from step 1>",
     accountingAddress: "<accounting from step 5>",
     type: "asset"
   }

Step 7: (If borrowing) Register the debt token
   factor_add_vault_token {
     vaultAddress: "0xVAULT",
     tokenAddress: "<variableDebtToken from step 1>",
     accountingAddress: "<debt accounting from factory debts[]>",
     type: "debt"
   }

Step 8: Supply to Aave
   factor_lend_supply {
     vaultAddress: "0xVAULT",
     protocol: "aave",
     assetAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
     amount: "all"
   }
```

### Workflow 5: Aave Leverage (Borrow + Repay + Withdraw)

Assumes vault is already set up with Aave adapter + aToken + debtToken (see Workflow 4).

```
1. factor_lend_supply {
     vaultAddress: "0xVAULT",
     protocol: "aave",
     assetAddress: "0xUSDC...",
     amount: "1000000000"  // 1000 USDC as collateral
   }

2. factor_lend_borrow {
     vaultAddress: "0xVAULT",
     protocol: "aave",
     debtAddress: "0xWETH...",
     amount: "500000000000000000"  // 0.5 WETH
   }

3. factor_lend_repay {
     vaultAddress: "0xVAULT",
     protocol: "aave",
     debtAddress: "0xWETH...",
     amount: "all"  // repay full debt (also supports "50%" for partial repay)
   }

4. factor_lend_withdraw {
     vaultAddress: "0xVAULT",
     protocol: "aave",
     assetAddress: "0xUSDC...",
     amount: "all"  // withdraw all collateral (also supports "50%" for partial withdraw)
   }
```

### Workflow 6: Prepare Vault + Supply to Compound V3

Compound V3 requires TWO adapters (`factor_compound_v3_adapter_pro` + `factor_compound_v3_market_adapter_pro`) and a market registration step.

```
Step 1: Look up Compound V3 token info
   factor_get_lending_tokens { protocol: "compoundV3", underlyingAsset: "0xUSDC..." }
   → Returns baseAssetAddress (cToken/market), underlyingAddress

Step 2: Get adapter addresses
   factor_get_address_book
   → Find: factor_compound_v3_adapter_pro, factor_compound_v3_market_adapter_pro

Step 3: Add BOTH adapters (if missing)
   factor_add_adapter { vaultAddress: "0xVAULT", adapterAddress: "<compound_v3_adapter_pro>" }
   factor_add_adapter { vaultAddress: "0xVAULT", adapterAddress: "<compound_v3_market_adapter_pro>" }

Step 4: Add cToken as vault asset
   factor_add_vault_token {
     vaultAddress: "0xVAULT",
     tokenAddress: "<cToken from step 1>",
     accountingAddress: "<from factory assets[]>",
     type: "asset"
   }

Step 5: Register the market (REQUIRED before supply)
   factor_execute_manager {
     vaultAddress: "0xVAULT",
     steps: [{
       protocol: "compoundV3",
       action: "addMarketToAsset",
       params: { marketAddress: "<cToken>", assetAddress: "<underlying>" }
     }],
     password: "..."
   }

Step 6: Supply
   factor_lend_supply {
     vaultAddress: "0xVAULT",
     protocol: "compoundV3",
     marketAddress: "<cToken>",
     assetAddress: "0xUSDC...",
     amount: "all"
   }
```

### Workflow 7: Prepare Vault + Supply to Morpho

Morpho requires: (1) Morpho adapter + market adapter, (2) BOTH collateral AND loan tokens registered as vault assets with **Chainlink accounting**, (3) market registered via `addMarketToAssetAndDebt`. All of this MUST be done BEFORE any supply/withdraw/borrow/repay.

**IMPORTANT - Market Selection**: NEVER pick a Morpho market automatically. Always:
1. Present available markets to the user (from `factor_get_lending_tokens`)
2. Provide the Morpho interface link for the relevant chain so the user can review:
   - Base: https://app.morpho.org/?network=base
   - Ethereum: https://app.morpho.org/?network=mainnet
   - Arbitrum: https://app.morpho.org/?network=arbitrum
3. Wait for the user to confirm which market they want before proceeding
4. Run ALL pre-flight checks (step 3 below) before any on-chain action

```
Step 1: Look up Morpho markets and ASK the user which one to use
   factor_get_lending_tokens { protocol: "morpho", underlyingAsset: "0xUSDC..." }
   → Returns marketId, loanToken, loanSymbol, collateralToken, collateralSymbol for each market
   → Present the list to the user with the Morpho interface link
   → WAIT for user to choose a market before continuing

Step 2: Get adapter and accounting addresses
   factor_get_address_book
   → Find: factor_morpho_adapter_pro, factor_morpho_market_adapter_pro, factor_chainlink_accounting_adapter_pro

Step 3: Pre-flight checks - verify ALL tokens BEFORE any on-chain action
   a. Chainlink price feed check for EACH token (collateral + loan):
      factor_cast_call {
        to: "<chainlink_accounting_adapter_pro>",
        signature: "getPriceDetails(address)((uint256,uint8,uint8))",
        args: ["<token_address>"]
      }
      → If it returns (price, feedDecimals, tokenDecimals), the token has a feed
      → If it reverts with ACC_CHAINLINK__OracleNotFound(), NO feed exists - STOP and tell the user

   b. Factory whitelist check:
      factor_get_factory_addresses
      → Verify each token + chainlink_accounting pair exists in the assets[] list
      → If a token is NOT whitelisted - STOP and tell the user

   c. Only proceed if ALL tokens pass both checks

Step 4: Add Morpho adapter (if missing)
   factor_add_adapter { vaultAddress: "0xVAULT", adapterAddress: "<morpho_adapter_pro>" }

Step 5: Add Morpho market adapter (if missing)
   factor_add_adapter { vaultAddress: "0xVAULT", adapterAddress: "<morpho_market_adapter_pro>" }
   → BOTH adapters are required

Step 6: Register BOTH collateral and loan tokens as vault assets (if not already)
   factor_add_vault_token {
     vaultAddress: "0xVAULT",
     tokenAddress: "<collateralToken>",
     accountingAddress: "<chainlink_accounting_adapter_pro>",
     type: "asset"
   }
   → Verify tx success with factor_get_transaction_status before continuing
   factor_add_vault_token {
     vaultAddress: "0xVAULT",
     tokenAddress: "<loanToken>",
     accountingAddress: "<chainlink_accounting_adapter_pro>",
     type: "asset"
   }
   → Verify tx success - both tokens MUST be vault assets before next step

Step 7: Register the market (REQUIRED before any supply/withdraw/borrow/repay)
   factor_execute_manager {
     vaultAddress: "0xVAULT",
     steps: [{
       protocol: "morpho",
       action: "addMarketToAssetAndDebt",
       params: { marketId: "<MARKET_ID>" }
     }]
   }
   → Verify tx success - if it reverts with INVALID_ASSET, a token from step 6 is missing

Step 8: Supply
   factor_lend_supply {
     vaultAddress: "0xVAULT",
     protocol: "morpho",
     marketId: "<MARKET_ID>",
     amount: "all"
   }
```

**IMPORTANT**:
- `addMarketToAssetAndDebt` validates that BOTH the collateral token AND the loan token are already registered as vault assets. If either is missing, the call will revert with `INVALID_ASSET`.
- NEVER supply to a Morpho market without completing step 7 (`addMarketToAssetAndDebt`) first. Without market registration, supply may partially work but withdraw will be impossible, locking funds.
- Always verify every transaction succeeded (via `factor_get_transaction_status`) before proceeding to the next step.

### Workflow 8: Create a New Vault

**RECOMMENDED: Always start from a template.** When the user wants to create a vault, use `factor_vault_templates` first. Ask the user:
1. Which **chain** to deploy on (ARBITRUM_ONE, BASE, MAINNET)
2. Which **denominator token** (USDC, WETH, etc.)
3. Which **lending protocols** to include (aave, compoundV3, morpho, or none)

Then call `factor_vault_templates` with the appropriate `denominator` and `lendingProtocol` params. The template provides ready-to-use `createVaultParams` with all adapters, tokens, and accounting addresses pre-configured.

```
1. factor_get_config
   → Ensure wallet is configured, check current chain

2. factor_vault_templates { denominator: "USDC" }
   → Get ready-to-use createVaultParams and approvalStep
   → Or with lending: factor_vault_templates { denominator: "USDC", lendingProtocol: "aave" }

3. factor_give_approval with the approvalStep params

4. factor_create_vault with the createVaultParams (customize name/symbol as needed)
   → Get transaction hash
   → Vault address available in transaction receipt events

5. (If lending) Follow the postDeploySteps from the template:
   → factor_deposit to add funds
   → factor_lend_supply to supply to the protocol
```

### Workflow 9: Create Vault + Supply to Aave (Streamlined)
```
1. factor_vault_templates { denominator: "USDC", lendingProtocol: "aave" }
   → Returns createVaultParams with Aave adapter, aToken, and debtToken pre-configured
2. factor_give_approval with the approvalStep params
3. factor_create_vault with the createVaultParams
   → Vault deploys fully ready for Aave lending
4. factor_deposit to add USDC to the vault
5. factor_lend_supply { protocol: "aave", assetAddress: "0xUSDC...", amount: "all" }
```

### Workflow 10: Create Vault + Supply to Compound V3 (Streamlined)
```
1. factor_vault_templates { denominator: "USDC", lendingProtocol: "compoundV3" }
   → Returns createVaultParams with both Compound V3 adapters and cToken pre-configured
2. factor_give_approval with the approvalStep params
3. factor_create_vault with the createVaultParams
4. factor_execute_manager with registerMarket step from postDeploySteps (REQUIRED before supply)
5. factor_deposit to add USDC to the vault
6. factor_lend_supply { protocol: "compoundV3", marketAddress: "<cToken>", assetAddress: "0xUSDC...", amount: "all" }
```

### Workflow 11: Create Vault + Supply to Morpho (Streamlined)
```
1. factor_vault_templates { denominator: "USDC", lendingProtocol: "morpho" }
   → Returns createVaultParams with Morpho adapters and all tokens pre-registered
   → Also returns lending.availableMarkets — present these to the user
2. Let the user choose a market from lending.availableMarkets (NEVER auto-select)
3. factor_give_approval with the approvalStep params
4. factor_create_vault with the createVaultParams
5. factor_execute_manager with addMarketToAssetAndDebt for the chosen marketId (REQUIRED)
6. factor_deposit to add USDC to the vault
7. factor_lend_supply { protocol: "morpho", marketId: "<chosen>", amount: "all" }
```

---

## Token Addresses (Arbitrum One)

| Token | Address |
|-------|---------|
| USDC | 0xaf88d065e77c8cC2239327C5EDb3A432268e5831 |
| USDC.e | 0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8 |
| WETH | 0x82aF49447D8a07e3bd95BD0d56f35241523fBab1 |
| WBTC | 0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f |
| ARB | 0x912CE59144191C1204E64559FE8253a0e49E6548 |
| GMX | 0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a |
| LINK | 0xf97f4df75117a78c1A5a0DBb814Af92458539FB4 |

---

## Fork Simulation with Balance Overrides

When a write operation (vault deployment, swap, lending supply, etc.) fails with an `INSUFFICIENT_BALANCE` error, the error response includes a `simulationHint` with the exact parameters to retry using `factor_simulate_transaction` with `balanceOverrides`. This lets you test the full flow of any write operation without needing real funds.

### How it works

1. Any write tool call that fails due to insufficient ETH or token balance returns an `INSUFFICIENT_BALANCE` error with a `simulationHint`
2. The `simulationHint` contains the `to`, `data`, and `value` fields from the failed transaction, plus a template `balanceOverrides` array
3. Call `factor_simulate_transaction` with those params, adding any ERC20 overrides you need
4. The simulation forks the network via anvil, overrides balances, executes the transaction, and returns the result

### Example: Simulate a vault deployment without real funds

```json
{
  "to": "0xFACTORY_ADDRESS",
  "data": "0x...",
  "balanceOverrides": [
    {
      "address": "0xYOUR_WALLET",
      "ethBalance": "10000000000000000000",
      "erc20": [
        {
          "token": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
          "amount": "1000000000"
        }
      ]
    }
  ]
}
```

### Balance override details

- **ETH**: Set directly via `anvil_setBalance`
- **ERC20**: Uses storage slot probing — tries common balance mapping slots (0, 1, 2, 3, 4, 5, 9, 51), computes `keccak256(abi.encode(address, slot))`, sets via `anvil_setStorageAt`, then verifies with `balanceOf`. Works for standard ERC20s including proxies like USDC.

---

## Error Handling

**Common errors and solutions:**

| Error | Cause | Solution |
|-------|-------|----------|
| "No wallet configured" | Wallet not set up | Run `factor_wallet_setup` |
| "Invalid vault address" | Bad address format | Check address is valid hex |
| "Insufficient balance" | Not enough tokens | Use `factor_simulate_transaction` with `balanceOverrides` (see simulationHint in error) |
| "Insufficient shares" | Not enough shares | Check shares before withdraw |
| "Not a valid deposit asset" | Token not whitelisted | Check vault's supported assets |
| "Simulation mode" | Real tx not sent | Set simulationMode: false in config |

---

## Best Practices

1. **Always preview first**: Use preview tools before executing transactions
2. **Check simulation mode**: Ensure `simulationMode: false` for real transactions
3. **Verify vault info**: Always call `factor_get_vault_info` before interacting
4. **Use passwords**: Encrypt wallets for security
5. **Monitor gas**: Check `gasEstimate` in simulation responses
6. **Verify manager status**: Only managers can execute strategies
7. **Handle decimals correctly**: USDC has 6 decimals, most tokens have 18
