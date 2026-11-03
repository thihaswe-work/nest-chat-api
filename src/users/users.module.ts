import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './users.service.js';
import { UsersController } from './users.controller.js';
import { UserEntity } from './users.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity])], // This registers the repository for UserEntity
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService], // Export if other modules need to use UsersService later
})
export class UsersModule {}
