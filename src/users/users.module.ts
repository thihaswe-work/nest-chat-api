import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './users.service.js';
import { UsersController } from './users.controller.js';
import { UserEntity } from './users.entity.js';
import { PasswordService } from './password.service.js';

/**
 * Users feature module.
 *
 * forFeature([UserEntity]) creates the injectable Repository<UserEntity> that
 * UsersService receives. PasswordService is a plain provider with no database
 * dependency.
 *
 * `exports` lets AuthModule (login) and ConversationsModule (participant
 * validation) reuse UsersService instead of duplicating queries.
 */
@Module({
  imports: [TypeOrmModule.forFeature([UserEntity])],
  controllers: [UsersController],
  providers: [UsersService, PasswordService],
  exports: [UsersService],
})
export class UsersModule {}
