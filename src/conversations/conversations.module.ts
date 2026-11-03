import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConversationEntity } from './conversation.entity.js';
import { ConversationsService } from './conversations.service.js';
import { ConversationsController } from './conversations.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([ConversationEntity])],
  controllers: [ConversationsController],
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
