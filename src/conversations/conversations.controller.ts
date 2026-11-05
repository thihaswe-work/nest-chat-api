import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ConversationsService } from './conversations.service.js';
import { CreateConversationDto } from './dto/create-conversation.dto.js';
import { UpdateConversationDto } from './dto/update-conversation.dto.js';

/**
 * HTTP layer for conversations. Mounted at /conversations.
 *
 *   POST   /conversations       create (creator becomes owner + participant)
 *   GET    /conversations       list conversations you belong to
 *   GET    /conversations/:id   read one (participants only)
 *   PATCH  /conversations/:id   update participants (owner only)
 *   DELETE /conversations/:id   delete (owner only)
 *
 * Every route requires `Authorization: Bearer <token>`. The user id always comes
 * from @CurrentUser(), never from the URL/body, so clients cannot act as another
 * user. Ownership and membership checks live in ConversationsService.
 *
 * ParseIntPipe turns `:id` into a number and returns 400 for non-numeric ids.
 */
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Post()
  create(
    @CurrentUser('id') userId: number,
    @Body() dto: CreateConversationDto,
  ) {
    return this.conversationsService.create(userId, dto);
  }

  @Get()
  findAll(@CurrentUser('id') userId: number) {
    return this.conversationsService.findAllForUser(userId);
  }

  @Get(':id')
  findOne(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.conversationsService.findOneForUser(id, userId);
  }

  @Patch(':id')
  update(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateConversationDto,
  ) {
    return this.conversationsService.update(id, userId, dto);
  }

  @Delete(':id')
  remove(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.conversationsService.remove(id, userId);
  }
}
