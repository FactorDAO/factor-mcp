import { createManageTool } from './manage-helpers.js';

export const setMaxCapTool = createManageTool({
  name: 'factor_set_max_cap',
  description: 'Set the maximum deposit cap for a Factor Pro vault. The cap is in the vault denominator token base units (wei). Set to 0 for no cap. Only callable by vault owner.',
  extraParams: {
    maxCap: {
      type: 'string',
      description: 'Maximum vault cap in base units (wei). Use "0" for no cap.',
    },
  },
  requiredExtra: ['maxCap'],
  buildTx: (proVault, input) => {
    return proVault.setMaxCap(input.maxCap);
  },
});

export const setMaxDebtRatioTool = createManageTool({
  name: 'factor_set_max_debt_ratio',
  description: 'Set the maximum debt ratio for a Factor Pro vault. Ratio is in basis points (0-10000, where 10000 = 100%). Only callable by vault owner.',
  extraParams: {
    maxDebtRatioBps: {
      type: 'string',
      description: 'Maximum debt ratio in basis points (0-10000, where 10000 = 100%)',
    },
  },
  requiredExtra: ['maxDebtRatioBps'],
  buildTx: (proVault, input) => {
    return proVault.setMaxDebtRatio(input.maxDebtRatioBps);
  },
});

export const setPriceDeviationAllowanceTool = createManageTool({
  name: 'factor_set_price_deviation_allowance',
  description: 'Set the cumulative price deviation allowance for a Factor Pro vault. This controls how much price deviation is tolerated before operations are blocked. Value is in basis points (0-10000). Only callable by vault owner or risk manager.',
  extraParams: {
    allowanceBps: {
      type: 'string',
      description: 'Price deviation allowance in basis points (0-10000, where 100 = 1%)',
    },
  },
  requiredExtra: ['allowanceBps'],
  buildTx: (proVault, input) => {
    return proVault.setCumulativePriceDeviationAllowance(input.allowanceBps);
  },
});
