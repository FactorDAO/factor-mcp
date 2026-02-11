/**
 * Format Utility Tests
 *
 * Validates that formatWei and formatBps produce correct human-readable values.
 * These formatters are used across all vault tool responses to add "Fmt" fields.
 */
import { describe, it, expect } from 'vitest';
import { formatWei, formatBps } from '../src/utils/format.js';

describe('formatWei', () => {
  // 18 decimals (default — vault shares, WETH, etc.)
  it('formats 18-decimal values correctly', () => {
    expect(formatWei('1000000000000000000')).toBe('1');
    expect(formatWei('500000000000000000')).toBe('0.5');
    expect(formatWei('1234567890000000000')).toBe('1.23456789');
    expect(formatWei('0')).toBe('0');
  });

  it('formats large 18-decimal values', () => {
    // 1,000 tokens
    expect(formatWei('1000000000000000000000')).toBe('1000');
    // 1,000,000 tokens
    expect(formatWei('1000000000000000000000000')).toBe('1000000');
  });

  it('formats fractional 18-decimal values', () => {
    // 0.001 tokens
    expect(formatWei('1000000000000000')).toBe('0.001');
    // 1 wei
    expect(formatWei('1')).toBe('0.000000000000000001');
  });

  // 6 decimals (USDC, USDT)
  it('formats 6-decimal values correctly', () => {
    expect(formatWei('1000000', 6)).toBe('1');
    expect(formatWei('500000', 6)).toBe('0.5');
    expect(formatWei('1234567', 6)).toBe('1.234567');
    expect(formatWei('0', 6)).toBe('0');
  });

  it('formats large 6-decimal values', () => {
    // 1,000 USDC
    expect(formatWei('1000000000', 6)).toBe('1000');
    // 1,000,000 USDC
    expect(formatWei('1000000000000', 6)).toBe('1000000');
  });

  // 8 decimals (WBTC)
  it('formats 8-decimal values correctly', () => {
    expect(formatWei('100000000', 8)).toBe('1');
    expect(formatWei('50000000', 8)).toBe('0.5');
  });

  // BigInt input
  it('accepts BigInt values', () => {
    expect(formatWei(1000000000000000000n)).toBe('1');
    expect(formatWei(1000000n, 6)).toBe('1');
  });

  // Edge cases
  it('returns undefined for undefined', () => {
    expect(formatWei(undefined)).toBeUndefined();
  });

  it('returns undefined for null', () => {
    expect(formatWei(null)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(formatWei('')).toBeUndefined();
  });

  it('returns undefined for invalid string', () => {
    expect(formatWei('not_a_number')).toBeUndefined();
  });

  it('handles zero with different decimals', () => {
    expect(formatWei('0', 6)).toBe('0');
    expect(formatWei('0', 18)).toBe('0');
    expect(formatWei('0', 8)).toBe('0');
  });

  // Realistic vault scenarios
  it('formats realistic USDC deposit amount (100 USDC)', () => {
    expect(formatWei('100000000', 6)).toBe('100');
  });

  it('formats realistic vault share amount', () => {
    // 1.5 shares (18 decimals)
    expect(formatWei('1500000000000000000')).toBe('1.5');
  });

  it('formats realistic price per share', () => {
    // price per share 1.05 (18 decimals)
    expect(formatWei('1050000000000000000')).toBe('1.05');
  });

  it('formats realistic WETH amount (0.1 ETH)', () => {
    expect(formatWei('100000000000000000')).toBe('0.1');
  });
});

describe('formatBps', () => {
  it('formats common fee values', () => {
    expect(formatBps('0')).toBe('0.00%');
    expect(formatBps('100')).toBe('1.00%');
    expect(formatBps('200')).toBe('2.00%');
    expect(formatBps('500')).toBe('5.00%');
    expect(formatBps('1000')).toBe('10.00%');
    expect(formatBps('10000')).toBe('100.00%');
  });

  it('formats fractional basis points', () => {
    expect(formatBps('50')).toBe('0.50%');
    expect(formatBps('1')).toBe('0.01%');
    expect(formatBps('25')).toBe('0.25%');
    expect(formatBps('150')).toBe('1.50%');
  });

  it('accepts BigInt values', () => {
    expect(formatBps(100n)).toBe('1.00%');
    expect(formatBps(10000n)).toBe('100.00%');
  });

  it('returns undefined for undefined', () => {
    expect(formatBps(undefined)).toBeUndefined();
  });

  it('returns undefined for null', () => {
    expect(formatBps(null)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(formatBps('')).toBeUndefined();
  });

  it('returns undefined for NaN string', () => {
    expect(formatBps('not_a_number')).toBeUndefined();
  });

  // Realistic vault fee scenarios
  it('formats typical deposit fee (0.5%)', () => {
    expect(formatBps('50')).toBe('0.50%');
  });

  it('formats typical performance fee (20%)', () => {
    expect(formatBps('2000')).toBe('20.00%');
  });

  it('formats typical management fee (2%)', () => {
    expect(formatBps('200')).toBe('2.00%');
  });

  it('formats max debt ratio (100%)', () => {
    expect(formatBps('10000')).toBe('100.00%');
  });
});
