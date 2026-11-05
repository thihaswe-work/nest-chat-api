import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';

/**
 * Authentication module.
 *
 * Marked @Global() so every feature module (and the APP_GUARD registered in
 * AppModule) can inject JwtService without importing this module individually.
 * Only JwtModule is exported; AuthService stays private to this module.
 *
 * JWT_SECRET must be set in production. The development fallback keeps local
 * startup frictionless, but a well-known secret would let anyone forge tokens.
 */
@Global()
@Module({
  imports: [
    UsersModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_SECRET');

        if (!secret && config.get<string>('NODE_ENV') === 'production') {
          throw new Error('JWT_SECRET must be set in production');
        }

        return {
          secret: secret || 'dev-only-insecure-secret-change-me',
          signOptions: {
            // jsonwebtoken accepts values such as "1h", "7d", "30m".
            expiresIn: (config.get<string>('JWT_EXPIRES_IN') || '1d') as never,
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [JwtModule],
})
export class AuthModule {}
