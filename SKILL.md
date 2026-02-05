# Factor MCP Server - Agent Skill Guide

This guide explains how to use the Factor MCP Server tools to manage DeFi vaults on the Factor Protocol.

## Quick Install

```bash
curl -sSL https://raw.githubusercontent.com/FactorDAO/factor-mcp/main/install.sh | bash
```

## Overview

Factor Protocol is a DeFi infrastructure that allows users to create and manage "Pro Vaults" - smart contract vaults that can hold multiple assets and execute complex DeFi strategies (swapping, lending, borrowing, liquidity provision, etc.).

**Key Concepts:**
- **Vault**: A smart contract that holds assets and can execute strategies
- **Shares**: When you deposit into a vault, you receive shares representing your ownership
- **Denominator Asset**: The primary accounting token for a vault (e.g., USDC)
- **Adapters**: Protocol integrations (Uniswap, Aave, Morpho, etc.) that enable DeFi operations
- **Manager**: An address authorized to execute strategies on a vault

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

### Strategy Building Tools

#### `factor_list_adapters`
List available protocol adapters for the current chain.

#### `factor_list_building_blocks`
List available strategy building blocks (actions).

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

4. factor_deposit {
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

### Workflow 4: Create a New Vault

```
1. factor_get_config
   → Ensure wallet is configured

2. factor_create_vault {
     name: "My Strategy Vault",
     symbol: "MSV",
     assetDenominatorAddress: "0xUSDC...",
     managementFee: 2,
     performanceFee: 20,
     initialManagerAdapters: ["0xUniswapAdapter...", "0xAaveAdapter..."]
   }
   → Get transaction hash
   → Vault address available in transaction receipt events
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

## Error Handling

**Common errors and solutions:**

| Error | Cause | Solution |
|-------|-------|----------|
| "No wallet configured" | Wallet not set up | Run `factor_wallet_setup` |
| "Invalid vault address" | Bad address format | Check address is valid hex |
| "Insufficient balance" | Not enough tokens | Check balance before deposit |
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
