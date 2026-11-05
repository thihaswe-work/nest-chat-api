import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { WsException } from '@nestjs/websockets';
import type { Request } from 'express';
import type { Socket } from 'socket.io';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { AuthUser, JwtPayload } from '../types/auth-user.js';

/**
 * Global authentication guard (HTTP + WebSocket).
 *
 * Registered once in AppModule with `{ provide: APP_GUARD, useClass: JwtAuthGuard }`,
 * so it runs before every controller handler and every @SubscribeMessage
 * handler. Routes marked with @Public() skip it.
 *
 * What it does:
 *   1. Reads a Bearer token from the Authorization header (HTTP) or from the
 *      Socket.IO handshake (`auth.token` or `Authorization` header).
 *   2. Verifies the signature and expiry with JwtService (jsonwebtoken).
 *   3. Publishes the verified identity:
 *        - HTTP: `request.user`
 *        - WS:   `socket.data.user`
 *   4. Rejects the request with 401 Unauthorized (or a WsException) otherwise.
 *
 * Because the identity comes from the signed token, clients cannot spoof another
 * user by sending a `senderId` or `userId` in the body.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // @Public() routes bypass authentication entirely.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const token = this.extractToken(context);
    if (!token) {
      throw this.unauthorized(context);
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);

      // A token without a subject cannot identify a user.
      if (!payload?.sub) {
        throw new Error('Token is missing the subject claim');
      }

      const user: AuthUser = {
        id: payload.sub,
        username: payload.username,
      };

      if (context.getType() === 'ws') {
        context.switchToWs().getClient<Socket>().data.user = user;
      } else {
        context
          .switchToHttp()
          .getRequest<Request & { user?: AuthUser }>().user = user;
      }

      return true;
    } catch {
      // Never leak whether the token was malformed, expired, or forged.
      throw this.unauthorized(context);
    }
  }

  /** Find a token in the location appropriate for the transport. */
  private extractToken(context: ExecutionContext): string | undefined {
    if (context.getType() === 'ws') {
      const client = context.switchToWs().getClient<Socket>();
      const handshakeToken: unknown = client.handshake.auth?.token;

      if (typeof handshakeToken === 'string') {
        return handshakeToken;
      }

      return this.fromAuthorizationHeader(
        client.handshake.headers.authorization,
      );
    }

    const request = context.switchToHttp().getRequest<Request>();
    return this.fromAuthorizationHeader(request.headers.authorization);
  }

  /** Parse "Bearer <token>" (case-insensitive scheme). */
  private fromAuthorizationHeader(
    header: string | undefined,
  ): string | undefined {
    if (!header) {
      return undefined;
    }

    const [scheme, token] = header.split(' ');
    return scheme?.toLowerCase() === 'bearer' ? token : undefined;
  }

  /** WebSocket errors must use WsException, HTTP errors use HTTP exceptions. */
  private unauthorized(context: ExecutionContext): Error {
    return context.getType() === 'ws'
      ? new WsException('Unauthorized')
      : new UnauthorizedException('Missing or invalid access token');
  }
}
