import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { UsersModule } from './users/users.module.js';
import { ConversationsModule } from './conversations/conversations.module.js';
import { MessagesModule } from './messages/messages.module.js';
import { ChatModule } from './chat/chat.module.js';
import { UserEntity } from './users/users.entity.js';
import { ConversationEntity } from './conversations/conversation.entity.js';

/**
 * Root module ("composition root") of the application.
 *
 * A NestJS module is a box that groups related controllers, providers (services)
 * and imports. AppModule is where every feature module and every database
 * connection is assembled. Nest builds a dependency-injection graph from this
 * metadata when the app starts.
 *
 * Storage split:
 *   - PostgreSQL: relational, strongly consistent data (users, conversations).
 *   - MongoDB: high-volume, append-only message history (flexible documents).
 *   - Redis: not a database here; it is the pub/sub backbone for Socket.IO.
 */
@Module({
  imports: [
    // Loads key/value pairs from .env into ConfigService and makes it global,
    // so no other module needs to import ConfigModule. The first existing file
    // in envFilePath wins; the second entry keeps older checkouts working.
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', 'src/.env'],
    }),

    // 1. PostgreSQL connection (users + conversations).
    //    forRootAsync lets us read connection details from ConfigService instead
    //    of hard-coding them. The `||` fallbacks make local development work even
    //    when an env var is missing.
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('POSTGRES_HOST') || 'localhost',
        port: Number(config.get<string>('POSTGRES_PORT')) || 5432,
        username: config.get<string>('POSTGRES_USER') || 'postgres',
        password: config.get<string>('POSTGRES_PASSWORD') || 'secret',
        database: config.get<string>('POSTGRES_DB') || 'chatapp',
        // Only entities listed here get tables in PostgreSQL.
        entities: [UserEntity, ConversationEntity],
        // synchronize: true auto-creates/updates tables from entity classes.
        // Convenient in development, DANGEROUS in production (use migrations).
        synchronize: true,
      }),
    }),

    // 2. MongoDB connection (message history).
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri:
          config.get<string>('MONGO_URI') ||
          'mongodb://localhost:27017/chatapp',
      }),
    }),

    // 3. Feature modules. Each one owns its own controllers/services/entities.
    //    Note: Mongoose schemas are registered by the module that uses them
    //    (see ChatModule), because forFeature() providers are module-scoped.
    UsersModule,
    ConversationsModule,
    MessagesModule,
    ChatModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
