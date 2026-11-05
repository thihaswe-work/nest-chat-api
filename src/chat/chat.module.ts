import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChatGateway } from './chat.gateway.js';
import { ConversationsModule } from '../conversations/conversations.module.js';
import { Message, MessageSchema } from '../messages/schemas/message.schema.js';

/**
 * Real-time chat feature module.
 *
 * Three things must happen for a gateway to work:
 *   1. List it in `providers` so Nest instantiates it.
 *   2. Register the Mongoose model it injects with forFeature(). Providers
 *      registered in another module (even AppModule) are NOT visible here.
 *   3. Import every module whose exported services the gateway injects. Here
 *      that is ConversationsModule, which supplies assertMember().
 *
 * Authentication is global: JwtAuthGuard is registered as APP_GUARD in
 * AppModule and therefore also protects every @SubscribeMessage handler.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Message.name, schema: MessageSchema }]),
    ConversationsModule,
  ],
  providers: [ChatGateway],
})
export class ChatModule {}
