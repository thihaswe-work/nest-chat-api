import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { CreateMessageDto } from './dto/create-message.dto.js';
import { UpdateMessageDto } from './dto/update-message.dto.js';
import { MessagesService } from './messages.service.js';

/**
 * HTTP layer for messages. Mounted at /messages. All routes require a JWT.
 *
 *   POST   /messages?                              { conversationId, body }
 *   GET    /messages?conversationId=1&limit=50     newest first
 *   GET    /messages/:id                           one message
 *   PATCH  /messages/:id                           { body }  (sender only)
 *   DELETE /messages/:id                           (sender only)
 *
 * The user id comes from @CurrentUser('id'), never from the request body.
 * Conversation membership and message ownership are enforced in MessagesService.
 *
 * `limit` defaults to 50 via DefaultValuePipe and is additionally clamped in the
 * service. `:id` stays a string because MongoDB ids are ObjectIds, not numbers.
 */
@Controller('messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Post()
  create(@CurrentUser('id') userId: number, @Body() dto: CreateMessageDto) {
    return this.messagesService.create(userId, dto);
  }

  @Get()
  findAll(
    @CurrentUser('id') userId: number,
    @Query('conversationId', ParseIntPipe) conversationId: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.messagesService.findAll(userId, conversationId, limit);
  }

  @Get(':id')
  findOne(@CurrentUser('id') userId: number, @Param('id') id: string) {
    return this.messagesService.findOne(userId, id);
  }

  @Patch(':id')
  update(
    @CurrentUser('id') userId: number,
    @Param('id') id: string,
    @Body() dto: UpdateMessageDto,
  ) {
    return this.messagesService.update(userId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser('id') userId: number, @Param('id') id: string) {
    return this.messagesService.remove(userId, id);
  }
}
