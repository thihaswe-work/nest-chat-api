import { Module } from '@nestjs/common';
import { MessagesService } from './messages.service.js';
import { MessagesController } from './messages.controller.js';

/**
 * Messages feature module (REST).
 *
 * Note: no MongooseModule.forFeature() here because the current service does not
 * inject a model. Add it when you implement real persistence - the WebSocket
 * ChatModule already registers the same Message schema for its own use.
 */
@Module({
  controllers: [MessagesController],
  providers: [MessagesService],
})
export class MessagesModule {}
