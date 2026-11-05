import { ArrayUnique, IsArray, IsInt, IsOptional } from 'class-validator';

/**
 * Body for PATCH /conversations/:id.
 *
 * Only the owner may call update. When `participantIds` is provided it replaces
 * the participant list (the owner is always kept). Omitting it leaves the list
 * unchanged.
 */
export class UpdateConversationDto {
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  participantIds?: number[];
}
