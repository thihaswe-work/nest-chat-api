import { ArrayUnique, IsArray, IsInt } from 'class-validator';

/**
 * Body for POST /conversations.
 *
 * The creator is added automatically from the JWT, so they must not be listed
 * here. `participantIds` contains the other users to invite (it may be empty for
 * a conversation with yourself).
 *
 * Validation:
 *   - must be an array of integers (no strings/objects)
 *   - duplicates are rejected
 */
export class CreateConversationDto {
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  participantIds: number[];
}
