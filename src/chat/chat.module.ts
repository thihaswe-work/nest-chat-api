import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChatGateway } from './chat.gateway.js';
import { Message, MessageSchema } from '../messages/schemas/message.schema.js';

/**
 * Real-time chat feature module.
 *
 * Two things must happen for a gateway to work:
 *   1. List it in `providers` so Nest instantiates it.
 *   2. Register the Mongoose model it injects with forFeature(). Providers
 *      registered in another module (even AppModule) are NOT visible here.
 *
 * The schema registration creates a "MessageModel" provider bound to the
 * Message schema, which is what @InjectModel(Message.name) looks up in
 * chat.gateway.ts.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Message.name, schema: MessageSchema }]),
  ],
  providers: [ChatGateway],
})
export class ChatModule {}
