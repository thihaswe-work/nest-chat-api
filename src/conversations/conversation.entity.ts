import { CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * PostgreSQL table: conversations.
 *
 * Currently this only stores an id and a creation timestamp. A real chat app
 * would add membership here, for example:
 *   - participant IDs (many-to-many with users), or
 *   - a separate conversation_participants join table,
 *   - plus a title / isGroup flag.
 *
 * Messages are NOT stored here; they live in MongoDB and reference this id via
 * the Message.conversationId field.
 */
@Entity('conversations')
export class ConversationEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @CreateDateColumn()
  createdAt: Date;
}
