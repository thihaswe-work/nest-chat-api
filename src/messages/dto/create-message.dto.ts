import { IsInt, IsString, Length, Min } from 'class-validator';

/**
 * Body for POST /messages and (conceptually) the "message:send" WS event.
 *
 * `senderId` is intentionally absent: the server takes the author from the
 * verified JWT. Accepting it from the client would let anyone impersonate anyone.
 */
export class CreateMessageDto {
  @IsInt()
  @Min(1)
  conversationId: number;

  @IsString()
  @Length(1, 4000)
  body: string;
}
