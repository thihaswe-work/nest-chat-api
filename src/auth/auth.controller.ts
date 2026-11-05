import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { Public } from './decorators/public.decorator.js';

/**
 * Public authentication endpoints.
 *
 *   POST /auth/register  { username, password }  -> 201 + access token
 *   POST /auth/login     { username, password }  -> 200 + access token
 *
 * The whole controller is @Public() because these are the two routes a client
 * must be able to call without already having a token. Every other route in the
 * app is protected by default.
 */
@Public()
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }
}
