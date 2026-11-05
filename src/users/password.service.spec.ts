import { PasswordService } from './password.service.js';

/**
 * Unit tests for the password hashing contract.
 * Run with: npm test
 */
describe('PasswordService', () => {
  const passwordService = new PasswordService();

  it('hashes a password in the scrypt$salt$hash format', async () => {
    const hash = await passwordService.hash('correct horse battery staple');

    expect(hash).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(hash).not.toContain('correct horse battery staple');
  });

  it('uses a unique salt for every hash', async () => {
    const first = await passwordService.hash('same-password');
    const second = await passwordService.hash('same-password');

    expect(first).not.toBe(second);
  });

  it('verifies the original password', async () => {
    const hash = await passwordService.hash('s3cret-password');

    await expect(passwordService.verify('s3cret-password', hash)).resolves.toBe(
      true,
    );
  });

  it('rejects a wrong password', async () => {
    const hash = await passwordService.hash('s3cret-password');

    await expect(passwordService.verify('wrong-password', hash)).resolves.toBe(
      false,
    );
  });

  it('rejects malformed or unsupported hashes', async () => {
    await expect(passwordService.verify('secret', 'not-a-hash')).resolves.toBe(
      false,
    );
    await expect(
      passwordService.verify('secret', 'bcrypt$salt$hash'),
    ).resolves.toBe(false);
  });
});
