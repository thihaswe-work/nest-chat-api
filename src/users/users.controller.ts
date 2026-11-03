import { Controller, Post, Body } from '@nestjs/common';
import { UsersService } from './users.service.js';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  async register(@Body() body: { username: string; passwordHash: string }) {
    return this.usersService.createUser(body.username, body.passwordHash);
  }
}
