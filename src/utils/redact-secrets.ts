/**
 * MND-1031/MND-1036: Alchemy RPC URLs embed the API key directly in the
 * path (`https://${network}.g.alchemy.com/v2/${apiKey}`), and viem's
 * HttpRequestError embeds the full request URL — key included — in
 * `.message` on any RPC failure. Strips URL-shaped substrings wholesale
 * (not just Alchemy-shaped ones) so any provider wired in later gets the
 * same protection for free.
 *
 * Mirrors `@kairos/agent-executor/src/utils/redact-secrets.ts`,
 * `@kairos/backend/src/lib/redact-secrets.ts`, and
 * `@kairos/signing-service/src/redact-secrets.ts` — kept as a small
 * standalone copy since these services don't share a package.
 */
const URL_PATTERN = /https?:\/\/[^\s"'<>)]+/gi;

export function redactSecrets(text: string): string {
  if (!text) return text;
  return text.replace(URL_PATTERN, '[redacted-url]');
}
