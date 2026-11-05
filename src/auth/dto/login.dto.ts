import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Body for POST /auth/login.
 *
 * Keep the error response generic ("Invalid username or password") so attackers
 * cannot use the endpoint to discover which usernames exist.
 */
export class LoginDto {
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  username: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password: string;
}
