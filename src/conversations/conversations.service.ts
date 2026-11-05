import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConversationEntity } from './conversation.entity.js';
import { CreateConversationDto } from './dto/create-conversation.dto.js';
import { UpdateConversationDto } from './dto/update-conversation.dto.js';
import { UsersService } from '../users/users.service.js';

/**
 * Conversations business logic + authorization.
 *
 * Authorization rules:
 *   - read (findAll/findOne):      must be a participant
 *   - update participant list:     must be the owner
 *   - delete:                      must be the owner
 *
 * These checks live in the service, not the controller, so the WebSocket gateway
 * can reuse `assertMember()` and cannot forget the rule.
 */
@Injectable()
export class ConversationsService {
  constructor(
    @InjectRepository(ConversationEntity)
    private readonly conversationsRepository: Repository<ConversationEntity>,
    private readonly usersService: UsersService,
  ) {}

  /**
   * Create a conversation owned by `ownerId`.
   *
   * The owner is always a participant. Every requested participant must exist;
   * otherwise the whole request fails with 400 (no partial conversations).
   */
  async create(
    ownerId: number,
    dto: CreateConversationDto,
  ): Promise<ConversationEntity> {
    const participantIds = this.uniqueIds([ownerId, ...dto.participantIds]);
    const participants = await this.loadParticipants(participantIds);

    const conversation = this.conversationsRepository.create({
      ownerId,
      participants,
    });

    return this.conversationsRepository.save(conversation);
  }

  /** List only conversations the user belongs to (newest first). */
  findAllForUser(userId: number): Promise<ConversationEntity[]> {
    return this.conversationsRepository
      .createQueryBuilder('conversation')
      .leftJoinAndSelect('conversation.participants', 'participant')
      .where('conversation.ownerId = :userId', { userId })
      .orWhere('participant.id = :userId', { userId })
      .distinct(true)
      .orderBy('conversation.createdAt', 'DESC')
      .getMany();
  }

  /**
   * Fetch one conversation after checking membership.
   * Returns 404 when it does not exist and 403 when the user is not a member.
   */
  async findOneForUser(
    id: number,
    userId: number,
  ): Promise<ConversationEntity> {
    const conversation = await this.conversationsRepository
      .createQueryBuilder('conversation')
      .leftJoinAndSelect('conversation.participants', 'participant')
      .where('conversation.id = :id', { id })
      .getOne();

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    if (!this.isMember(conversation, userId)) {
      throw new ForbiddenException('You are not a participant');
    }

    return conversation;
  }

  /** Owner-only: replace the participant list (owner always stays). */
  async update(
    id: number,
    userId: number,
    dto: UpdateConversationDto,
  ): Promise<ConversationEntity> {
    const conversation = await this.findOneForUser(id, userId);
    this.assertOwner(conversation, userId);

    if (dto.participantIds) {
      const participantIds = this.uniqueIds([userId, ...dto.participantIds]);
      conversation.participants = await this.loadParticipants(participantIds);
    }

    return this.conversationsRepository.save(conversation);
  }

  /** Owner-only: delete the conversation. Message documents are left in Mongo. */
  async remove(
    id: number,
    userId: number,
  ): Promise<{ deleted: true; id: number }> {
    const conversation = await this.findOneForUser(id, userId);
    this.assertOwner(conversation, userId);

    await this.conversationsRepository.remove(conversation);

    // A production system would also delete/archive messages in MongoDB or
    // enqueue a background cleanup job. sync between the two stores.
    return { deleted: true, id };
  }

  /**
   * Throw unless `userId` is a participant of `conversationId`.
   *
   * Used by ChatGateway and MessagesService before any read/write. It performs a
   * cheap join instead of loading all participants, and deliberately returns the
   * same 403 for "missing" and "not a member" to avoid leaking conversation ids.
   */
  async assertMember(conversationId: number, userId: number): Promise<void> {
    const membership = await this.conversationsRepository
      .createQueryBuilder('conversation')
      .leftJoin('conversation.participants', 'participant')
      .where('conversation.id = :conversationId', { conversationId })
      .andWhere(
        '(conversation.ownerId = :userId OR participant.id = :userId)',
        { userId },
      )
      .getOne();

    if (!membership) {
      throw new ForbiddenException(
        'You are not a participant of this conversation',
      );
    }
  }

  private isMember(conversation: ConversationEntity, userId: number): boolean {
    return (
      conversation.ownerId === userId ||
      conversation.participants.some((participant) => participant.id === userId)
    );
  }

  private assertOwner(conversation: ConversationEntity, userId: number): void {
    if (conversation.ownerId !== userId) {
      throw new ForbiddenException(
        'Only the conversation owner can perform this action',
      );
    }
  }

  private uniqueIds(ids: number[]): number[] {
    return [...new Set(ids)];
  }

  /** Validate that every id exists, then return the entities. */
  private async loadParticipants(ids: number[]) {
    const users = await this.usersService.findByIds(ids);

    if (users.length !== ids.length) {
      throw new BadRequestException('One or more participants do not exist');
    }

    return users;
  }
}
