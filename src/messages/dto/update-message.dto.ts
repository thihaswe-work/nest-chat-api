import { IsString, Length } from 'class-validator';

/**
 * Body for PATCH /messages/:id.
 *
 * Only the message body is editable. Ownership is checked in MessagesService:
 * a user may edit (and delete) only their own messages.
 */
export class UpdateMessageDto {
  @IsString()
  @Length(1, 4000)
  body: string;
}
