export class FactorMcpError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'FactorMcpError';

    // Convert Error objects to plain objects so they serialize properly via JSON.stringify
    if (details instanceof FactorMcpError) {
      this.details = details.toJSON();
    } else if (details instanceof Error) {
      this.details = {
        message: details.message,
        name: details.name,
        ...(details.stack ? { stack: details.stack } : {}),
      };
    }
  }

  toJSON() {
    return {
      error: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

export class ConfigurationError extends FactorMcpError {
  constructor(message: string, details?: unknown) {
    super(message, 'CONFIGURATION_ERROR', details);
    this.name = 'ConfigurationError';
  }
}

export class WalletError extends FactorMcpError {
  constructor(message: string, details?: unknown) {
    super(message, 'WALLET_ERROR', details);
    this.name = 'WalletError';
  }
}

export class EncryptionError extends FactorMcpError {
  constructor(message: string, details?: unknown) {
    super(message, 'ENCRYPTION_ERROR', details);
    this.name = 'EncryptionError';
  }
}

export class TransactionError extends FactorMcpError {
  constructor(message: string, details?: unknown) {
    super(message, 'TRANSACTION_ERROR', details);
    this.name = 'TransactionError';
  }
}

export class VaultError extends FactorMcpError {
  constructor(message: string, details?: unknown) {
    super(message, 'VAULT_ERROR', details);
    this.name = 'VaultError';
  }
}

export class SdkError extends FactorMcpError {
  constructor(message: string, details?: unknown) {
    super(message, 'SDK_ERROR', details);
    this.name = 'SdkError';
  }
}

export class InsufficientBalanceError extends FactorMcpError {
  constructor(message: string, public simulationHint: object, details?: unknown) {
    super(message, 'INSUFFICIENT_BALANCE', details);
    this.name = 'InsufficientBalanceError';
  }

  toJSON() {
    return {
      ...super.toJSON(),
      simulationHint: this.simulationHint,
    };
  }
}

export function formatError(error: unknown): { error: string; message: string; details?: unknown } {
  if (error instanceof FactorMcpError) {
    return error.toJSON();
  }

  if (error instanceof Error) {
    return {
      error: 'UNKNOWN_ERROR',
      message: error.message,
      details: error.stack,
    };
  }

  return {
    error: 'UNKNOWN_ERROR',
    message: String(error),
  };
}
