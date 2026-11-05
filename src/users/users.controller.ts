import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthUser } from '../auth/types/auth-user.js';
import { UsersService } from './users.service.js';

/**
 * HTTP layer for users. Mounted at /users.
 *
 *   GET /users/me   -> the authenticated user (no password)
 *
 * Registration moved to POST /auth/register so that it can issue a token and
 * hash the password in one place. This controller is protected by the global
 * JWT guard; there is no @Public() marker here.
 */
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  async me(@CurrentUser() authUser: AuthUser) {
    const user = await this.usersService.findById(authUser.id);
    return this.usersService.toPublicUser(user);
  }
}
