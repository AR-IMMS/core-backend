import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type {
  EncryptedEnrollmentResult,
  EnrollmentRecoveryCipherPort,
} from '../../application/registration/ports/enrollment-recovery.port';

const ALGORITHM = 'aes-256-gcm';
const KEY_VERSION = 'v1';
const IV_BYTES = 12;

/** Encrypts short-lived enrollment results with a deployment-managed key. */
export class EnrollmentRecoveryCipher implements EnrollmentRecoveryCipherPort {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    const key = Buffer.from(base64Key, 'base64');
    if (key.length !== 32 || key.toString('base64') !== base64Key) {
      throw new Error(
        'Enrollment recovery key must be a base64-encoded 32-byte key',
      );
    }
    this.key = key;
  }

  encrypt(
    plaintext: string,
    additionalData: string,
  ): EncryptedEnrollmentResult {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    cipher.setAAD(Buffer.from(additionalData, 'utf8'));
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    return {
      keyVersion: KEY_VERSION,
      iv: iv.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
    };
  }

  decrypt(
    encrypted: EncryptedEnrollmentResult,
    additionalData: string,
  ): string {
    if (encrypted.keyVersion !== KEY_VERSION) {
      throw new Error('Unsupported enrollment recovery key version');
    }
    const iv = Buffer.from(encrypted.iv, 'base64');
    const authTag = Buffer.from(encrypted.authTag, 'base64');
    if (iv.length !== IV_BYTES || authTag.length !== 16) {
      throw new Error('Invalid enrollment recovery envelope');
    }

    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAAD(Buffer.from(additionalData, 'utf8'));
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }
}
