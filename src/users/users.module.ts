import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './users.service.js';
import { UsersController } from './users.controller.js';
import { UserEntity } from './users.entity.js';

/**
 * Users feature module.
 *
 * forFeature([UserEntity]) creates the injectable Repository<UserEntity> that
 * UsersService receives. It is scoped to this module, so other modules that
 * need the repository (or the service) must import this module or register the
 * entity themselves.
 *
 * `exports` re-exports UsersService so future modules (e.g. auth) can inject it.
 */
@Module({
  imports: [TypeOrmModule.forFeature([UserEntity])],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
