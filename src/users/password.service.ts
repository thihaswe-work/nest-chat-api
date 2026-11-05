import { Injectable } from '@nestjs/common';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing with Node's built-in scrypt.
 *
 * Why scrypt and not a plain hash?
 *   - scrypt is deliberately slow and memory-hard, which makes brute-forcing a
 *     stolen database expensive.
 *   - A unique random salt per password prevents rainbow-table attacks and makes
 *     identical passwords produce different hashes.
 *
 * Stored format: `scrypt$<salt-hex>$<hash-hex>`
 * The algorithm name is included so future upgrades (e.g. argon2) can coexist
 * with old hashes and be migrated lazily.
 *
 * No third-party dependency is required; Node ships scrypt in `node:crypto`.
 * The alternative would be bcrypt/argon2, which need native builds.
 */
@Injectable()
export class PasswordService {
  private static readonly KEY_LENGTH = 64;
  private static readonly SALT_BYTES = 16;
  private static readonly ALGORITHM = 'scrypt';

  /** Hash a plaintext password. The result is safe to store. */
  async hash(password: string): Promise<string> {
    const salt = randomBytes(PasswordService.SALT_BYTES).toString('hex');
    const derivedKey = await this.derive(password, salt);

    return `${PasswordService.ALGORITHM}$${salt}$${derivedKey.toString('hex')}`;
  }

  /**
   * Compare a plaintext password against a stored hash.
   *
   * `timingSafeEqual` compares in constant time, so the duration of the check
   * does not reveal how many leading bytes matched.
   */
  async verify(password: string, storedHash: string): Promise<boolean> {
    const [algorithm, salt, hash] = storedHash.split('$');

    if (algorithm !== PasswordService.ALGORITHM || !salt || !hash) {
      return false;
    }

    const expected = Buffer.from(hash, 'hex');
    if (expected.length !== PasswordService.KEY_LENGTH) {
      return false;
    }

    const actual = await this.derive(password, salt);
    return timingSafeEqual(expected, actual);
  }

  /** Promise wrapper around the callback-based crypto.scrypt. */
  private derive(password: string, salt: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      scrypt(
        password,
        salt,
        PasswordService.KEY_LENGTH,
        (error, derivedKey) => {
          if (error) {
            reject(error);
          } else {
            resolve(derivedKey);
          }
        },
      );
    });
  }
}
