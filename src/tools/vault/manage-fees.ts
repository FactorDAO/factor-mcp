import { createManageTool } from './manage-helpers.js';

export const setWithdrawFeeTool = createManageTool({
  name: 'factor_set_withdraw_fee',
  description: 'Set the withdraw fee for a Factor Pro vault. Fee is in basis points (0-10000, where 10000 = 100%). Only callable by vault owner.',
  extraParams: {
    feeBps: {
      type: 'string',
      description: 'Withdraw fee in basis points (0-10000, where 100 = 1%)',
    },
  },
  requiredExtra: ['feeBps'],
  buildTx: (proVault, input) => {
    return proVault.setWithdrawFee(input.feeBps);
  },
});

export const setDepositFeeTool = createManageTool({
  name: 'factor_set_deposit_fee',
  description: 'Set the deposit fee for a Factor Pro vault. Fee is in basis points (0-10000, where 10000 = 100%). Only callable by vault owner.',
  extraParams: {
    feeBps: {
      type: 'string',
      description: 'Deposit fee in basis points (0-10000, where 100 = 1%)',
    },
  },
  requiredExtra: ['feeBps'],
  buildTx: (proVault, input) => {
    return proVault.setDepositFee(input.feeBps);
  },
});

export const setPerformanceFeeTool = createManageTool({
  name: 'factor_set_performance_fee',
  description: 'Set the performance fee for a Factor Pro vault. Fee is in basis points (0-10000, where 10000 = 100%). Only callable by vault owner.',
  extraParams: {
    feeBps: {
      type: 'string',
      description: 'Performance fee in basis points (0-10000, where 100 = 1%)',
    },
  },
  requiredExtra: ['feeBps'],
  buildTx: (proVault, input) => {
    return proVault.setPerformanceFees(input.feeBps);
  },
});

export const setManagementFeeTool = createManageTool({
  name: 'factor_set_management_fee',
  description: 'Set the annual management fee for a Factor Pro vault. Fee is in basis points (0-10000, where 10000 = 100%). Only callable by vault owner.',
  extraParams: {
    feeBps: {
      type: 'string',
      description: 'Annual management fee in basis points (0-10000, where 100 = 1%)',
    },
  },
  requiredExtra: ['feeBps'],
  buildTx: (proVault, input) => {
    return proVault.setManagementFee(input.feeBps);
  },
});

export const chargePerformanceFeeTool = createManageTool({
  name: 'factor_charge_performance_fee',
  description: 'Charge the accrued performance fee on a Factor Pro vault. This mints fee shares to the fee receiver. Callable by anyone.',
  extraParams: {},
  requiredExtra: [],
  buildTx: (proVault) => {
    return proVault.chargePerformanceFee();
  },
});

export const setFeeReceiverTool = createManageTool({
  name: 'factor_set_fee_receiver',
  description: 'Set the fee receiver address for a Factor Pro vault. All accrued fees (deposit, withdraw, performance, management) are sent to this address. Only callable by vault owner.',
  extraParams: {
    receiverAddress: {
      type: 'string',
      description: 'The address that will receive vault fees',
    },
  },
  requiredExtra: ['receiverAddress'],
  buildTx: (proVault, input) => {
    return proVault.setFeeReceiver(input.receiverAddress);
  },
});
