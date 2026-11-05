import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConversationEntity } from './conversation.entity.js';
import { ConversationsService } from './conversations.service.js';
import { ConversationsController } from './conversations.controller.js';
import { UsersModule } from '../users/users.module.js';

/**
 * Conversations feature module.
 *
 * Imports UsersModule so ConversationsService can validate participant ids.
 * Exports ConversationsService because ChatModule and MessagesModule call
 * assertMember() before touching message data.
 */
@Module({
  imports: [TypeOrmModule.forFeature([ConversationEntity]), UsersModule],
  controllers: [ConversationsController],
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
