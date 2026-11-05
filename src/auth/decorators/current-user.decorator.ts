import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthUser } from '../types/auth-user.js';

/**
 * Injects the authenticated user into a controller handler.
 *
 * The global JwtAuthGuard has already verified the token and put the user on
 * `request.user` by the time this decorator runs.
 *
 *   findMe(@CurrentUser() user: AuthUser)            // whole user
 *   findMe(@CurrentUser('id') userId: number)        // one property
 */
export const CurrentUser = createParamDecorator(
  (property: keyof AuthUser | undefined, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = request.user;

    return property ? user?.[property] : user;
  },
);
