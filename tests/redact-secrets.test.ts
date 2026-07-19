import { describe, it, expect } from 'vitest';
import { redactSecrets } from '../src/utils/redact-secrets.js';

describe('redactSecrets (MND-1036)', () => {
  it('redacts an Alchemy-keyed RPC URL embedded in a viem-style error message', () => {
    const msg =
      'HTTP request failed. URL: https://base-mainnet.g.alchemy.com/v2/abcDEF1234567890fakeKey ' +
      'Request body: {"method":"eth_call"}';
    const out = redactSecrets(msg);
    expect(out).not.toContain('abcDEF1234567890fakeKey');
    expect(out).not.toContain('https://');
    expect(out).toContain('[redacted-url]');
    expect(out).toContain('HTTP request failed');
  });

  it('redacts multiple URLs in the same string', () => {
    const out = redactSecrets('first https://a.example.com/v2/key1 then https://b.example.com/v2/key2 done');
    expect(out).not.toContain('key1');
    expect(out).not.toContain('key2');
    expect((out.match(/\[redacted-url\]/g) ?? []).length).toBe(2);
  });

  it('leaves text with no URL untouched', () => {
    expect(redactSecrets('plain error, no url here')).toBe('plain error, no url here');
  });

  it('handles empty string', () => {
    expect(redactSecrets('')).toBe('');
  });
});
