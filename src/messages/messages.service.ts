import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import { ConversationsService } from '../conversations/conversations.service.js';
import { CreateMessageDto } from './dto/create-message.dto.js';
import { UpdateMessageDto } from './dto/update-message.dto.js';
import { Message, MessageDocument } from './schemas/message.schema.js';

/**
 * REST message logic with membership/ownership authorization.
 *
 * Rules:
 *   - create:  must be a participant of the target conversation
 *   - read:    must be a participant of the message's conversation
 *   - update:  must be the sender
 *   - delete:  must be the sender
 *
 * The WebSocket gateway follows the same rules. Keeping authorization here means
 * both transports share one implementation instead of drifting apart.
 */
@Injectable()
export class MessagesService {
  constructor(
    @InjectModel(Message.name)
    private readonly messageModel: Model<MessageDocument>,
    private readonly conversationsService: ConversationsService,
  ) {}

  /** Author comes from the verified token; membership is checked first. */
  async create(userId: number, dto: CreateMessageDto) {
    await this.conversationsService.assertMember(dto.conversationId, userId);

    return this.messageModel.create({
      conversationId: dto.conversationId,
      senderId: userId,
      body: dto.body,
    });
  }

  /**
   * Newest messages first. Always paginated: `limit` is clamped to 1..100 so a
   * client cannot ask for an unbounded history and exhaust memory.
   */
  async findAll(userId: number, conversationId: number, limit = 50) {
    await this.conversationsService.assertMember(conversationId, userId);

    const safeLimit = Math.min(Math.max(limit, 1), 100);

    return this.messageModel
      .find({ conversationId })
      .sort({ createdAt: -1 })
      .limit(safeLimit)
      .lean()
      .exec();
  }

  async findOne(userId: number, id: string) {
    const message = await this.getMessageOrThrow(id);
    await this.conversationsService.assertMember(
      message.conversationId,
      userId,
    );
    return message;
  }

  /** Only the original sender may edit their message. */
  async update(userId: number, id: string, dto: UpdateMessageDto) {
    const message = await this.getMessageOrThrow(id);
    await this.conversationsService.assertMember(
      message.conversationId,
      userId,
    );

    if (message.senderId !== userId) {
      throw new ForbiddenException('You can only edit your own messages');
    }

    message.body = dto.body;
    return message.save(); // timestamps: true updates updatedAt automatically
  }

  /** Only the original sender may delete their message. */
  async remove(userId: number, id: string) {
    const message = await this.getMessageOrThrow(id);
    await this.conversationsService.assertMember(
      message.conversationId,
      userId,
    );

    if (message.senderId !== userId) {
      throw new ForbiddenException('You can only delete your own messages');
    }

    await message.deleteOne();
    return { deleted: true, id };
  }

  /** Validate the Mongo id, load the document, or throw a clean HTTP error. */
  private async getMessageOrThrow(id: string): Promise<MessageDocument> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid message id');
    }

    const message = await this.messageModel.findById(id);

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    return message;
  }
}
