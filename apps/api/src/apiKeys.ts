import { createHash, randomBytes, timingSafeEqual } from 'crypto';

const KEY_PREFIX = 'ilm_';

/**
 * Deterministic SHA-256 hash, no per-row salt. This is safe here (unlike for
 * user passwords) because the plaintext is always a 24-byte crypto-random
 * token — 192 bits of entropy makes rainbow tables/brute force infeasible
 * regardless of salting, and a deterministic hash lets auth do an indexed
 * `WHERE key_hash = ?` lookup instead of scanning every row.
 */
export function hashApiKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

/**
 * Generate a new plaintext API key (shown to the operator once) plus its
 * hash (the only thing persisted to the database).
 */
export function generateApiKey(): { plaintext: string; hash: string } {
  const plaintext = KEY_PREFIX + randomBytes(24).toString('hex');
  return { plaintext, hash: hashApiKey(plaintext) };
}

export function verifyApiKey(plaintext: string, storedHash: string): boolean {
  const actual = Buffer.from(hashApiKey(plaintext), 'hex');
  const expected = Buffer.from(storedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
