import { redactSecrets } from './redact-secrets.js';

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
      // MND-1036: `details` is very often the raw underlying error from an
      // RPC call (viem HttpRequestError on any Alchemy failure embeds the
      // full request URL — key included — in .message/.stack). This is the
      // single choke point nearly every tool handler in this repo routes
      // through via `throw new SdkError('safe text', error)`, so redacting
      // here closes the leak across the whole tool surface at once.
      this.details = {
        message: redactSecrets(details.message),
        name: details.name,
        ...(details.stack ? { stack: redactSecrets(details.stack) } : {}),
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
    // MND-1036: same rationale as the FactorMcpError constructor above —
    // this is the fallback path for any error that wasn't already wrapped
    // in a FactorMcpError (e.g. a raw viem error thrown past a handler
    // that didn't catch it), and it's the direct sink for the MCP tool
    // response text via server.ts's top-level catch-all.
    return {
      error: 'UNKNOWN_ERROR',
      message: redactSecrets(error.message),
      details: error.stack ? redactSecrets(error.stack) : error.stack,
    };
  }

  return {
    error: 'UNKNOWN_ERROR',
    message: redactSecrets(String(error)),
  };
}
