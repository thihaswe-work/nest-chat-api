import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from './users.entity.js';

/**
 * Business logic for users.
 *
 * TypeORM's Repository is an abstraction over the users table. It offers
 * helpers such as create() (build an entity instance) and save() (INSERT or
 * UPDATE). @InjectRepository(UserEntity) asks Nest for the repository that was
 * registered by TypeOrmModule.forFeature([UserEntity]) in UsersModule.
 */
@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserEntity)
    private usersRepository: Repository<UserEntity>,
  ) {}

  /**
   * Insert a new user.
   *
   * `create` only builds the object in memory; `save` performs the INSERT and
   * returns the row including generated fields (id, createdAt).
   *
   * A duplicate username makes Postgres throw a unique-constraint error, which
   * currently bubbles up as a 500. A production version should catch it and
   * return 409 Conflict. Hashing passed-in plaintext passwords is also required.
   */
  async createUser(username: string, password: string): Promise<UserEntity> {
    const user = this.usersRepository.create({ username, password });
    return this.usersRepository.save(user);
  }
}
