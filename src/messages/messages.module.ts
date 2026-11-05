import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConversationsModule } from '../conversations/conversations.module.js';
import { MessagesController } from './messages.controller.js';
import { MessagesService } from './messages.service.js';
import { Message, MessageSchema } from './schemas/message.schema.js';

/**
 * Messages feature module (REST).
 *
 * Registers the same Mongoose Message model used by ChatModule so REST and
 * WebSocket writes share one schema. Imports ConversationsModule to reuse the
 * membership check (`assertMember`) before reading or writing message data.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Message.name, schema: MessageSchema }]),
    ConversationsModule,
  ],
  controllers: [MessagesController],
  providers: [MessagesService],
})
export class MessagesModule {}
