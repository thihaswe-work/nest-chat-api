import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, QueryFailedError, Repository } from 'typeorm';
import { UserEntity } from './users.entity.js';
import { PasswordService } from './password.service.js';

/**
 * The only user fields that are safe to send to clients.
 * Never return the entity directly: it contains the password hash.
 */
export interface PublicUser {
  id: number;
  username: string;
  createdAt: Date;
}

/**
 * Business logic for users and credentials.
 *
 * Security rules enforced here:
 *   - Plaintext passwords are hashed before they are saved.
 *   - Passwords are never selected unless explicitly requested for login
 *     (the column is `select: false` in UserEntity).
 *   - Public serialization is explicit, so adding a new secret column cannot
 *     accidentally leak through a spread operator.
 */
@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
    private readonly passwordService: PasswordService,
  ) {}

  /**
   * Create a user with a hashed password.
   *
   * The unique constraint on `username` is the source of truth; we translate its
   * Postgres error (23505) into a clean 409 Conflict instead of a 500.
   */
  async createUser(username: string, password: string): Promise<UserEntity> {
    const passwordHash = await this.passwordService.hash(password);
    const user = this.usersRepository.create({
      username,
      password: passwordHash,
    });

    try {
      return await this.usersRepository.save(user);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('Username is already taken');
      }
      throw error;
    }
  }

  /**
   * Look up a user including the password hash.
   *
   * `select: false` on the password column means a normal find() omits it, so we
   * must ask for it explicitly. This method is for login only - never return its
   * result to a client.
   */
  findByUsernameForAuth(username: string): Promise<UserEntity | null> {
    return this.usersRepository
      .createQueryBuilder('user')
      .addSelect('user.password')
      .where('user.username = :username', { username })
      .getOne();
  }

  /** Look up a public-safe user by id. Throws 404 if it does not exist. */
  async findById(id: number): Promise<UserEntity> {
    const user = await this.usersRepository.findOneBy({ id });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  /** Fetch several users at once; used to validate conversation participants. */
  findByIds(ids: number[]): Promise<UserEntity[]> {
    return this.usersRepository.findBy({ id: In(ids) });
  }

  /**
   * Verify a username/password pair.
   *
   * Returns null for both "unknown user" and "wrong password" so callers cannot
   * distinguish the two cases. The caller turns null into a generic 401.
   */
  async validateCredentials(
    username: string,
    password: string,
  ): Promise<UserEntity | null> {
    const user = await this.findByUsernameForAuth(username);

    if (!user) {
      return null;
    }

    const passwordMatches = await this.passwordService.verify(
      password,
      user.password,
    );

    return passwordMatches ? user : null;
  }

  /** Explicit allow-list serialization: never leaks the password hash. */
  toPublicUser(user: UserEntity): PublicUser {
    return {
      id: user.id,
      username: user.username,
      createdAt: user.createdAt,
    };
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      (error as QueryFailedError & { driverError?: { code?: string } })
        .driverError?.code === '23505'
    );
  }
}
