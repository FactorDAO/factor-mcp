import { describe, it, expect } from 'vitest';
import { FactorMcpError, SdkError, formatError } from '../src/utils/errors.js';

const KEYED_URL = 'https://base-mainnet.g.alchemy.com/v2/abcDEF1234567890fakeKey';

describe('FactorMcpError / formatError redaction (MND-1036)', () => {
  it('redacts a key-bearing URL in the wrapped error message when constructing FactorMcpError details', () => {
    const rpcError = new Error(`HTTP request failed. URL: ${KEYED_URL}`);
    const wrapped = new SdkError('Failed to read vault state', rpcError);
    const json = wrapped.toJSON();

    const detailsStr = JSON.stringify(json.details);
    expect(detailsStr).not.toContain('abcDEF1234567890fakeKey');
    expect(detailsStr).not.toContain('https://');
    expect(detailsStr).toContain('[redacted-url]');
  });

  it('redacts a key-bearing URL in the stack trace stored on details', () => {
    const rpcError = new Error('boom');
    rpcError.stack = `Error: boom\n    at fetch (${KEYED_URL})`;
    const wrapped = new SdkError('Failed', rpcError);
    const json = wrapped.toJSON();

    const detailsStr = JSON.stringify(json.details);
    expect(detailsStr).not.toContain('abcDEF1234567890fakeKey');
  });

  it('formatError redacts a plain (non-FactorMcpError) Error message and stack', () => {
    const rpcError = new Error(`Request failed: ${KEYED_URL}`);
    rpcError.stack = `Error: Request failed\n    at connect (${KEYED_URL})`;

    const formatted = formatError(rpcError);
    expect(formatted.message).not.toContain('abcDEF1234567890fakeKey');
    expect(formatted.message).toContain('[redacted-url]');
    expect(JSON.stringify(formatted.details)).not.toContain('abcDEF1234567890fakeKey');
  });

  it('formatError redacts a key-bearing string thrown directly (non-Error)', () => {
    const formatted = formatError(`raw failure at ${KEYED_URL}`);
    expect(formatted.message).not.toContain('abcDEF1234567890fakeKey');
    expect(formatted.message).toContain('[redacted-url]');
  });

  it('a FactorMcpError wrapping another FactorMcpError still serializes via toJSON without re-leaking', () => {
    const inner = new SdkError('inner failure', new Error(`url ${KEYED_URL}`));
    const outer = new FactorMcpError('outer failure', 'VAULT_ERROR', inner);
    const json = outer.toJSON();
    expect(JSON.stringify(json)).not.toContain('abcDEF1234567890fakeKey');
  });

  it('does not touch error text that has no URL', () => {
    const wrapped = new SdkError('Failed', new Error('nonce too low'));
    const json = wrapped.toJSON();
    expect((json.details as { message: string }).message).toBe('nonce too low');
  });
});
