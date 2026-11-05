import { UnauthorizedException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service.js';
import type { UserEntity } from '../users/users.entity.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { JwtPayload } from './types/auth-user.js';

/**
 * Authentication use-cases: register, log in, and issue JWTs.
 *
 * Authorization is deliberately NOT here. This service answers "who are you?";
 * the conversation/message services answer "are you allowed to do this?".
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  /** Create an account and return a ready-to-use session. */
  async register(dto: RegisterDto) {
    const user = await this.usersService.createUser(dto.username, dto.password);
    return this.createSession(user);
  }

  /** Verify credentials and return a session, or a generic 401. */
  async login(dto: LoginDto) {
    const user = await this.usersService.validateCredentials(
      dto.username,
      dto.password,
    );

    if (!user) {
      throw new UnauthorizedException('Invalid username or password');
    }

    return this.createSession(user);
  }

  /**
   * Sign a JWT and shape the response.
   *
   * The token contains only the user id (`sub`) and username. It is signed with
   * JWT_SECRET, so any modification invalidates the signature. The password hash
   * never leaves the database.
   */
  private async createSession(user: UserEntity) {
    const payload: JwtPayload = { sub: user.id, username: user.username };
    const accessToken = await this.jwtService.signAsync(payload);

    return {
      accessToken,
      tokenType: 'Bearer',
      user: this.usersService.toPublicUser(user),
    };
  }
}
