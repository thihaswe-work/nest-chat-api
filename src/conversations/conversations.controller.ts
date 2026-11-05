import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { ConversationsService } from './conversations.service.js';
import { CreateConversationDto } from './dto/create-conversation.dto.js';
import { UpdateConversationDto } from './dto/update-conversation.dto.js';

/**
 * HTTP layer for conversations. Mounted at /conversations.
 *
 *   POST   /conversations       create one
 *   GET    /conversations       list all
 *   GET    /conversations/:id   get one
 *   PATCH  /conversations/:id   update one
 *   DELETE /conversations/:id   delete one
 *
 * @Param('id') always arrives as a string (URLs are text). The unary plus
 * converts it to a number to match ConversationEntity.id. +"abc" becomes NaN,
 * so a real implementation should validate the id (e.g. ParseIntPipe).
 *
 * These routes are currently backed by stub methods in ConversationsService.
 */
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Post()
  create(@Body() createConversationDto: CreateConversationDto) {
    return this.conversationsService.create(createConversationDto);
  }

  @Get()
  findAll() {
    return this.conversationsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.conversationsService.findOne(+id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateConversationDto: UpdateConversationDto,
  ) {
    return this.conversationsService.update(+id, updateConversationDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.conversationsService.remove(+id);
  }
}
