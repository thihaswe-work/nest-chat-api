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
 * SECURITY: `password` stores a scrypt hash, never plaintext (see
 * PasswordService). `select: false` keeps the hash out of normal queries, so a
 * careless `find()` cannot leak it to an API response. UsersService explicitly
 * opts in with addSelect() only during login.
 */
@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn()
  id: number;

  // unique: true creates a database constraint, preventing duplicate usernames.
  @Column({ unique: true })
  username: string;

  // The scrypt hash in "scrypt$salt$hash" format. Excluded from SELECT by default.
  @Column({ select: false })
  password: string;

  @CreateDateColumn()
  createdAt: Date;
}
