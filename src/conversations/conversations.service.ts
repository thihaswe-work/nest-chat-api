import { Injectable } from '@nestjs/common';
import { CreateConversationDto } from './dto/create-conversation.dto.js';
import { UpdateConversationDto } from './dto/update-conversation.dto.js';

/**
 * Business logic for conversations.
 *
 * SCAFFOLD ONLY: every method currently returns a human-readable string, so the
 * routes are wired but no data is read or written. To implement for real:
 *   1. Inject Repository<ConversationEntity> (register it in ConversationsModule
 *      with TypeOrmModule.forFeature).
 *   2. Replace the strings with repository calls (create/save/find/update/delete).
 *   3. Convert "not found" cases into NotFoundException so clients get a 404.
 *
 * The controller already calls these methods, so the HTTP contract does not need
 * to change.
 */
@Injectable()
export class ConversationsService {
  create(_createConversationDto: CreateConversationDto) {
    return 'This action adds a new conversation';
  }

  findAll() {
    return `This action returns all conversations`;
  }

  findOne(id: number) {
    return `This action returns a #${id} conversation`;
  }

  update(id: number, _updateConversationDto: UpdateConversationDto) {
    return `This action updates a #${id} conversation`;
  }

  remove(id: number) {
    return `This action removes a #${id} conversation`;
  }
}
