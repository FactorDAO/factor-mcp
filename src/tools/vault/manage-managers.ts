import { createManageTool } from './manage-helpers.js';

export const addVaultManagerTool = createManageTool({
  name: 'factor_add_vault_manager',
  description: 'Add a manager address to a Factor Pro vault. Managers can execute strategies (swaps, lending, etc.) on the vault via executeByManager. Only callable by vault owner.',
  extraParams: {
    managerAddress: {
      type: 'string',
      description: 'The address to add as a vault manager',
    },
  },
  requiredExtra: ['managerAddress'],
  buildTx: (proVault, input) => {
    return proVault.addManager(input.managerAddress);
  },
});

export const removeVaultManagerTool = createManageTool({
  name: 'factor_remove_vault_manager',
  description: 'Remove a manager address from a Factor Pro vault. The removed address will no longer be able to execute strategies. Only callable by vault owner.',
  extraParams: {
    managerAddress: {
      type: 'string',
      description: 'The manager address to remove',
    },
  },
  requiredExtra: ['managerAddress'],
  buildTx: (proVault, input) => {
    return proVault.removeManager(input.managerAddress);
  },
});

export const setRiskManagerTool = createManageTool({
  name: 'factor_set_risk_manager',
  description: 'Set the risk manager address for a Factor Pro vault. The risk manager can adjust risk parameters like price deviation allowance. Only callable by vault owner.',
  extraParams: {
    managerAddress: {
      type: 'string',
      description: 'The address to set as the risk manager',
    },
  },
  requiredExtra: ['managerAddress'],
  buildTx: (proVault, input) => {
    return proVault.setRiskManager(input.managerAddress);
  },
});
