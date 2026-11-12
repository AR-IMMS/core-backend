export interface EncryptedEnrollmentResult {
  readonly keyVersion: string;
  readonly iv: string;
  readonly ciphertext: string;
  readonly authTag: string;
}

export interface EnrollmentRecoveryCipherPort {
  encrypt(plaintext: string, additionalData: string): EncryptedEnrollmentResult;
  decrypt(encrypted: EncryptedEnrollmentResult, additionalData: string): string;
}

export const ENROLLMENT_RECOVERY_CIPHER = Symbol('ENROLLMENT_RECOVERY_CIPHER');
