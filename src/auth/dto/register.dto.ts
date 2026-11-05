import {
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Body for POST /auth/register.
 *
 * Validation is enforced by the global ValidationPipe configured in main.ts.
 * Unknown properties are rejected (`forbidNonWhitelisted: true`) and stripped
 * (`whitelist: true`), so clients cannot smuggle extra fields into the service.
 */
export class RegisterDto {
  @IsString()
  @Length(3, 32)
  @Matches(/^[a-zA-Z0-9_]+$/, {
    message: 'username may only contain letters, numbers and underscores',
  })
  username: string;

  /**
   * The plaintext password travels only inside the HTTPS request body. It is
   * hashed with scrypt before it reaches the database and is never stored or
   * returned as-is.
   */
  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters long' })
  @MaxLength(128)
  password: string;
}
