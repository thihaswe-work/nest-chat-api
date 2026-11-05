import { InjectModel } from '@nestjs/mongoose';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Model } from 'mongoose';
import {
  Message,
  MessageDocument,
} from '../messages/schemas/message.schema.js';

/**
 * Real-time chat endpoint (Socket.IO).
 *
 * A gateway is the WebSocket equivalent of a controller:
 *   - @WebSocketGateway() declares the endpoint and CORS settings.
 *   - @SubscribeMessage('event') maps an incoming client event to a method.
 *   - @WebSocketServer() gives us the Socket.IO server so we can emit to rooms.
 *
 * Event contract:
 *   client -> "conversation:join" { conversationId }
 *   client -> "message:send"      { conversationId, senderId, body }
 *   server -> "message:new"       savedMessage
 *
 * Rooms are named "room:<conversationId>". A Socket.IO room is just a set of
 * socket IDs. Emitting to a room sends the event to every member - on this
 * server *and*, thanks to the Redis adapter in redis-io.adapter.ts, on every
 * other server instance too.
 */
@WebSocketGateway({
  // Allow browser clients from any origin. Tighten this before production.
  cors: { origin: '*' },
})
export class ChatGateway {
  @WebSocketServer()
  server: Server;

  // The Mongoose model is provided by ChatModule via MongooseModule.forFeature().
  // It is the same Message schema used by the Mongo "messages" collection.
  constructor(
    @InjectModel(Message.name) private messageModel: Model<MessageDocument>,
  ) {}

  /**
   * Join a conversation room.
   *
   * The client calls this once per conversation it opens. Socket.IO remembers
   * the membership on the socket, so later broadcasts reach this client.
   * Returning a value acknowledges the event to the caller.
   */
  @SubscribeMessage('conversation:join')
  async handleJoinConversation(
    @MessageBody('conversationId') conversationId: number,
    @ConnectedSocket() client: Socket,
  ) {
    client.join(`room:${conversationId}`);
    return { conversationId, joined: true };
  }

  /**
   * Persist a message and broadcast it to the conversation.
   *
   * Flow:
   *   1. Insert a document into MongoDB (the durable source of truth).
   *   2. Emit "message:new" to the room. The Redis adapter fans this out to
   *      every app instance that has members of that room.
   *   3. Return an acknowledgement to the sender.
   *
   * In a production system you would also validate the payload, authenticate
   * senderId, and handle write failures before emitting.
   */
  @SubscribeMessage('message:send')
  async handleMessageSend(
    @MessageBody()
    data: {
      conversationId: number;
      senderId: number;
      body: string;
    },
  ) {
    // 1. Save message to MongoDB. create() returns the stored document,
    //    including its generated _id and createdAt/updatedAt timestamps.
    const newMessage = await this.messageModel.create({
      conversationId: data.conversationId,
      senderId: data.senderId,
      body: data.body,
    });

    // 2. Broadcast to everyone in that room. Do not use client.emit() here:
    //    the sender's copy comes through this room broadcast as well.
    this.server
      .to(`room:${data.conversationId}`)
      .emit('message:new', newMessage);

    return { status: 'sent', message: newMessage };
  }
}
