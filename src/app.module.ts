import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { UsersModule } from './users/users.module.js';
import { ConversationsModule } from './conversations/conversations.module.js';
import { MessagesModule } from './messages/messages.module.js';
import { ChatModule } from './chat/chat.module.js';

@Module({
  imports: [UsersModule, ConversationsModule, MessagesModule, ChatModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
