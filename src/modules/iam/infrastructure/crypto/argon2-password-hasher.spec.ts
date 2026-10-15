import { Argon2PasswordHasher } from './argon2-password-hasher';

describe('Argon2PasswordHasher', () => {
  /** It stores only an Argon2id hash and verifies the original password. */
  test('hashes with Argon2id and verifies the supplied password', async () => {
    const hasher = new Argon2PasswordHasher();
    const hash = await hasher.hash('a sufficiently long test password');

    expect(hash).not.toBe('a sufficiently long test password');
    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(
      hasher.verify(hash, 'a sufficiently long test password'),
    ).resolves.toBe(true);
  });

  /** It rejects an incorrect password and treats malformed stored hashes as invalid. */
  test('returns false for an incorrect password or malformed hash', async () => {
    const hasher = new Argon2PasswordHasher();
    const hash = await hasher.hash('right password');

    await expect(hasher.verify(hash, 'wrong password')).resolves.toBe(false);
    await expect(hasher.verify('not-a-hash', 'right password')).resolves.toBe(
      false,
    );
  });
});
