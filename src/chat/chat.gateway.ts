import { InjectModel } from '@nestjs/mongoose';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Message } from '../messages/message.entity.js';
import { MessageDocument } from '../messages/schemas/message.schema.js';
import { Model } from 'mongoose';

@WebSocketGateway({
  cors: { origin: '*' },
})
export class ChatGateway {
  @WebSocketServer()
  server: Server;

  constructor(
    @InjectModel(Message.name) private messageModel: Model<MessageDocument>,
  ) {}
  // Client joins a specific room/conversation
  @SubscribeMessage('conversation:join')
  async handleJoinConversation(
    @MessageBody('conversationId') conversationId: number,
    @ConnectedSocket() client: Socket,
  ) {
    client.join(`room:${conversationId}`);
    return { conversationId, joined: true };
  }

  // Client sends a message
  @SubscribeMessage('message:send')
  async handleMessageSend(
    @MessageBody()
    data: {
      conversationId: number;
      senderId: number;
      body: string;
    },
  ) {
    // 1. Save message to MongoDB
    const newMessage = await this.messageModel.create({
      conversationId: data.conversationId,
      senderId: data.senderId,
      body: data.body,
    });

    // 2. Broadcast message to everyone in that room (Redis handles multi-server sync)
    this.server
      .to(`room:${data.conversationId}`)
      .emit('message:new', newMessage);

    return { status: 'sent', message: newMessage };
  }
}
