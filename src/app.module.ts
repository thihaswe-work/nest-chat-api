import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from './users/users.module.js';
import { ConversationsModule } from './conversations/conversations.module.js';
import { MessagesModule } from './messages/messages.module.js';
import { ChatModule } from './chat/chat.module.js';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Message, MessageSchema } from './messages/schemas/message.schema.js';
import { UserEntity } from './users/users.entity.js';
import { ConversationEntity } from './conversations/conversation.entity.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    // 1. Global PostgreSQL connection root
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('POSTGRES_HOST') || 'localhost',
        port: Number(config.get<string>('POSTGRES_PORT')) || 5432,
        username: config.get<string>('POSTGRES_USER') || 'postgres', // Fallback ensures it never uses 'mmguser'
        password: config.get<string>('POSTGRES_PASSWORD') || 'secret',
        database: config.get<string>('POSTGRES_DB') || 'chatapp',
        entities: [UserEntity, ConversationEntity],
        synchronize: true,
      }),
    }),

    // 2. Global MongoDB connection root + Message Schema registration
    MongooseModule.forRootAsync({
      imports: [ConfigModule], // <-- Must import ConfigModule here
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri:
          config.get<string>('MONGO_URI') ||
          'mongodb://localhost:27017/chatapp', // Added a fallback just in case
      }),
    }),
    // 4. Register MongoDB schemas so they can be injected into gateways/services
    MongooseModule.forFeature([{ name: Message.name, schema: MessageSchema }]),
    UsersModule,
    ConversationsModule,
    MessagesModule,
    ChatModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
