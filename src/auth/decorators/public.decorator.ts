import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key used by the global JWT guard to recognise public routes.
 * Exported so the guard and the decorator cannot drift apart.
 */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a controller or handler as publicly accessible.
 *
 * Every route is protected by default because `JwtAuthGuard` is registered as a
 * global guard in AppModule. Add @Public() only to routes that genuinely must
 * work without a token, such as registration and login.
 *
 * Usage:
 *   @Public()
 *   @Post('login')
 *   login(...) {}
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
