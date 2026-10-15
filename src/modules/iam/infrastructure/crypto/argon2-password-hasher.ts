import argon2 from 'argon2';

import type { PasswordHasherPort } from '../../application/ports/password-hasher.port';

/** Argon2id adapter for IAM password creation and verification. */
export class Argon2PasswordHasher implements PasswordHasherPort {
  hash(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(passwordHash, password);
    } catch {
      return false;
    }
  }
}
