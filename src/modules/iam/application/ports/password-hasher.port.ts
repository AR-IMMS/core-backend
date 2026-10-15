/** Password hashing boundary; plaintext values are not persisted or logged. */
export interface PasswordHasherPort {
  hash(password: string): Promise<string>;
  verify(passwordHash: string, password: string): Promise<boolean>;
}
