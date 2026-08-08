import { describe, it, expect, beforeAll } from 'vitest';
import { randomBytes } from 'crypto';

beforeAll(() => {
  process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString('base64');
});

describe('credentialsCrypto', () => {
  it('round-trips a secret through encrypt/decrypt', async () => {
    const { encryptSecret, decryptSecret } = await import('../src/credentialsCrypto');
    const plaintext = 'my-spotify-client-secret-xyz';
    const encrypted = encryptSecret(plaintext);

    expect(encrypted).not.toContain(plaintext);
    expect(decryptSecret(encrypted)).toBe(plaintext);
  });

  it('produces different ciphertext for the same plaintext (random IV)', async () => {
    const { encryptSecret } = await import('../src/credentialsCrypto');
    const a = encryptSecret('same-secret');
    const b = encryptSecret('same-secret');
    expect(a).not.toBe(b);
  });

  it('fails to decrypt with a tampered blob', async () => {
    const { encryptSecret, decryptSecret } = await import('../src/credentialsCrypto');
    const encrypted = encryptSecret('some-secret');
    const tampered = encrypted.slice(0, -4) + 'abcd';
    expect(() => decryptSecret(tampered)).toThrow();
  });
});
