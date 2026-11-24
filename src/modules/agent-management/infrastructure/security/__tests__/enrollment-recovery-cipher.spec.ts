import { randomBytes } from 'node:crypto';
import { EnrollmentRecoveryCipher } from '../enrollment-recovery-cipher';

describe('EnrollmentRecoveryCipher', () => {
  it('encrypts and decrypts a result using its attempt-bound context', () => {
    const cipher = new EnrollmentRecoveryCipher(
      randomBytes(32).toString('base64'),
    );
    const encrypted = cipher.encrypt(
      '{"access_token":"secret"}',
      'attempt:fingerprint',
    );
    const encryptedAgain = cipher.encrypt(
      '{"access_token":"secret"}',
      'attempt:fingerprint',
    );

    expect(encrypted.ciphertext).not.toContain('secret');
    expect(encrypted.iv).not.toBe(encryptedAgain.iv);
    expect(cipher.decrypt(encrypted, 'attempt:fingerprint')).toBe(
      '{"access_token":"secret"}',
    );
  });

  it('rejects decryption with a different attempt context', () => {
    const cipher = new EnrollmentRecoveryCipher(
      randomBytes(32).toString('base64'),
    );
    const encrypted = cipher.encrypt(
      '{"access_token":"secret"}',
      'attempt:fingerprint',
    );

    expect(() =>
      cipher.decrypt(encrypted, 'other-attempt:fingerprint'),
    ).toThrow();
  });

  it('rejects tampered ciphertext', () => {
    const cipher = new EnrollmentRecoveryCipher(
      randomBytes(32).toString('base64'),
    );
    const encrypted = cipher.encrypt(
      '{"access_token":"secret"}',
      'attempt:fingerprint',
    );
    const tamperedCiphertext = Buffer.from(encrypted.ciphertext, 'base64');
    tamperedCiphertext[0] ^= 1;

    expect(() =>
      cipher.decrypt(
        { ...encrypted, ciphertext: tamperedCiphertext.toString('base64') },
        'attempt:fingerprint',
      ),
    ).toThrow();
  });

  it('rejects keys that are not canonical base64-encoded 256-bit keys', () => {
    expect(() => new EnrollmentRecoveryCipher('not-a-key')).toThrow(
      'recovery key must be a base64-encoded 32-byte key',
    );
  });
});
