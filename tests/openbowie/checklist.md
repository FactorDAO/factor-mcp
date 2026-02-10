# OpenBowie Model Test Checklist — Factor MCP

**Purpose:** Test whether non-Claude LLM models can correctly use Factor MCP tools via OpenBowie autonomous agents, using natural human-like prompts (no hand-holding, no tool names given).

**MCP Config:** `factor-mcp`
**Test Vault (ARB):** `0xd88d8dc186f5c6d605cba97101c22a75b80538c1`
**Test Owner:** `0xF4c9fAa7a85f5eAEfBB56Ba50f4369bFee9fDAfA`

---

## Tests

| # | Prompt (human-like) | What We're Actually Testing | Expected Tool(s) |
|---|--------------------|-----------------------------|-------------------|
| 01 | "What chain am I on? Is there a wallet?" | Can model discover config tool and read response | `factor_get_config` |
| 02 | "Switch me to Base chain" | Can model figure out chain switching | `factor_set_chain` |
| 03 | "Deploy a new USDC vault on Arbitrum" | Can model formulate vault creation call | `factor_create_vault` (+ possibly `factor_set_chain`) |
| 04 | "What protocols/adapters are available?" | Can model discover adapter listing | `factor_list_adapters` |
| 05 | "Add Aave to my vault" | Can model find Aave adapter address and add it | `factor_get_address_book` → `factor_add_adapter` |
| 06 | "Supply USDC to Aave through my vault" | Can model call lending supply correctly | `factor_lend_supply` |
| 07 | "Swap USDC for WETH in my vault" | Can model formulate a swap call | `factor_swap` |
| 08 | "Show me all my vaults and their details" | Can model chain vault discovery tools | `factor_get_owned_vaults` → `factor_get_vault_info` |
| 09 | "Use Compound on Base chain" | Can model switch chains + discover markets + supply | `factor_set_chain` → `factor_get_lending_tokens` → `factor_lend_supply` |
| 10 | "Full Aave setup from scratch" | Can model execute complete multi-step workflow | 5+ tools chained |

---

## Pass/Fail Criteria

- **PASS**: Model figured out the right tools, called them with reasonable parameters, and got meaningful results
- **PARTIAL**: Model found some tools but made errors in parameters or missed steps
- **FAIL**: Model couldn't figure out what tools to use, hallucinated responses, or crashed

## Key Insight

These prompts are intentionally vague — like a real user would type. The model must:
1. Read tool descriptions to figure out which tool to call
2. Determine correct parameters from context (addresses, chain names, etc.)
3. Chain multiple tools when the task requires it
4. Handle errors and adapt
