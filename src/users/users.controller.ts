import { Controller, Post, Body } from '@nestjs/common';
import { UsersService } from './users.service.js';

/**
 * HTTP layer for users. Mounted at /users.
 *
 * POST /users   body: { username, passwordHash }   -> created user
 *
 * The controller is deliberately thin: it only extracts the request body and
 * delegates to UsersService. Note that the field is named "passwordHash" but is
 * passed through unchanged - see the security note in users.entity.ts.
 */
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  async register(@Body() body: { username: string; passwordHash: string }) {
    return this.usersService.createUser(body.username, body.passwordHash);
  }
}
