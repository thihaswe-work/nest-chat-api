import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConversationEntity } from './conversation.entity.js';
import { ConversationsService } from './conversations.service.js';
import { ConversationsController } from './conversations.controller.js';

/**
 * Conversations feature module.
 *
 * Registers the TypeORM repository for ConversationEntity and wires the
 * controller/service pair. The service is exported in case chat features need
 * conversation lookups later.
 */
@Module({
  imports: [TypeOrmModule.forFeature([ConversationEntity])],
  controllers: [ConversationsController],
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
