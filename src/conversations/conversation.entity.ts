import {
  Column,
  CreateDateColumn,
  Entity,
  JoinTable,
  ManyToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserEntity } from '../users/users.entity.js';

/**
 * PostgreSQL table: conversations.
 *
 * Authorization model:
 *   - `ownerId` is the user who created the conversation. Only the owner may
 *     update or delete it.
 *   - `participants` is a many-to-many relation backed by the
 *     `conversation_participants` join table. Only participants may read the
 *     conversation, list its messages, or join its WebSocket room.
 *
 * Messages are not stored here; they live in MongoDB and reference `id` through
 * Message.conversationId.
 *
 * Note: there is no database-level foreign key from MongoDB to this table.
 * Membership checks in ConversationsService are what keep that reference safe.
 */
@Entity('conversations')
export class ConversationEntity {
  @PrimaryGeneratedColumn()
  id: number;

  /** UserEntity.id of the creator. Owner-only operations check this field. */
  @Column()
  ownerId: number;

  /**
   * Users allowed to read and post in this conversation.
   *
   * @JoinTable creates `conversation_participants` with columns
   * `conversationId` and `userId`. TypeORM maintains both sides of the relation.
   *
   * Not eager: queries that need participants must join explicitly, which keeps
   * list endpoints from silently loading extra rows.
   */
  @ManyToMany(() => UserEntity)
  @JoinTable({
    name: 'conversation_participants',
    joinColumn: { name: 'conversationId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'userId', referencedColumnName: 'id' },
  })
  participants: UserEntity[];

  @CreateDateColumn()
  createdAt: Date;
}
