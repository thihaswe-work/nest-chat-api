import { ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Model } from 'mongoose';
import { ConversationsService } from '../conversations/conversations.service.js';
import type { AuthUser } from '../auth/types/auth-user.js';
import { getInstanceId } from '../common/instance-info.js';
import {
  Message,
  MessageDocument,
} from '../messages/schemas/message.schema.js';

/**
 * Real-time chat gateway (Socket.IO).
 *
 * Authentication:
 *   The global JwtAuthGuard (AppModule -> APP_GUARD) also runs for WebSocket
 *   events. The client must send the JWT in the Socket.IO handshake:
 *
 *     io('http://localhost:3000', { auth: { token: accessToken } })
 *
 *   or as an `Authorization: Bearer <token>` handshake header. The guard verifies
 *   it and stores the identity on `socket.data.user`. Handlers never trust a
 *   `senderId` from the payload.
 *
 * Authorization:
 *   Every join/send calls ConversationsService.assertMember(), so only
 *   participants of a conversation can read its room or post to it.
 *
 * Events:
 *   client -> "conversation:join" { conversationId }
 *   client -> "message:send"      { conversationId, body }
 *   server -> "message:new"       savedMessage
 */
@WebSocketGateway({
  // Allow browser clients from any origin. Tighten this before production.
  cors: { origin: '*' },
})
export class ChatGateway {
  @WebSocketServer()
  server: Server;

  constructor(
    @InjectModel(Message.name) private messageModel: Model<MessageDocument>,
    private readonly conversationsService: ConversationsService,
  ) {}

  /**
   * Join a conversation room.
   *
   * Membership is checked before joining, so a user cannot listen in on a
   * conversation they were not invited to.
   */
  @SubscribeMessage('conversation:join')
  async handleJoinConversation(
    @MessageBody('conversationId') conversationId: number,
    @ConnectedSocket() client: Socket,
  ) {
    const user = this.getAuthenticatedUser(client);
    this.assertValidConversationId(conversationId);

    await this.assertConversationMember(conversationId, user.id);

    client.join(`room:${conversationId}`);
    return { conversationId, joined: true, instance: getInstanceId() };
  }

  /**
   * Persist a message and broadcast it to the conversation.
   *
   * Flow:
   *   1. Authenticate (guard) and authorize (membership).
   *   2. Insert a document into MongoDB (durable source of truth).
   *   3. Emit "message:new" to the room. The Redis adapter fans this out to
   *      every app instance that has members of that room.
   *   4. Return an acknowledgement to the sender.
   */
  @SubscribeMessage('message:send')
  async handleMessageSend(
    @MessageBody()
    data: {
      conversationId: number;
      body: string;
    },
    @ConnectedSocket() client: Socket,
  ) {
    const user = this.getAuthenticatedUser(client);

    if (!data || typeof data !== 'object') {
      throw new WsException('Invalid message payload');
    }

    this.assertValidConversationId(data.conversationId);

    const body = typeof data.body === 'string' ? data.body.trim() : '';
    if (!body || body.length > 4000) {
      throw new WsException('body must be between 1 and 4000 characters');
    }

    // Authorization: the sender must belong to the conversation.
    await this.assertConversationMember(data.conversationId, user.id);

    // The author is taken from the verified token, never from the payload.
    const newMessage = await this.messageModel.create({
      conversationId: data.conversationId,
      senderId: user.id,
      body,
    });

    // Broadcast to the room. The Redis adapter makes this reach members on
    // other server instances too. Do not use client.emit(): the sender should
    // receive the same canonical document as everyone else.
    this.server
      .to(`room:${data.conversationId}`)
      .emit('message:new', newMessage);

    return {
      status: 'sent',
      message: newMessage,
      // Lets a client/test see which replica accepted the event.
      instance: getInstanceId(),
    };
  }

  /** Identity is populated by JwtAuthGuard before any handler runs. */
  private getAuthenticatedUser(client: Socket): AuthUser {
    const user = client.data.user as AuthUser | undefined;

    if (!user) {
      // Defensive: should be unreachable while the global guard is registered.
      throw new WsException('Unauthorized');
    }

    return user;
  }

  /**
   * Reuse the HTTP membership rule, but translate its ForbiddenException into a
   * WsException. Without this, the WebSocket exception filter would report an
   * internal error and the client would get no useful message.
   */
  private async assertConversationMember(
    conversationId: number,
    userId: number,
  ): Promise<void> {
    try {
      await this.conversationsService.assertMember(conversationId, userId);
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw new WsException(error.message);
      }
      throw error;
    }
  }

  private assertValidConversationId(conversationId: number): void {
    if (!Number.isInteger(conversationId) || conversationId < 1) {
      throw new WsException('conversationId must be a positive integer');
    }
  }
}
