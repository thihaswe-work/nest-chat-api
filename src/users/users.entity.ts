import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';

/**
 * PostgreSQL table: users.
 *
 * TypeORM entities are classes decorated with @Entity(). The decorators map
 * class properties to table columns:
 *   - @PrimaryGeneratedColumn() -> SERIAL/auto-increment primary key
 *   - @Column()                 -> a normal column
 *   - @CreateDateColumn()       -> timestamp filled in automatically on insert
 *
 * Because AppModule sets synchronize: true, TypeORM creates this table on boot.
 *
 * SECURITY NOTE: this column stores whatever the caller sends. The current
 * registration endpoint accepts a value called "passwordHash" but nothing in
 * this app hashes it. Add hashing (e.g. argon2/bcrypt) before using this for
 * real accounts.
 */
@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn()
  id: number;

  // unique: true creates a database constraint, preventing duplicate usernames.
  @Column({ unique: true })
  username: string;

  @Column()
  password: string;

  @CreateDateColumn()
  createdAt: Date;
}
