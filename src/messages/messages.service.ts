import { Injectable } from '@nestjs/common';
import { CreateMessageDto } from './dto/create-message.dto.js';
import { UpdateMessageDto } from './dto/update-message.dto.js';

/**
 * REST business logic for messages.
 *
 * SCAFFOLD ONLY: these methods return strings. The real, working message path
 * is the WebSocket gateway (chat.gateway.ts), which writes to MongoDB directly.
 *
 * If you implement these routes, inject the Mongoose model the same way the
 * gateway does:
 *
 *   constructor(@InjectModel(Message.name) private model: Model<MessageDocument>) {}
 *
 * and add MongooseModule.forFeature([{ name: Message.name, schema: MessageSchema }])
 * to MessagesModule. Remember to paginate findAll(); never return an unbounded
 * message history.
 */
@Injectable()
export class MessagesService {
  create(_createMessageDto: CreateMessageDto) {
    return 'This action adds a new message';
  }

  findAll() {
    return `This action returns all messages`;
  }

  findOne(id: number) {
    return `This action returns a #${id} message`;
  }

  update(id: number, _updateMessageDto: UpdateMessageDto) {
    return `This action updates a #${id} message`;
  }

  remove(id: number) {
    return `This action removes a #${id} message`;
  }
}
